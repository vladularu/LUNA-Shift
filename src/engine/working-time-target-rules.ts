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
