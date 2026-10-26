import { writeProfileRow } from "./profile-write";
import {
  loadSimpleSalaryForProfile,
  simpleSalaryProfileInput,
  storeSimpleSalaryForProfile,
} from "./simple-salary-profile";
import { withImmediateTransaction } from "./transaction";
import type { SQLiteDatabase } from "expo-sqlite";

import type { SaveProfileInput, UserProfile } from "@/domain/types";
import { validateProfile, ValidationError } from "@/domain/validation";
import { salaryBasisCount } from "@/domain/salary-basis-conflict";
import { mapProfileRow, type ProfileRow } from "@/infrastructure/database/profile-row";

export async function loadProfile(db: SQLiteDatabase): Promise<UserProfile | null> {
  const row = await db.getFirstAsync<ProfileRow>(
    `SELECT federal_state,holiday_region,weekly_minutes,time_zone,pay_group,pay_level,
      tariff_sector,tariff_region,full_time_weekly_minutes,industry,manual_monthly_gross_cents,
      regular_rotating_night_work,sunday_holiday_work_eligible,all_employment_work_recorded,
      display_name,employer_name,created_at,updated_at
     FROM user_profile WHERE id='singleton'`,
  );
  if (row === null) return null;
  return loadSimpleSalaryForProfile(db, mapProfileRow(row));
}

export async function saveProfile(
  db: SQLiteDatabase,
  rawInput: SaveProfileInput,
): Promise<UserProfile> {
  return withImmediateTransaction(db, (transaction) =>
    saveProfileInTransaction(transaction, rawInput),
  );
}

/** Internal writer, caller owns the immediate transaction. */
export async function saveProfileInTransaction(
  db: SQLiteDatabase,
  rawInput: SaveProfileInput,
): Promise<UserProfile> {
  const current = await loadProfile(db);
  if (current?.salaryBasisConflict && salaryBasisCount(rawInput) !== 1)
    throw new ValidationError("Bitte zuerst eine Gehaltsgrundlage wählen.");
  const input = validateProfile({
    ...simpleSalaryProfileInput(rawInput, current),
    displayName:
      rawInput.displayName === undefined ? (current?.displayName ?? null) : rawInput.displayName,
    employerName:
      rawInput.employerName === undefined ? (current?.employerName ?? null) : rawInput.employerName,
    industry: rawInput.industry === undefined ? (current?.industry ?? null) : rawInput.industry,
  });
  const now = new Date().toISOString();
  await writeProfileRow(db, input, now);
  await storeSimpleSalaryForProfile(db, input, now);
  const profile = await loadProfile(db);
  if (profile === null) throw new Error("Profil konnte nicht gespeichert werden.");
  return profile;
}
