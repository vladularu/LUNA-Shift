import type { SfnShift } from "./net-pay-sfn";

export interface DutyOvertimeRates {
  readonly baseHourlyCents: number;
  readonly premiumHourlyCents: number;
  readonly premiumBasisPoints: number;
}

export interface DutyCalloutPay {
  readonly actualMinutes: number;
  readonly paidMinutes: number | null;
  readonly baseAmountCents: number | null;
  readonly overtimePremiumCents: number | null;
  readonly rates: DutyOvertimeRates | null;
  readonly timePremiumCents?: number | null;
  readonly timeCreditMinutes?: number | null;
  readonly mandatoryRestMinutes?: number;
  readonly payrollTraces?: readonly SfnShift[];
  readonly notes: readonly string[];
}

export interface SpecialDutyPayLine {
  readonly shiftId: string;
  readonly date: string;
  readonly title: string;
  readonly source: string | null;
  readonly durationMinutes: number;
  readonly paidHours: number | null;
  readonly hourlyCents: number | null;
  /** Known base amount only; null means unknown, never an assumed zero. */
  readonly baseAmountCents: number | null;
  readonly calloutPay?: DutyCalloutPay;
  readonly standbyPay?: StandbyPay;
  readonly complete: boolean;
  readonly notes: readonly string[];
}

export interface StandbyPay {
  readonly actualMinutes: number;
  readonly weightedMinutes: number | null;
  readonly factorBasisPoints: number | null;
  readonly hourlyCents: number | null;
  readonly payGroup: string | null;
  readonly baseAmountCents: number | null;
  readonly overtimePremiumCents: number | null;
  readonly nightPremiumCents: number | null;
  readonly holidayPremiumCents: number | null;
  readonly sundayPremiumCents: number | null;
  readonly cashAmountCents: number | null;
  /** Derived planned credit; never an external employer booking. */
  readonly timeCreditMinutes: number | null;
  readonly mandatoryRestMinutes: number | null;
  readonly payrollTrace?: SfnShift;
  readonly notes: readonly string[];
}

export interface SpecialDutyTimeCredit {
  readonly shiftId: string;
  readonly date: string;
  readonly title: string;
  readonly recordedMinutes: number;
  readonly creditedMinutes: number | null;
  readonly settlement: "UNKNOWN" | "PAY" | "TIME_OFF";
  readonly notes: readonly string[];
}
