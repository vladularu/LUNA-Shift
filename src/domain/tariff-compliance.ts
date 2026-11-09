/** Recorded tariff facts, not a legal certification or a persisted personal setting. */
export interface TariffComplianceEvidence {
  readonly tariffLabel: string;
  readonly ruleId: string;
  readonly status: "REVIEW" | "DEVIATION" | "PENDING" | "UNAVAILABLE";
  /** Both local calendar dates are inclusive. */
  readonly period: { readonly from: string; readonly until: string };
  readonly source: {
    readonly title: string;
    readonly url: string;
    readonly section: string;
    readonly version: string;
  };
  readonly ruleText: string;
  readonly requirements: readonly string[];
  readonly recordedDates?: readonly string[];
  readonly count?: number;
  readonly limit?: number;
}
