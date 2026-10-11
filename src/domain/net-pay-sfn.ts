import type {
  NetPayAmounts,
  NetPayCalculationBasis,
  NetPayProfile,
  NetPayResult,
  NetPaySpecialCase,
} from "./net-pay";
import type { FederalState, HolidayRegion } from "./types";

/** Minute-precision Berlin local time with explicit offset, including at DST transitions. */
export interface SfnTimeRange {
  readonly start: string;
  readonly end: string;
}

export type SfnPremiumCategory = "NIGHT" | "SUNDAY" | "HOLIDAY" | "SATURDAY" | "OTHER";

export interface SfnPremiumPayment {
  readonly id: string;
  readonly kind: "NIGHT" | "DAY" | "OTHER";
  /** Display category from the tariff; it never determines tax eligibility. */
  readonly category?: SfnPremiumCategory;
  readonly amountCents: number;
  readonly additionalToBasicPay: boolean;
  /** Uniform remuneration across these intervals, excluding unpaid breaks. */
  readonly periods: readonly SfnTimeRange[];
}

export interface SfnShift extends SfnTimeRange {
  readonly id: string;
  /** null means unknown; [] explicitly confirms that no unpaid break is deducted. */
  readonly unpaidBreaks: readonly SfnTimeRange[] | null;
  /** Paid pauses are also excluded from actual SFN work. Their cash remains taxable. */
  readonly paidBreaks?: readonly SfnTimeRange[];
  readonly payments: readonly SfnPremiumPayment[];
}

export interface SfnPayrollInput {
  readonly month: string;
  readonly completeGross: boolean;
  readonly grossCents: number;
  readonly regularMonthlySocialInsuranceGrossCents: number;
  /** Explicitly determined § 3b basic hourly pay, not the tariff premium reference rate. */
  readonly basicHourlyPayCents: number | null;
  readonly workplace: {
    readonly federalState: FederalState;
    readonly holidayRegion: HolidayRegion;
  } | null;
  readonly workEvidence: "PLANNED" | "RECORDED";
  /** Default WORK_MINUTES keeps paid premium minutes in month. Planned salary forecasts
   * use SHIFT_START to attribute the complete shift cash to its start month. */
  readonly monthAttribution?: "WORK_MINUTES" | "SHIFT_START";
  readonly shifts: readonly SfnShift[];
}

export interface SfnShiftClassification {
  readonly shiftId: string;
  readonly workedMinutes: number;
  readonly nightMinutes: number;
  readonly dayMinutes: number;
  readonly paidPremiumCents: number;
  readonly taxFreeCents: number;
  readonly socialInsuranceFreeCents: number;
  readonly taxablePremiumCents: number;
  readonly socialInsuranceLiablePremiumCents: number;
  readonly premiumBreakdown: readonly {
    readonly category: SfnPremiumCategory;
    readonly paidPremiumCents: number;
    readonly taxFreeCents: number;
    readonly taxablePremiumCents: number;
  }[];
}

export type SfnClassificationResult =
  | {
      readonly status: "available";
      readonly ruleVersion: "DE-SFN-2026-PROTOTYPE";
      readonly calculationBasis?: NetPayCalculationBasis;
      readonly workEvidence: SfnPayrollInput["workEvidence"];
      readonly amounts: NetPayAmounts;
      readonly shifts: readonly SfnShiftClassification[];
      readonly paidPremiumCents: number;
      readonly taxFreeCents: number;
      readonly socialInsuranceFreeCents: number;
    }
  | { readonly status: "missing-data" | "invalid-input" | "unsupported"; readonly reason: string };

export interface SfnNetPayInput {
  readonly payroll: SfnPayrollInput;
  readonly profile: NetPayProfile | null;
  readonly specialCases: readonly NetPaySpecialCase[];
}

export type SfnNetPayResult =
  | {
      readonly status: "available";
      readonly classification: Extract<SfnClassificationResult, { status: "available" }>;
      readonly pay: Extract<NetPayResult, { status: "available" }>;
    }
  | { readonly status: "unavailable"; readonly stage: "sfn" | "net-pay"; readonly reason: string };
