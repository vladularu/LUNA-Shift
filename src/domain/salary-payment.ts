import { Temporal } from "@js-temporal/polyfill";
import type { MonthlyPayEstimate, ShiftEntry, UserProfile } from "./types";

export type SalaryPerspective = "PAYOUT" | "EARNED";
export type SalaryPaymentLag = 0 | 1 | 2 | null;
export type SalaryPaymentSocialInsuranceAttribution = "UNKNOWN" | "CASH_VARIABLE";
export const SALARY_PAYMENT_GROUPS = [
  "PREMIUMS",
  "MONTHLY_ALLOWANCE",
  "HOURLY_ALLOWANCE",
  "OVERTIME",
  "SPECIAL_DUTY",
] as const;
export type SalaryPaymentGroup = (typeof SALARY_PAYMENT_GROUPS)[number];
export type SalaryPaymentDelays = Readonly<Record<SalaryPaymentGroup, SalaryPaymentLag>>;

export interface SalaryPaymentPeriod {
  readonly effectiveMonth: string;
  readonly delays: SalaryPaymentDelays;
}

export interface SalaryPaymentPreferences {
  readonly version: 1;
  readonly periods: readonly SalaryPaymentPeriod[];
  /** Explicit confirmation of an empty service month, never inferred from absent entries. */
  readonly reviewedEmptyMonths: readonly string[];
  /** Explicit employer method for regularly delayed variable pay; never applies to monthly allowances. */
  readonly socialInsuranceAttribution?: SalaryPaymentSocialInsuranceAttribution;
}

export interface SalaryPaymentSource {
  readonly month: string;
  readonly profile: UserProfile;
  readonly shifts: readonly ShiftEntry[];
  readonly pay: MonthlyPayEstimate;
}

export interface SalaryPaymentContribution {
  readonly group: SalaryPaymentGroup | "BASE" | "CARE_ALLOWANCE" | "TARIFF_ALLOWANCE";
  readonly claimMonth: string;
  readonly paymentMonth: string | null;
  readonly amountCents: number;
}

export interface SalaryPaymentIssue {
  readonly kind: "UNCONFIGURED" | "MISSING_MONTH" | "UNAVAILABLE";
  readonly month: string;
  readonly group?: SalaryPaymentGroup;
  readonly message: string;
}

export interface SalaryPaymentProjection {
  readonly perspective: SalaryPerspective;
  readonly month: string;
  readonly pay: MonthlyPayEstimate;
  readonly sources: readonly SalaryPaymentSource[];
  readonly contributions: readonly SalaryPaymentContribution[];
  /** Current claims deferred beyond this payout, kept separate from the included cash total. */
  readonly outgoingContributions?: readonly SalaryPaymentContribution[];
  readonly issues: readonly SalaryPaymentIssue[];
  readonly warnings: readonly string[];
  readonly available: boolean;
}

export const SALARY_PAYMENT_KEY = "salary_payment_v1";
export const DEFAULT_SALARY_PAYMENT_PREFERENCES: SalaryPaymentPreferences = Object.freeze({
  version: 1,
  periods: Object.freeze([]),
  reviewedEmptyMonths: Object.freeze([]),
  socialInsuranceAttribution: "UNKNOWN",
});

/** A suggestion for supported TVöD profiles; it only takes effect after saving. */
export const SUGGESTED_TVOED_PAYMENT_DELAYS: SalaryPaymentDelays = Object.freeze({
  PREMIUMS: 2,
  MONTHLY_ALLOWANCE: 0,
  HOURLY_ALLOWANCE: 2,
  OVERTIME: 2,
  SPECIAL_DUTY: 2,
});

export class SalaryPaymentValidationError extends Error {
  constructor() {
    super("Die Angaben zu den Auszahlungsmonaten sind ungültig. Bitte erneut prüfen.");
    this.name = "SalaryPaymentValidationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

export function requireSalaryPaymentMonth(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    throw new SalaryPaymentValidationError();
  try {
    if (Temporal.PlainYearMonth.from(value).toString() !== value)
      throw new SalaryPaymentValidationError();
  } catch {
    throw new SalaryPaymentValidationError();
  }
  return value;
}

export function addSalaryPaymentMonths(month: string, delta: number): string {
  return Temporal.PlainYearMonth.from(requireSalaryPaymentMonth(month))
    .add({ months: delta })
    .toString();
}

export function validateSalaryPaymentPreferences(value: unknown): SalaryPaymentPreferences {
  if (
    !record(value) ||
    !exact(value, [
      "version",
      "periods",
      "reviewedEmptyMonths",
      ...(Object.hasOwn(value, "socialInsuranceAttribution") ? ["socialInsuranceAttribution"] : []),
    ]) ||
    value.version !== 1 ||
    !Array.isArray(value.periods) ||
    value.periods.length > 1200 ||
    !Array.isArray(value.reviewedEmptyMonths) ||
    value.reviewedEmptyMonths.length > 2400 ||
    (value.socialInsuranceAttribution !== undefined &&
      !["UNKNOWN", "CASH_VARIABLE"].includes(value.socialInsuranceAttribution as string))
  )
    throw new SalaryPaymentValidationError();
  const periods = value.periods.map((period): SalaryPaymentPeriod => {
    if (
      !record(period) ||
      !exact(period, ["effectiveMonth", "delays"]) ||
      !record(period.delays) ||
      !exact(period.delays, SALARY_PAYMENT_GROUPS)
    )
      throw new SalaryPaymentValidationError();
    const effectiveMonth = requireSalaryPaymentMonth(period.effectiveMonth);
    const suppliedDelays = period.delays;
    if (
      !SALARY_PAYMENT_GROUPS.every(
        (group) =>
          suppliedDelays[group] === null || [0, 1, 2].includes(suppliedDelays[group] as number),
      )
    )
      throw new SalaryPaymentValidationError();
    const delays = Object.fromEntries(
      SALARY_PAYMENT_GROUPS.map((group) => [group, suppliedDelays[group]]),
    ) as Record<SalaryPaymentGroup, SalaryPaymentLag>;
    return Object.freeze({ effectiveMonth, delays: Object.freeze(delays) });
  });
  const reviewedEmptyMonths = value.reviewedEmptyMonths.map(requireSalaryPaymentMonth);
  if (
    new Set(periods.map((period) => period.effectiveMonth)).size !== periods.length ||
    new Set(reviewedEmptyMonths).size !== reviewedEmptyMonths.length
  )
    throw new SalaryPaymentValidationError();
  periods.sort((left, right) => left.effectiveMonth.localeCompare(right.effectiveMonth));
  reviewedEmptyMonths.sort();
  return Object.freeze({
    version: 1,
    periods: Object.freeze(periods),
    reviewedEmptyMonths: Object.freeze(reviewedEmptyMonths),
    socialInsuranceAttribution: (value.socialInsuranceAttribution ??
      "UNKNOWN") as SalaryPaymentSocialInsuranceAttribution,
  });
}

export function resolveSalaryPaymentPeriod(
  preferences: SalaryPaymentPreferences,
  claimMonth: string,
): SalaryPaymentPeriod | null {
  requireSalaryPaymentMonth(claimMonth);
  let selected: SalaryPaymentPeriod | null = null;
  for (const period of preferences.periods)
    if (
      period.effectiveMonth <= claimMonth &&
      (selected === null || period.effectiveMonth > selected.effectiveMonth)
    )
      selected = period;
  return selected;
}

export function setSalaryPaymentPeriod(
  preferences: SalaryPaymentPreferences,
  period: SalaryPaymentPeriod,
): SalaryPaymentPreferences {
  return validateSalaryPaymentPreferences({
    ...preferences,
    periods: [
      ...preferences.periods.filter((item) => item.effectiveMonth !== period.effectiveMonth),
      period,
    ],
  });
}

export function setSalaryPaymentEmptyMonth(
  preferences: SalaryPaymentPreferences,
  month: string,
  reviewed: boolean,
): SalaryPaymentPreferences {
  requireSalaryPaymentMonth(month);
  const months = new Set(preferences.reviewedEmptyMonths);
  if (reviewed) months.add(month);
  else months.delete(month);
  return validateSalaryPaymentPreferences({ ...preferences, reviewedEmptyMonths: [...months] });
}

export function salaryComponentPaymentMonth(
  preferences: SalaryPaymentPreferences,
  claimMonth: string,
  group: SalaryPaymentGroup,
): string | null {
  const period = resolveSalaryPaymentPeriod(preferences, claimMonth);
  // Without an explicit timing choice, preserve the existing same-month view.
  const lag = period === null ? 0 : period.delays[group];
  return lag == null ? null : addSalaryPaymentMonths(claimMonth, lag);
}

/** One explicit choice applies to every possible source of the displayed payout. */
export function setSalaryPaymentLag(
  preferences: SalaryPaymentPreferences,
  paymentMonth: string,
  lag: Exclude<SalaryPaymentLag, null>,
): SalaryPaymentPreferences {
  if (![0, 1, 2].includes(lag)) throw new SalaryPaymentValidationError();
  const effectiveMonth = addSalaryPaymentMonths(paymentMonth, -2);
  const delays = Object.fromEntries(
    SALARY_PAYMENT_GROUPS.map((group) => [group, lag]),
  ) as SalaryPaymentDelays;
  return validateSalaryPaymentPreferences({
    ...preferences,
    periods: [
      ...preferences.periods.filter((period) => period.effectiveMonth < effectiveMonth),
      { effectiveMonth, delays },
    ],
  });
}

export function salaryPaymentSources(
  preferences: SalaryPaymentPreferences,
  paymentMonth: string,
  group: SalaryPaymentGroup,
): { readonly months: readonly string[]; readonly unresolvedMonths: readonly string[] } {
  requireSalaryPaymentMonth(paymentMonth);
  const months: string[] = [];
  const unresolvedMonths: string[] = [];
  for (const delta of [-2, -1, 0]) {
    const month = addSalaryPaymentMonths(paymentMonth, delta);
    const target = salaryComponentPaymentMonth(preferences, month, group);
    if (target === null) unresolvedMonths.push(month);
    else if (target === paymentMonth) months.push(month);
  }
  return { months: Object.freeze(months), unresolvedMonths: Object.freeze(unresolvedMonths) };
}
