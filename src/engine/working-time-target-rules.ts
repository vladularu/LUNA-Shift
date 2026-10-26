import type { TargetTariff } from "@/domain/working-time-target";

const TVOED_AT_SOURCES = {
  2026: "https://www.kav-hessen.de/sites/default/files/2025-11/2fc7b3ed3c5d1eb8f6d08a3898a6af26/tvoed-at_ifv_aetv-22_1-1-26.pdf",
  2027: "https://www.kav-hessen.de/sites/default/files/2025-10/3822d822d89695ead0c2eed7e8b1f1aa/tvoed-at_ifv_aetv-22_1-1-27.pdf",
} as const;

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
    sourceUrl: TVOED_AT_SOURCES[2026],
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
    sourceUrl: TVOED_AT_SOURCES[2026],
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
    sourceUrl: TVOED_AT_SOURCES[2027],
  },
  tvoedKSpecialForecast: {
    ...TARGET_RULES.tvoedKSpecialForecast,
    ruleId: "tvoed-k-2027-at-6-3-forecast",
    sourceUrl: TVOED_AT_SOURCES[2027],
  },
} as const;

export interface TargetRuleSource {
  readonly ruleId: string;
  readonly legalBasis: string;
  readonly sourceUrl: string;
}

export interface TvoedTargetRules {
  readonly part: "BT-K" | "BT-B";
  readonly label: string;
  readonly holiday: TargetRuleSource;
  readonly holidayForecast: TargetRuleSource;
  readonly special: TargetRuleSource;
  readonly specialForecast: TargetRuleSource;
}

type TvoedTargetTariff = Extract<TargetTariff, { readonly version: string }>;

export function isTvoedTargetTariff(tariff: TargetTariff | undefined): tariff is TvoedTargetTariff {
  return tariff?.kind === "TVOED_K" || tariff?.kind === "TVOED_B";
}

/** Family selection is enough for a forecast, never for an individual confirmed claim. */
export function targetTariffForSector(sector: string | undefined): TvoedTargetTariff | null {
  if (sector !== "BT_K" && sector !== "BT_B") return null;
  return {
    kind: sector === "BT_K" ? "TVOED_K" : "TVOED_B",
    version: "2026-01-01",
    scopeConfirmed: null,
  };
}

const K_2026: TvoedTargetRules = {
  part: "BT-K",
  label: "TVöD-K / BT-K",
  holiday: TARGET_RULES.tvoedKHoliday,
  holidayForecast: TARGET_RULES.tvoedKHolidayForecast,
  special: TARGET_RULES.tvoedKSpecial,
  specialForecast: TARGET_RULES.tvoedKSpecialForecast,
};
const K_2027: TvoedTargetRules = {
  ...K_2026,
  holiday: TVOED_K_2027_RULES.tvoedKHoliday,
  holidayForecast: TVOED_K_2027_RULES.tvoedKHolidayForecast,
  special: TVOED_K_2027_RULES.tvoedKSpecial,
  specialForecast: TVOED_K_2027_RULES.tvoedKSpecialForecast,
};

/** Own BT-B sources and identities; no inheritance of BT-K entitlements. */
function bRules(year: 2026 | 2027): TvoedTargetRules {
  const prefix = "tvoed-b-" + year;
  const holiday = {
    ruleId: prefix + "-btb-49-2",
    legalBasis: "§ 49 Abs. 2 BT-B (durchgeschrieben § 6.1 Abs. 2 TVöD-B)",
    sourceUrl:
      "https://vka.de/wp-content/uploads/2026/04/BT-B_AETV_19_Lesefassung_Stand-01_01_2026.pdf",
  };
  const special = {
    ruleId: prefix + "-at-6-3",
    legalBasis: "§ 6 Abs. 3 TVöD-AT i.V.m. BT-B",
    sourceUrl: TVOED_AT_SOURCES[year],
  };
  const forecast = (source: TargetRuleSource): TargetRuleSource => ({
    ...source,
    ruleId: source.ruleId + "-forecast",
    legalBasis: "Planungsreferenz zu " + source.legalBasis + "; kein bestätigter Tagesanspruch",
  });
  return {
    part: "BT-B",
    label: "TVöD-B / BT-B",
    holiday,
    special,
    holidayForecast: forecast(holiday),
    specialForecast: forecast(special),
  };
}

const B_2026 = bRules(2026),
  B_2027 = bRules(2027);
const TVOED_TARGET_REVIEWS = {
  TVOED_K: [
    { ...TVOED_K_TARGET_REVIEW, versions: ["2026-01-01"], rules: K_2026 },
    { from: "2027-01-01", to: "2027-12-31", versions: ["2026-01-01", "2027-01-01"], rules: K_2027 },
  ],
  TVOED_B: [
    { from: "2026-01-01", to: "2026-12-31", versions: ["2026-01-01"], rules: B_2026 },
    { from: "2027-01-01", to: "2027-12-31", versions: ["2026-01-01", "2027-01-01"], rules: B_2027 },
  ],
} as const;

/** Bounded legal review; not a tariff expiry or salary-table validity. */
export function reviewedTvoedTargetRules(
  tariff: TvoedTargetTariff,
  date: string,
): TvoedTargetRules | null {
  return (
    TVOED_TARGET_REVIEWS[tariff.kind].find(
      (review) =>
        date >= review.from &&
        date <= review.to &&
        review.versions.some((accepted) => accepted === tariff.version),
    )?.rules ?? null
  );
}

/** Provenance for a pending zero-minute line outside review coverage; never grants a deduction. */
export function knownTvoedTargetRules(kind: TvoedTargetTariff["kind"]): TvoedTargetRules {
  return kind === "TVOED_K" ? K_2026 : B_2026;
}
