/** Reviewed calculation rules, independent of salary tables and premium rates. */
export const TARGET_RULES = {
  fixedHoliday: {
    ruleId: "fixed-schedule-holiday-relief-v1",
    legalBasis: "§ 2 Abs. 1 EFZG (Abbildung der ausgefallenen festen Arbeitszeit)",
    sourceUrl: "https://www.gesetze-im-internet.de/entgfg/__2.html",
  },
  legacyHoliday: {
    ruleId: "legacy-weekday-holiday-estimate-v1",
    legalBasis: "Bisheriges LUNA-Referenzmodell; kein bestätigter individueller Tarifanspruch",
    sourceUrl: "https://github.com/vladularu/LUNA-Shift",
  },
  tvoedKHoliday: {
    ruleId: "tvoed-k-2026-btk-49-2",
    legalBasis: "§ 49 Abs. 2 BT-K (durchgeschrieben § 6.1 Abs. 2 TVöD-K); BAG 6 AZR 143/16",
    sourceUrl:
      "https://www.kav-hessen.de/sites/default/files/2025-10/979d02cb9b03b2676c0cf0c73671e000/bt-k_ifv_aetv-15_1-1-26.pdf",
  },
  tvoedKSpecial: {
    ruleId: "tvoed-k-2026-at-6-3",
    legalBasis: "§ 6 Abs. 3 TVöD-AT i.V.m. BT-K; BAG 6 AZR 143/16",
    sourceUrl:
      "https://www.kav-hessen.de/sites/default/files/2025-11/2fc7b3ed3c5d1eb8f6d08a3898a6af26/tvoed-at_ifv_aetv-22_1-1-26.pdf",
  },
  fixedHolidayForecast: {
    ruleId: "fixed-schedule-holiday-forecast-v1",
    legalBasis: "Planungsreferenz zu § 2 Abs. 1 EFZG; kein bestätigter Tagesanspruch",
    sourceUrl: "https://www.gesetze-im-internet.de/entgfg/__2.html",
  },
  tvoedKHolidayForecast: {
    ruleId: "tvoed-k-2026-btk-49-2-forecast",
    legalBasis: "Planungsreferenz zu § 49 Abs. 2 BT-K; kein bestätigter Tagesanspruch",
    sourceUrl:
      "https://www.kav-hessen.de/sites/default/files/2025-10/979d02cb9b03b2676c0cf0c73671e000/bt-k_ifv_aetv-15_1-1-26.pdf",
  },
  tvoedKSpecialForecast: {
    ruleId: "tvoed-k-2026-at-6-3-forecast",
    legalBasis:
      "Planungsreferenz zu § 6 Abs. 3 TVöD-AT i.V.m. BT-K; kein bestätigter Tagesanspruch",
    sourceUrl:
      "https://www.kav-hessen.de/sites/default/files/2025-11/2fc7b3ed3c5d1eb8f6d08a3898a6af26/tvoed-at_ifv_aetv-22_1-1-26.pdf",
  },
} as const;

/** Review coverage, not a claim that the tariff expires on 2026-12-31. */
export const TVOED_K_TARGET_REVIEW = {
  version: "2026-01-01",
  from: "2026-01-01",
  to: "2026-12-31",
} as const;

/** Rule identity and source snapshot follow the calculation date, not a profile rewrite. */
const TVOED_K_2027_RULES = {
  tvoedKHoliday: {
    ...TARGET_RULES.tvoedKHoliday,
    ruleId: "tvoed-k-2027-btk-49-2",
  },
  tvoedKHolidayForecast: {
    ...TARGET_RULES.tvoedKHolidayForecast,
    ruleId: "tvoed-k-2027-btk-49-2-forecast",
  },
  tvoedKSpecial: {
    ...TARGET_RULES.tvoedKSpecial,
    ruleId: "tvoed-k-2027-at-6-3",
    sourceUrl:
      "https://www.kav-hessen.de/sites/default/files/2025-10/3822d822d89695ead0c2eed7e8b1f1aa/tvoed-at_ifv_aetv-22_1-1-27.pdf",
  },
  tvoedKSpecialForecast: {
    ...TARGET_RULES.tvoedKSpecialForecast,
    ruleId: "tvoed-k-2027-at-6-3-forecast",
    sourceUrl:
      "https://www.kav-hessen.de/sites/default/files/2025-10/3822d822d89695ead0c2eed7e8b1f1aa/tvoed-at_ifv_aetv-22_1-1-27.pdf",
  },
} as const;

export interface TargetRuleSource {
  readonly ruleId: string;
  readonly legalBasis: string;
  readonly sourceUrl: string;
}

export interface TvoedKTargetRules {
  readonly tvoedKHoliday: TargetRuleSource;
  readonly tvoedKHolidayForecast: TargetRuleSource;
  readonly tvoedKSpecial: TargetRuleSource;
  readonly tvoedKSpecialForecast: TargetRuleSource;
}

/** Coverage is a bounded legal review, not a tariff expiry or salary-table validity. */
const TVOED_K_TARGET_REVIEWS = [
  { ...TVOED_K_TARGET_REVIEW, versions: ["2026-01-01"], rules: TARGET_RULES },
  {
    from: "2027-01-01",
    to: "2027-12-31",
    // The relevant clauses are unchanged: ongoing 2026 profiles need no migration.
    versions: ["2026-01-01", "2027-01-01"],
    rules: TVOED_K_2027_RULES,
  },
] as const;

export function reviewedTvoedKTargetRules(date: string, version: string): TvoedKTargetRules | null {
  return (
    TVOED_K_TARGET_REVIEWS.find(
      (review) =>
        date >= review.from &&
        date <= review.to &&
        review.versions.some((accepted) => accepted === version),
    )?.rules ?? null
  );
}
