import { loadTvoedWorkPatternSettings } from "./preferences-repository";
import type { SQLiteDatabase } from "expo-sqlite";
import { Temporal } from "@js-temporal/polyfill";
import type { SaveProfileInput, UserProfile } from "@/domain/types";
import { ConcurrencyError } from "@/domain/errors";
import { validateProfile, ValidationError } from "@/domain/validation";
import {
  remunerationDataFromLegacy,
  requireRemunerationDate,
  resolveRemunerationProfile,
  type DatedRemunerationProfile,
} from "@/domain/remuneration-profile";
import {
  employmentDataFromProfile,
  validateEmploymentData,
  employmentProfileAt,
  employmentTimelineKey,
  employmentWithRemuneration,
  encodeEmploymentPayload,
  type EmploymentProfileData,
} from "@/domain/employment-history";
import { loadProfile, saveProfileInTransaction } from "./profile-repository";
import { listRemunerationProfiles } from "./remuneration-profile-repository";
import { projectStoredSimpleProfile } from "./simple-app-profile";
import { simpleSalaryProfileInput } from "./simple-salary-profile";
import { withImmediateTransaction } from "./transaction";

// Salary families change together; a step within the same family remains an independent field.
const SALARY_KEYS = [
  "tariff",
  "manualMonthlyGrossCents",
  "nursingTrainingTariff",
  "vkaETariff",
  "tvlKrTariff",
  "tvUkNursingTariff",
  "tvhKrTariff",
  "tvalPflegeTariff",
] as const;
function financialData(before: DatedRemunerationProfile | undefined, profile: UserProfile) {
  const converted = remunerationDataFromLegacy(profile);
  if (!before) return converted;
  const unchangedSalary =
    before.employment &&
    SALARY_KEYS.every((key) => same(before.employment![key], profile[key] ?? null));
  if (unchangedSalary) return { ...before.data, weeklyMinutes: profile.weeklyMinutes };
  if (
    before.data.selection.kind === "tariff" &&
    converted.selection.kind === "tariff" &&
    before.data.selection.packageId === converted.selection.packageId
  )
    return {
      ...before.data,
      weeklyMinutes: profile.weeklyMinutes,
      selection: { ...before.data.selection, ...converted.selection },
    };
  if (before.data.selection.kind === "tariff" && before.employment) {
    const previousKey = SALARY_KEYS.find((key) => before.employment![key] != null);
    const nextKey = SALARY_KEYS.find((key) => profile[key] != null);
    if (previousKey && previousKey === nextKey && previousKey !== "manualMonthlyGrossCents") {
      const salary = profile[nextKey] as unknown as Record<string, unknown>;
      const selection = before.data.selection;
      return {
        ...before.data,
        weeklyMinutes: profile.weeklyMinutes,
        selection: {
          ...selection,
          group: typeof salary.payGroup === "string" ? salary.payGroup : selection.group,
          level:
            salary.payLevel !== undefined
              ? String(salary.payLevel)
              : salary.trainingYear !== undefined
                ? String(salary.trainingYear)
                : selection.level,
          variant: typeof salary.sector === "string" ? salary.sector : selection.variant,
          region: typeof salary.tariffRegion === "string" ? salary.tariffRegion : selection.region,
          fullTimeWeeklyMinutes:
            typeof salary.fullTimeWeeklyMinutes === "number"
              ? salary.fullTimeWeeklyMinutes
              : selection.fullTimeWeeklyMinutes,
        },
      };
    }
  }
  return converted;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Patch = { key: keyof EmploymentProfileData; child?: string; value: unknown };
function changes(before: EmploymentProfileData, after: EmploymentProfileData): Patch[] {
  const family = (v: EmploymentProfileData) => SALARY_KEYS.find((key) => v[key] != null);
  const changedFamily = family(before) !== family(after);
  return (Object.keys(after) as (keyof EmploymentProfileData)[]).flatMap<Patch>((key) => {
    const a = before[key],
      b = after[key];
    if (changedFamily && SALARY_KEYS.includes(key as (typeof SALARY_KEYS)[number]))
      return [{ key, value: b }];
    if (same(a, b)) return [];
    if (typeof a === "object" && a !== null && typeof b === "object" && b !== null)
      return Object.keys(b)
        .filter(
          (child) =>
            !same(
              (a as unknown as Record<string, unknown>)[child],
              (b as unknown as Record<string, unknown>)[child],
            ),
        )
        .map((child) => ({ key, child, value: (b as unknown as Record<string, unknown>)[child] }));
    return [{ key, value: b }];
  });
}
const field = (data: EmploymentProfileData, p: Patch) =>
  p.child ? (data[p.key] as unknown as Record<string, unknown> | null)?.[p.child] : data[p.key];
function apply(data: EmploymentProfileData, patch: readonly Patch[]): EmploymentProfileData {
  const next = { ...data } as unknown as Record<string, unknown>;
  for (const p of patch)
    next[p.key] = p.child ? { ...(next[p.key] as object), [p.child]: p.value } : p.value;
  return employmentDataFromProfile(next as unknown as EmploymentProfileData);
}

async function write(db: SQLiteDatabase, entry: DatedRemunerationProfile) {
  await db.runAsync(
    `INSERT INTO remuneration_profiles(id,effective_from,data_json,revision,created_at,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,
    revision=excluded.revision,updated_at=excluded.updated_at`,
    entry.effectiveFrom === null ? "legacy" : "from:" + entry.effectiveFrom,
    entry.effectiveFrom,
    encodeEmploymentPayload(entry.data, entry.employment, entry.employmentOverrides),
    entry.revision,
    entry.createdAt,
    entry.updatedAt,
  );
}

/** One transaction for the existing settings, history and current projection. */
export async function saveEmploymentProfile(
  db: SQLiteDatabase,
  raw: SaveProfileInput,
): Promise<UserProfile> {
  return withImmediateTransaction(db, async (tx) => {
    const stored = await loadProfile(tx);
    if (!raw.validity) {
      // Onboarding and identity-only edits retain their original contract.
      const saved = await saveProfileInTransaction(tx, raw);
      return (await projectStoredSimpleProfile(tx, saved))!;
    }
    if (!stored) throw new ValidationError("Bitte zuerst dein Arbeitsprofil anlegen.");
    const history = await listRemunerationProfiles(tx);
    const projectedCurrent = (await projectStoredSimpleProfile(tx, stored))!;
    const legacyPattern = await loadTvoedWorkPatternSettings(tx);
    const legacyAnswers = {
      workplaceCoverage: legacyPattern.workplaceCoverage,
      assignment: legacyPattern.assignment,
    };
    const current = {
      ...projectedCurrent,
      workPattern: projectedCurrent.workPattern ?? legacyAnswers,
    };
    if (
      raw.validity.expectedProfileUpdatedAt !== current.updatedAt ||
      raw.validity.expectedTimeline !== employmentTimelineKey(history)
    )
      throw new ConcurrencyError("Deine Angaben wurden inzwischen geändert. Bitte erneut öffnen.");
    if (raw.validity.restoreTimeline) {
      if (
        !raw.validity.baseline ||
        !same(validateEmploymentData(raw.validity.baseline), employmentDataFromProfile(current))
      )
        throw new ConcurrencyError(
          "Deine Angaben wurden inzwischen geändert. Bitte erneut öffnen.",
        );
      const previous = raw.validity.restoreTimeline;
      const dates = previous.map((item) =>
        item.effectiveFrom === null ? null : requireRemunerationDate(item.effectiveFrom),
      );
      if (new Set(dates).size !== dates.length)
        throw new ValidationError("Der frühere Verlauf enthält doppelte Zeiträume.");
      for (const item of previous)
        encodeEmploymentPayload(item.data, item.employment, item.employmentOverrides);
      const testRun = await tx.getFirstAsync<{ month: string }>(
        "SELECT month FROM dev_test_backups ORDER BY month LIMIT 1",
      );
      if (testRun) throw new ValidationError("Bitte zuerst den offenen Testlauf beenden.");
      // Full timeline guard above makes this rollback atomic and rejects any later edits.
      await tx.runAsync("DELETE FROM remuneration_profiles");
      const now = new Date().toISOString();
      for (const item of previous)
        await write(tx, {
          ...item,
          revision:
            Math.max(
              item.revision,
              history.find((p) => p.effectiveFrom === item.effectiveFrom)?.revision ?? 0,
            ) + 1,
          updatedAt: now,
        });
      const saved = await saveProfileInTransaction(tx, {
        ...raw,
        displayName: stored.displayName,
        employerName: stored.employerName,
      });
      return (await projectStoredSimpleProfile(tx, saved))!;
    }
    const date =
      raw.validity.effectiveFrom === null
        ? null
        : requireRemunerationDate(raw.validity.effectiveFrom);
    const valid = {
      ...validateProfile(simpleSalaryProfileInput(raw, current)),
      workPattern: raw.workPattern ?? current.workPattern,
    };
    let patch = changes(
      raw.validity.baseline
        ? validateEmploymentData(raw.validity.baseline)
        : employmentDataFromProfile(current),
      employmentDataFromProfile(valid),
    );
    if (raw.validity.fields) {
      if (raw.validity.fields.some((key) => !Object.hasOwn(employmentDataFromProfile(valid), key)))
        throw new ValidationError("Die Änderung enthält unbekannte Profilfelder.");
      patch = patch.filter((change) => raw.validity!.fields!.includes(change.key));
    }
    const testRun = await tx.getFirstAsync<{ month: string }>(
      "SELECT month FROM dev_test_backups ORDER BY month LIMIT 1",
    );
    if (testRun) throw new ValidationError("Bitte zuerst den offenen Testlauf beenden.");
    const now = new Date().toISOString();
    const baseline = employmentDataFromProfile(current);
    const entries: DatedRemunerationProfile[] = history.map((item) => ({
      ...item,
      employment: {
        ...(item.employment ?? employmentWithRemuneration(baseline, item.data)),
        workPattern: item.employment?.workPattern ?? legacyAnswers,
      },
      ...(!item.employment ? { revision: item.revision + 1, updatedAt: now } : {}),
    }));
    if (!entries.some((item) => item.effectiveFrom === null))
      entries.unshift({
        effectiveFrom: null,
        employment: baseline,
        data: remunerationDataFromLegacy(current),
        revision: 1,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      });
    const resolved = resolveRemunerationProfile(entries, date ?? "1900-01-01").profile!;
    const original = resolved.employment!;
    const today = Temporal.Now.plainDateISO(current.timeZone).toString();
    const whole = date === null && Boolean(raw.validity.correctionFields?.length);
    const overrideFields = whole ? raw.validity.correctionFields! : [];
    const overrides = (item: DatedRemunerationProfile) => {
      const fields = {
        ...item.employmentOverrides,
        ...Object.fromEntries(overrideFields.map((field) => [field, today])),
      };
      return Object.keys(fields).length ? { employmentOverrides: fields } : {};
    };
    if (raw.validity.correctionFields) {
      const keys = Object.keys(baseline);
      if (raw.validity.correctionFields.some((key) => !keys.includes(key)))
        throw new ValidationError("Die Korrektur enthält unbekannte Profilfelder.");
      patch = changes(original, employmentDataFromProfile(valid)).filter((change) =>
        raw.validity!.correctionFields!.includes(change.key),
      );
    }
    if (whole) {
      const sources = [
        original,
        ...entries
          .filter((item) => item.effectiveFrom && item.effectiveFrom <= today)
          .map((item) => item.employment!),
      ];
      patch = [
        ...new Map(
          sources
            .flatMap((before) => changes(before, employmentDataFromProfile(valid)))
            .filter((change) => overrideFields.includes(change.key))
            .map((change) => [change.key + ":" + (change.child ?? ""), change]),
        ).values(),
      ];
    }
    const declared =
      date !== null && raw.validity.declarePeriod === true && Boolean(raw.validity.fields?.length);
    if (declared && !patch.length)
      patch = changes(original, employmentDataFromProfile(valid)).filter((change) =>
        raw.validity!.fields!.includes(change.key),
      );
    if (!patch.length && !whole && !declared) return current;

    const atDate = entries.find((item) => item.effectiveFrom === date);
    const updated = apply(original, patch);
    if (!whole && !declared && same(updated, original)) return current;
    const next: DatedRemunerationProfile = {
      effectiveFrom: date,
      ...overrides(resolved),
      employment: updated,
      data: financialData(resolved, { ...current, ...updated }),
      revision: (atDate?.revision ?? 0) + 1,
      createdAt: atDate?.createdAt ?? now,
      updatedAt: now,
    };
    // Carry each changed field forward until a later event explicitly changes that field.
    let active = patch;
    let previous = original;
    for (const item of entries
      .filter((item) => item.effectiveFrom !== null && (date === null || item.effectiveFrom > date))
      .sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!))) {
      const originalFuture = item.employment!;
      if (!whole || item.effectiveFrom! > today)
        active = active.filter((p) => same(field(originalFuture, p), field(previous, p)));
      if (active.length || whole) {
        const future = apply(originalFuture, active);
        const replacement = {
          ...item,
          ...overrides(item),
          employment: future,
          data: financialData(item, { ...current, ...future }),
          revision: item.revision + 1,
          updatedAt: now,
        };
        entries[entries.indexOf(item)] = replacement;
      }
      previous = originalFuture;
    }
    const existing = entries.findIndex((item) => item.effectiveFrom === date);
    if (existing < 0) entries.push(next);
    else entries[existing] = next;
    for (const item of entries) await write(tx, item);
    if (current.salaryBasisConflict && date !== null && date > today)
      throw new ValidationError("Bitte zuerst eine aktuell gültige Gehaltsgrundlage wählen.");
    const projected = employmentProfileAt(
      { ...current, salaryBasisConflict: undefined, employmentTimeline: entries },
      today,
    );
    const saved = await saveProfileInTransaction(tx, projected);
    return employmentProfileAt(
      { ...saved, employmentTimeline: await listRemunerationProfiles(tx) },
      today,
    );
  });
}
