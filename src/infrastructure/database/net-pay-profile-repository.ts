import { Temporal } from "@js-temporal/polyfill";
import canonicalize from "canonicalize";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  requireNetPaySettingsMonth,
  validateMonthlyNetPaySettings,
  resolveNetPaySettings,
  type MonthlyNetPaySettings,
  type SavedMonthlyNetPaySettings,
} from "@/domain/net-pay-profile";

import { withImmediateTransaction } from "./transaction";

export const NET_PAY_PROFILE_COLUMNS = [
  "month",
  "settings_json",
  "revision",
  "created_at",
  "updated_at",
] as const;

export class NetPayProfileConflictError extends Error {
  constructor() {
    super("Das Netto-Profil wurde zwischenzeitlich geändert. Lade den Monat erneut.");
    this.name = "NetPayProfileConflictError";
  }
}

export function mapNetPayProfileRow(value: unknown): SavedMonthlyNetPaySettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ungültiges gespeichertes Netto-Profil.");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== NET_PAY_PROFILE_COLUMNS.length ||
    !NET_PAY_PROFILE_COLUMNS.every((key) => Object.hasOwn(row, key)) ||
    typeof row.settings_json !== "string" ||
    !Number.isSafeInteger(row.revision) ||
    (row.revision as number) < 1 ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  )
    throw new Error("Ungültiges gespeichertes Netto-Profil.");
  const settings = validateMonthlyNetPaySettings(JSON.parse(row.settings_json));
  if (settings.month !== row.month)
    throw new Error("Monatsbindung des Netto-Profils ist ungültig.");
  const createdAt = Temporal.Instant.from(row.created_at);
  const updatedAt = Temporal.Instant.from(row.updated_at);
  if (Temporal.Instant.compare(createdAt, updatedAt) > 0)
    throw new Error("Zeitfolge des Netto-Profils ist ungültig.");
  return Object.freeze({
    settings,
    revision: row.revision as number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function loadMonthlyNetPaySettings(
  db: SQLiteDatabase,
  month: string,
): Promise<SavedMonthlyNetPaySettings | null> {
  requireNetPaySettingsMonth(month);
  const row = await db.getFirstAsync(
    `SELECT ${NET_PAY_PROFILE_COLUMNS.join(",")} FROM net_pay_profiles WHERE month=?`,
    month,
  );
  return row === null ? null : mapNetPayProfileRow(row);
}

async function assertNoTestRun(db: SQLiteDatabase, month: string): Promise<void> {
  if (await db.getFirstAsync("SELECT month FROM dev_test_backups WHERE month=?", month))
    throw new Error("Im Testlabor ist für diesen Monat noch ein Testlauf offen.");
}

function requireExpectedSnapshot(
  previous: SavedMonthlyNetPaySettings | null,
  expected: SavedMonthlyNetPaySettings | null,
): void {
  if (previous === null && expected === null) return;
  if (
    !previous ||
    !expected ||
    previous.revision !== expected.revision ||
    previous.createdAt !== expected.createdAt ||
    previous.updatedAt !== expected.updatedAt ||
    canonicalize(previous.settings) !== canonicalize(expected.settings)
  )
    throw new NetPayProfileConflictError();
}

export async function saveMonthlyNetPaySettings(
  db: SQLiteDatabase,
  input: {
    readonly settings: MonthlyNetPaySettings;
    readonly expected: SavedMonthlyNetPaySettings | null;
  },
): Promise<SavedMonthlyNetPaySettings> {
  const settings = validateMonthlyNetPaySettings(input.settings);
  return withImmediateTransaction(db, async (tx) => {
    await assertNoTestRun(tx, settings.month);
    if (!(await tx.getFirstAsync("SELECT id FROM user_profile WHERE id='singleton'")))
      throw new Error("Das Arbeitsprofil fehlt.");
    const previous = await loadMonthlyNetPaySettings(tx, settings.month);
    requireExpectedSnapshot(previous, input.expected);
    return writeNetPaySettings(tx, settings, previous);
  });
}

async function writeNetPaySettings(
  tx: SQLiteDatabase,
  settings: MonthlyNetPaySettings,
  previous: SavedMonthlyNetPaySettings | null,
): Promise<SavedMonthlyNetPaySettings> {
  const now = new Date().toISOString();
  const updatedAt =
    previous &&
    Temporal.Instant.compare(
      Temporal.Instant.from(now),
      Temporal.Instant.from(previous.updatedAt),
    ) < 0
      ? previous.updatedAt
      : now;
  const revision = (previous?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new NetPayProfileConflictError();
  await tx.runAsync(
    `INSERT INTO net_pay_profiles(month,settings_json,revision,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET settings_json=excluded.settings_json,revision=excluded.revision,updated_at=excluded.updated_at`,
    settings.month,
    JSON.stringify(settings),
    revision,
    previous?.createdAt ?? updatedAt,
    updatedAt,
  );
  return (await loadMonthlyNetPaySettings(tx, settings.month))!;
}

export async function loadNetPayProfileTimeline(
  db: SQLiteDatabase,
): Promise<readonly SavedMonthlyNetPaySettings[]> {
  const rows = await db.getAllAsync(
    `SELECT ${NET_PAY_PROFILE_COLUMNS.join(",")} FROM net_pay_profiles ORDER BY month`,
  );
  return rows.map(mapNetPayProfileRow);
}

export async function loadApplicableNetPaySettings(db: SQLiteDatabase, month: string) {
  const timeline = await loadNetPayProfileTimeline(db);
  return { timeline, saved: resolveNetPaySettings(month, timeline) };
}

/** Compare the entire dated timeline, including the inherited source, in the write transaction. */
export async function saveContinuousNetPaySettings(
  db: SQLiteDatabase,
  input: {
    readonly settings: MonthlyNetPaySettings;
    readonly expectedTimeline: readonly SavedMonthlyNetPaySettings[];
  },
): Promise<SavedMonthlyNetPaySettings> {
  const settings = validateMonthlyNetPaySettings(input.settings);
  if (settings.version !== 2) throw new Error("Das fortgeltende Netto-Profil fehlt.");
  return withImmediateTransaction(db, async (tx) => {
    const timeline = await loadNetPayProfileTimeline(tx);
    if (canonicalize(timeline) !== canonicalize(input.expectedTimeline))
      throw new NetPayProfileConflictError();
    const effective = timeline.length
      ? settings
      : validateMonthlyNetPaySettings({ ...settings, month: settings.month.slice(0, 4) + "-01" });
    if (
      await tx.getFirstAsync("SELECT month FROM dev_test_backups WHERE month>=?", effective.month)
    )
      throw new Error("Im Testlabor ist für einen betroffenen Monat noch ein Testlauf offen.");
    if (!(await tx.getFirstAsync("SELECT id FROM user_profile WHERE id='singleton'")))
      throw new Error("Das Arbeitsprofil fehlt.");
    const previous = timeline.find((row) => row.settings.month === effective.month) ?? null;
    return writeNetPaySettings(tx, effective, previous);
  });
}

export async function deleteMonthlyNetPaySettings(
  db: SQLiteDatabase,
  month: string,
  expected: SavedMonthlyNetPaySettings | null,
): Promise<void> {
  requireNetPaySettingsMonth(month);
  await withImmediateTransaction(db, async (tx) => {
    await assertNoTestRun(tx, month);
    const previous = await loadMonthlyNetPaySettings(tx, month);
    requireExpectedSnapshot(previous, expected);
    await tx.runAsync("DELETE FROM net_pay_profiles WHERE month=?", month);
  });
}
