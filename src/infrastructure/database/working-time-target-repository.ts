import { Temporal } from "@js-temporal/polyfill";
import canonicalize from "canonicalize";
import type { SQLiteDatabase } from "expo-sqlite";
import type { WorkingTimeTargetContext } from "@/domain/working-time-target";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import {
  requireTargetTimestamp,
  validateWorkingTimeTargetContext,
  validateWorkingTimeTargetSettings,
  type SavedWorkingTimeTargetSettings,
  type WorkingTimeTargetSnapshot,
} from "@/domain/saved-working-time-target";
import { withImmediateTransaction } from "./transaction";

export const WORKING_TIME_TARGET_COLUMNS = [
  "id",
  "settings_json",
  "revision",
  "created_at",
  "updated_at",
] as const;

export function mapWorkingTimeTargetRow(value: unknown): SavedWorkingTimeTargetSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WorkingTimeTargetError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== WORKING_TIME_TARGET_COLUMNS.length ||
    !WORKING_TIME_TARGET_COLUMNS.every((key) => Object.hasOwn(row, key)) ||
    row.id !== "singleton" ||
    typeof row.settings_json !== "string" ||
    !Number.isSafeInteger(row.revision) ||
    (row.revision as number) < 1
  )
    throw new WorkingTimeTargetError();
  const createdAt = requireTargetTimestamp(row.created_at),
    updatedAt = requireTargetTimestamp(row.updated_at);
  if (
    Temporal.Instant.compare(Temporal.Instant.from(createdAt), Temporal.Instant.from(updatedAt)) > 0
  )
    throw new WorkingTimeTargetError();
  return Object.freeze({
    settings: validateWorkingTimeTargetSettings(JSON.parse(row.settings_json)),
    revision: row.revision as number,
    createdAt,
    updatedAt,
  });
}

interface PlanRow {
  readonly id: string;
  readonly date: string;
  readonly revision: number;
  readonly updated_at: string;
  readonly type: string;
  readonly all_day: number;
  readonly break_minutes: number;
  readonly start_time: string | null;
  readonly end_time: string | null;
}
async function readPlan(db: SQLiteDatabase) {
  const profile = await db.getFirstAsync<{ time_zone: string }>(
    "SELECT time_zone FROM user_profile WHERE id='singleton'",
  );
  const shifts = await db.getAllAsync<PlanRow>(
    "SELECT id,date,revision,updated_at,start_time,end_time,type,all_day,break_minutes FROM shift_entries WHERE deleted_at IS NULL ORDER BY date,id",
  );
  const planRevision = canonicalize({ timeZone: profile?.time_zone ?? null, shifts })!;
  const byDate = new Map<string, PlanRow[]>();
  for (const shift of shifts) {
    const day = byDate.get(shift.date) ?? [];
    day.push(shift);
    byDate.set(shift.date, day);
  }
  return { profile, byDate, planRevision };
}
function daySignature(
  plan: Awaited<ReturnType<typeof readPlan>>,
  date: string,
  context: WorkingTimeTargetContext,
  legacy = false,
) {
  const previous = Temporal.PlainDate.from(date).subtract({ days: 1 }).toString();
  const previousShifts = plan.byDate.get(previous) ?? [];
  const shifts = [
    ...previousShifts.filter(
      (shift) =>
        legacy ||
        (shift.all_day === 0 &&
          shift.start_time !== null &&
          shift.end_time !== null &&
          shift.end_time <= shift.start_time),
    ),
    ...(plan.byDate.get(date) ?? []),
  ];
  return canonicalize({
    ...(legacy ? {} : { bindingVersion: 2 }),
    timeZone: plan.profile?.time_zone ?? null,
    work: context.periods
      .filter(
        (period) => period.validFrom <= date && (period.validTo === null || date <= period.validTo),
      )
      .map(({ validFrom: _from, validTo: _to, ...work }) => work),
    employed:
      !context.employment ||
      (context.employment.from <= date &&
        (context.employment.to === null || date <= context.employment.to)),
    shifts: shifts.map((shift) =>
      legacy
        ? {
            id: shift.id,
            date: shift.date,
            revision: shift.revision,
            updated_at: shift.updated_at,
            start_time: shift.start_time,
            end_time: shift.end_time,
          }
        : {
            id: shift.id,
            date: shift.date,
            type: shift.type,
            all_day: shift.all_day,
            break_minutes: shift.break_minutes,
            start_time: shift.start_time,
            end_time: shift.end_time,
          },
    ),
  })!;
}
/** Upgrade only evidence proven unchanged under the old binding. Never re-confirm stale facts. */
async function upgradeUnchangedBindings(
  db: SQLiteDatabase,
  saved: SavedWorkingTimeTargetSettings,
  plan: Awaited<ReturnType<typeof readPlan>>,
) {
  let changed = false;
  const planBindings = saved.settings.planBindings.map((binding) => {
    const signature = daySignature(plan, binding.date, saved.settings.context);
    if (
      binding.signature !== signature &&
      binding.signature === daySignature(plan, binding.date, saved.settings.context, true)
    ) {
      changed = true;
      return { ...binding, signature };
    }
    return binding;
  });
  if (!changed || (await db.getFirstAsync("SELECT month FROM dev_test_backups LIMIT 1")))
    return saved;
  const settings = validateWorkingTimeTargetSettings({ ...saved.settings, planBindings });
  const revision = saved.revision + 1;
  if (!Number.isSafeInteger(revision)) throw new WorkingTimeTargetError();
  const now = new Date().toISOString();
  const updatedAt =
    Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(saved.updatedAt)) < 0
      ? saved.updatedAt
      : now;
  const result = await db.runAsync(
    "UPDATE working_time_target_settings SET settings_json=?,revision=?,updated_at=? WHERE id='singleton' AND revision=?",
    JSON.stringify(settings),
    revision,
    updatedAt,
    saved.revision,
  );
  if (result.changes !== 1)
    throw new WorkingTimeTargetError(
      "Die Sollzeitangaben wurden zwischenzeitlich geändert. Bitte erneut laden.",
    );
  return Object.freeze({ ...saved, settings, revision, updatedAt });
}

async function readSettings(db: SQLiteDatabase): Promise<WorkingTimeTargetSnapshot> {
  const row = await db.getFirstAsync(
    `SELECT ${WORKING_TIME_TARGET_COLUMNS.join(",")} FROM working_time_target_settings WHERE id='singleton'`,
  );
  let saved = row === null ? null : mapWorkingTimeTargetRow(row);
  const plan = await readPlan(db);
  if (saved) saved = await upgradeUnchangedBindings(db, saved, plan);
  const staleDates =
    saved?.settings.planBindings
      .filter(
        (binding) =>
          binding.signature !== daySignature(plan, binding.date, saved!.settings.context) &&
          binding.signature !== daySignature(plan, binding.date, saved!.settings.context, true),
      )
      .map((binding) => binding.date) ?? [];
  const stale = new Set(staleDates);
  const context =
    saved === null
      ? undefined
      : validateWorkingTimeTargetContext({
          ...saved.settings.context,
          days: saved.settings.context.days.map((day) =>
            stale.has(day.date)
              ? { ...day, rosterStatus: "DRAFT", lostMinutes: null, mustWorkElsewhere: null }
              : day,
          ),
        });
  return Object.freeze({
    saved,
    context,
    staleDates: Object.freeze(staleDates),
    planRevision: plan.planRevision,
  });
}
export async function loadWorkingTimeTargetSettings(db: SQLiteDatabase) {
  return withImmediateTransaction(db, readSettings);
}

export async function saveWorkingTimeTargetSettings(
  db: SQLiteDatabase,
  input: {
    readonly context: WorkingTimeTargetContext;
    readonly expected: WorkingTimeTargetSnapshot;
    /** Only a day-specific confirmation action may rebind final roster facts. */
    readonly confirmedDates?: readonly string[];
  },
): Promise<WorkingTimeTargetSnapshot> {
  const context = validateWorkingTimeTargetContext(input.context);
  return withImmediateTransaction(db, async (tx) => {
    if (await tx.getFirstAsync("SELECT month FROM dev_test_backups LIMIT 1"))
      throw new WorkingTimeTargetError("Im Testlabor ist noch ein Testlauf offen.");
    const current = await readSettings(tx);
    if (canonicalize(current.saved) !== canonicalize(input.expected.saved))
      throw new WorkingTimeTargetError(
        "Die Sollzeitangaben wurden zwischenzeitlich geändert. Bitte erneut laden.",
      );
    if (current.planRevision !== input.expected.planRevision)
      throw new WorkingTimeTargetError(
        "Der Dienstplan wurde geändert. Bitte erneut laden und die Angaben prüfen.",
      );
    const plan = await readPlan(tx);
    if (!plan.profile) throw new WorkingTimeTargetError("Bitte zuerst ein Arbeitsprofil anlegen.");
    const confirmed = new Set(input.confirmedDates ?? []);
    const days = new Map(context.days.map((day) => [day.date, day]));
    const oldDays = new Map(current.saved?.settings.context.days.map((day) => [day.date, day]));
    const oldBindings = new Map(
      current.saved?.settings.planBindings.map((binding) => [binding.date, binding]),
    );
    if ([...confirmed].some((date) => days.get(date)?.rosterStatus !== "FINAL"))
      throw new WorkingTimeTargetError();
    const planBindings = context.days.map((day) => {
      const oldDay = oldDays.get(day.date);
      const oldBinding = oldBindings.get(day.date);
      if (day.rosterStatus === "FINAL" && !confirmed.has(day.date)) {
        if (!oldBinding || canonicalize(day) !== canonicalize(oldDay))
          throw new WorkingTimeTargetError(
            "Bitte die Voraussetzungen dieses Tages ausdrücklich bestätigen.",
          );
        return oldBinding;
      }
      return { date: day.date, signature: daySignature(plan, day.date, context) };
    });
    const settings = validateWorkingTimeTargetSettings({ version: 1, context, planBindings });
    const revision = (current.saved?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new WorkingTimeTargetError();
    const now = new Date().toISOString();
    const updatedAt =
      current.saved &&
      Temporal.Instant.compare(
        Temporal.Instant.from(now),
        Temporal.Instant.from(current.saved.updatedAt),
      ) < 0
        ? current.saved.updatedAt
        : now;
    await tx.runAsync(
      "INSERT INTO working_time_target_settings(id,settings_json,revision,created_at,updated_at) VALUES('singleton',?,?,?,?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json,revision=excluded.revision,updated_at=excluded.updated_at",
      JSON.stringify(settings),
      revision,
      current.saved?.createdAt ?? updatedAt,
      updatedAt,
    );
    return readSettings(tx);
  });
}
