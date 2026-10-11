import { Temporal } from "@js-temporal/polyfill";

import type { NetPayProfile, NetPaySpecialCase } from "./net-pay";
import { validateNetPayAutomation, type NetPayAutomation } from "./net-pay-automation";

export interface MonthlyNetPaySettings {
  readonly version: 1 | 2;
  readonly month: string;
  readonly profile: NetPayProfile;
  readonly specialCases: readonly NetPaySpecialCase[];
  readonly sfnBasicHourlyPayCents: number | null;
  /** Version 2 is effective from month, until another dated version 2 profile. */
  readonly automation?: NetPayAutomation;
}

export interface SavedMonthlyNetPaySettings {
  readonly settings: MonthlyNetPaySettings;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const PROFILE_KEYS = [
  "birthDate",
  "taxClass",
  "factorPermille",
  "churchTaxRatePercent",
  "childAllowanceHalfUnits",
  "isParent",
  "childrenUnder25",
  "worksInSaxony",
  "healthAdditionalRateBps",
  "monthlyTaxAllowanceCents",
] as const;
const SPECIAL_CASES: readonly NetPaySpecialCase[] = [
  "PRIVATE_INSURANCE",
  "MINIJOB",
  "MIDIJOB",
  "MULTIPLE_EMPLOYMENTS",
  "ONE_OFF_PAYMENT",
  "ADDITIONAL_DEDUCTIONS",
  "PARTIAL_MONTH",
  "PENSIONER",
  "APPRENTICE",
  "OTHER_INSURANCE_STATUS",
];

export class NetPayProfileValidationError extends Error {
  constructor() {
    super("Die monatlichen Steuer- oder Versicherungsangaben sind ungültig oder unvollständig.");
    this.name = "NetPayProfileValidationError";
  }
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Shared by storage and computation; calculation support is checked separately. */
export function isNetPayProfileValid(value: unknown): value is NetPayProfile {
  if (!record(value)) return false;
  if (typeof value.birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.birthDate))
    return false;
  try {
    Temporal.PlainDate.from(value.birthDate, { overflow: "reject" });
  } catch {
    return false;
  }
  return (
    integer(value.taxClass, 1, 6) &&
    [0, 8, 9].includes(value.churchTaxRatePercent as number) &&
    integer(value.childAllowanceHalfUnits, 0, 20) &&
    integer(value.childrenUnder25, 0, 20) &&
    typeof value.isParent === "boolean" &&
    typeof value.worksInSaxony === "boolean" &&
    (value.isParent || value.childrenUnder25 === 0) &&
    integer(value.healthAdditionalRateBps, 0, 10_000) &&
    integer(value.monthlyTaxAllowanceCents, 0, 10_000_000) &&
    (value.factorPermille === null ||
      (value.taxClass === 4 && integer(value.factorPermille, 1, 999))) &&
    (value.taxClass <= 4 || value.childAllowanceHalfUnits === 0)
  );
}

export function requireNetPaySettingsMonth(value: unknown): string {
  if (typeof value !== "string" || !/^(19\d{2}|[2-3]\d{3}|40\d{2})-(0[1-9]|1[0-2])$/.test(value))
    throw new NetPayProfileValidationError();
  return value;
}

export function validateMonthlyNetPaySettings(value: unknown): MonthlyNetPaySettings {
  const version = record(value) ? value.version : null;
  if (
    !record(value) ||
    !exactKeys(value, [
      "version",
      "month",
      "profile",
      "specialCases",
      "sfnBasicHourlyPayCents",
      ...(version === 2 ? ["automation"] : []),
    ]) ||
    (version !== 1 && version !== 2)
  )
    throw new NetPayProfileValidationError();
  const month = requireNetPaySettingsMonth(value.month);
  const profile = value.profile;
  if (!record(profile) || !exactKeys(profile, PROFILE_KEYS) || !isNetPayProfileValid(profile))
    throw new NetPayProfileValidationError();
  try {
    if (typeof profile.birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate))
      throw new NetPayProfileValidationError();
    const birthDate = Temporal.PlainDate.from(profile.birthDate, { overflow: "reject" });
    if (
      birthDate.year < 1900 ||
      Temporal.PlainDate.compare(birthDate, Temporal.PlainDate.from(`${month}-01`)) > 0
    )
      throw new NetPayProfileValidationError();
  } catch {
    throw new NetPayProfileValidationError();
  }
  if (
    !Array.isArray(value.specialCases) ||
    !value.specialCases.every((item) => SPECIAL_CASES.includes(item)) ||
    new Set(value.specialCases).size !== value.specialCases.length
  )
    throw new NetPayProfileValidationError();
  if (
    value.sfnBasicHourlyPayCents !== null &&
    !integer(value.sfnBasicHourlyPayCents, 1, 10_000_000)
  )
    throw new NetPayProfileValidationError();
  return Object.freeze({
    version,
    month,
    profile: Object.freeze({ ...profile }),
    specialCases: Object.freeze([...value.specialCases]),
    sfnBasicHourlyPayCents: value.sfnBasicHourlyPayCents,
    ...(version === 2 ? { automation: validateNetPayAutomation(value.automation) } : {}),
  });
}

/** Monthly v1 records stay local to their month; v2 is only inherited forwards. */
export function resolveNetPaySettings(
  month: string,
  timeline: readonly SavedMonthlyNetPaySettings[],
): SavedMonthlyNetPaySettings | null {
  requireNetPaySettingsMonth(month);
  const seen = new Set<string>();
  const candidates = timeline.map((row) => {
    const settings = validateMonthlyNetPaySettings(row.settings);
    if (seen.has(settings.month)) throw new NetPayProfileValidationError();
    seen.add(settings.month);
    return row;
  });
  const exact = candidates.find((row) => row.settings.month === month);
  if (exact) return exact;
  return (
    candidates
      .filter((row) => row.settings.version === 2 && row.settings.month <= month)
      .sort((a, b) => b.settings.month.localeCompare(a.settings.month))[0] ?? null
  );
}
