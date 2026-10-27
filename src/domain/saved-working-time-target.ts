import { Temporal } from "@js-temporal/polyfill";
import type { WorkingTimeTargetContext } from "./working-time-target";
import { validateTargetInputs, WorkingTimeTargetError } from "./working-time-target-validation";

export interface WorkingTimeTargetSettings {
  readonly version: 1;
  readonly context: WorkingTimeTargetContext;
  readonly planBindings: readonly { readonly date: string; readonly signature: string }[];
}
export interface SavedWorkingTimeTargetSettings {
  readonly settings: WorkingTimeTargetSettings;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface WorkingTimeTargetSnapshot {
  readonly saved: SavedWorkingTimeTargetSettings | null;
  /** undefined preserves legacy mode; an explicit empty history does not. */
  readonly context: WorkingTimeTargetContext | undefined;
  readonly staleDates: readonly string[];
  /** Optimistic snapshot of the app's plan at editor load time. Never a legal confirmation. */
  readonly planRevision: string;
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WorkingTimeTargetError();
  const record = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new WorkingTimeTargetError();
  return record;
}
function list(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new WorkingTimeTargetError();
  return value;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** JSON boundary and the engine share the same semantic validator. No second calculation. */
export function validateWorkingTimeTargetContext(value: unknown): WorkingTimeTargetContext {
  const context = exact(value, ["periods", "days"], ["employment"]);
  for (const item of list(context.periods, 1000)) {
    const period = exact(item, [
      "validFrom",
      "validTo",
      "weeklyMinutes",
      "federalState",
      "holidayRegion",
      "model",
      "tariff",
    ]);
    const model = exact(
      period.model,
      ["kind"],
      ["weekdayMinutes", "monthlyReference", "sevenDayShiftPlanConfirmed"],
    );
    if (model.kind === "FIXED_WEEK") {
      exact(model, ["kind", "weekdayMinutes"]);
      list(model.weekdayMinutes, 7);
    } else if (model.kind === "ROTATING_FIVE_IN_SEVEN")
      exact(model, ["kind", "monthlyReference", "sevenDayShiftPlanConfirmed"]);
    else exact(model, ["kind"]);
    const tariff = exact(
      period.tariff,
      ["kind"],
      ["version", "scopeConfirmed", "id", "accountRuleConfirmed"],
    );
    if (tariff.kind === "TVUK_NURSING")
      exact(tariff, ["kind", "version", "scopeConfirmed", "accountRuleConfirmed"]);
    else if (
      tariff.kind === "TVOED_K" ||
      tariff.kind === "TVOED_B" ||
      tariff.kind === "TVL_KR" ||
      tariff.kind === "TVH_KR" ||
      tariff.kind === "TVAOED_K" ||
      tariff.kind === "TVAOED_B"
    )
      exact(tariff, ["kind", "version", "scopeConfirmed"]);
    else if (tariff.kind === "UNVERIFIED") {
      exact(tariff, ["kind", "id"]);
      if (typeof tariff.id !== "string" || tariff.id.length > 200)
        throw new WorkingTimeTargetError();
    } else exact(tariff, ["kind"]);
  }
  for (const item of list(context.days, 50000))
    exact(item, ["date", "rosterStatus", "disposition"], ["lostMinutes", "mustWorkElsewhere"]);
  if (context.employment !== undefined) exact(context.employment, ["from", "to"]);
  const clone = JSON.parse(JSON.stringify(context)) as WorkingTimeTargetContext;
  validateTargetInputs("2000-01", { weeklyMinutes: 0, federalState: "HE" }, clone);
  return freeze(clone);
}

export function validateWorkingTimeTargetSettings(value: unknown): WorkingTimeTargetSettings {
  const settings = exact(value, ["version", "context", "planBindings"]);
  if (settings.version !== 1)
    throw new WorkingTimeTargetError(
      "Diese Version der Sollzeitangaben wird noch nicht unterstützt.",
    );
  const context = validateWorkingTimeTargetContext(settings.context);
  const dates = new Set<string>();
  const dayDates = new Set(context.days.map((day) => day.date));
  const planBindings = list(settings.planBindings, 50000).map((value) => {
    const binding = exact(value, ["date", "signature"]);
    if (
      typeof binding.date !== "string" ||
      typeof binding.signature !== "string" ||
      binding.signature.length > 100000 ||
      dates.has(binding.date) ||
      !dayDates.has(binding.date)
    )
      throw new WorkingTimeTargetError();
    dates.add(binding.date);
    return { date: binding.date, signature: binding.signature };
  });
  if (planBindings.length !== context.days.length) throw new WorkingTimeTargetError();
  return freeze({ version: 1, context, planBindings });
}

export function requireTargetTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new WorkingTimeTargetError();
  try {
    Temporal.Instant.from(value);
  } catch {
    throw new WorkingTimeTargetError();
  }
  return value;
}
