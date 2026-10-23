import type { FederalState, HolidayRegion, UserProfile } from "@/domain/types";

export type WorkingTimeTargetProfile = Pick<UserProfile, "federalState" | "weeklyMinutes"> &
  Partial<Pick<UserProfile, "holidayRegion">>;

export type TargetWorkModel =
  | {
      readonly kind: "FIXED_WEEK";
      /** Monday through Sunday; contractual distribution, before holiday relief. */
      readonly weekdayMinutes: readonly [number, number, number, number, number, number, number];
    }
  | {
      readonly kind: "ROTATING_FIVE_IN_SEVEN";
      /** Explicit employer calculation basis, not the actual days worked. */
      readonly monthlyReference: "WEEKDAYS_ONE_FIFTH";
      readonly sevenDayShiftPlanConfirmed: boolean | null;
    }
  | { readonly kind: "UNKNOWN" };

export type TargetTariff =
  | { readonly kind: "TVOED_K"; readonly version: string; readonly scopeConfirmed: boolean | null }
  | { readonly kind: "CUSTOM" }
  | { readonly kind: "UNVERIFIED"; readonly id: string };

/** Separate dated working-time facts; never infer them from a salary table. */
export interface TargetProfilePeriod {
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly weeklyMinutes: number;
  readonly federalState: FederalState;
  readonly holidayRegion: HolidayRegion;
  readonly model: TargetWorkModel;
  readonly tariff: TargetTariff;
}

export interface TargetDayFact {
  readonly date: string;
  readonly rosterStatus: "FINAL" | "DRAFT";
  readonly disposition: "WORK_REQUIRED" | "ROSTER_FREE" | "RELEASED" | "UNKNOWN";
  /** Confirmed hours lost, not worked hours and not a premium setting. */
  readonly lostMinutes?: number | null;
  readonly mustWorkElsewhere?: boolean | null;
}

export interface WorkingTimeTargetContext {
  readonly periods: readonly TargetProfilePeriod[];
  readonly days: readonly TargetDayFact[];
  /** Explicit bounds distinguish joining/leaving from missing historical data. */
  readonly employment?: { readonly from: string; readonly to: string | null };
}

export interface TargetAdjustment {
  readonly date: string;
  readonly kind: "STATUTORY_HOLIDAY" | "TARIFF_SPECIAL_DAY";
  readonly label: string;
  readonly minutes: number;
  readonly ruleId: string;
  readonly legalBasis: string;
  readonly sourceUrl: string;
  readonly condition: string;
  readonly status: "CONFIRMED" | "PENDING" | "LEGACY_ESTIMATE";
}

export interface TargetNotice {
  readonly date: string | null;
  readonly code: string;
  readonly message: string;
  readonly affectsTarget: boolean;
}

export interface DailyWorkingTimeTarget {
  readonly date: string;
  readonly baseMinutes: number;
  readonly statutoryReductionMinutes: number;
  readonly tariffReductionMinutes: number;
  readonly roundingMinutes: number;
  /** Can be negative on a Saturday: an accounting reduction, not negative work. */
  readonly targetMinutes: number | null;
}

export interface MonthlyWorkingTimeTarget {
  readonly month: string;
  readonly status: "FINAL" | "PROVISIONAL" | "UNAVAILABLE";
  readonly baseMinutes: number;
  readonly statutoryReductionMinutes: number;
  readonly tariffReductionMinutes: number;
  readonly roundingMinutes: number;
  readonly targetMinutes: number | null;
  readonly adjustments: readonly TargetAdjustment[];
  readonly notices: readonly TargetNotice[];
  readonly days: readonly DailyWorkingTimeTarget[];
}
