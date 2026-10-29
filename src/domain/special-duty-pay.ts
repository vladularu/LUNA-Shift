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
  readonly complete: boolean;
  readonly notes: readonly string[];
}
