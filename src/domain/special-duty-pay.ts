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
  readonly complete: boolean;
  readonly notes: readonly string[];
}
