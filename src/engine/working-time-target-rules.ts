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

export interface TargetTariffRules {
  readonly part: "BT-K" | "BT-B" | "TV-L § 43" | "TV-H § 43" | "TV-UK";
  readonly label: string;
  readonly forecastQualifier?: string;
  readonly holidayWork:
    | { readonly kind: "TARGET_REDUCTION" }
    | { readonly kind: "SEPARATE_COMPENSATION"; readonly legalBasis: string };
  readonly holiday: TargetRuleSource;
  readonly holidayForecast: TargetRuleSource;
  readonly special: TargetRuleSource;
  readonly specialForecast: TargetRuleSource;
  readonly tvUkLoss?: { readonly actual: TargetRuleSource; readonly forecast: TargetRuleSource };
}

type ReviewedTargetTariff = Extract<TargetTariff, { readonly version: string }>;

export function isReviewedTargetTariff(
  tariff: TargetTariff | undefined,
): tariff is ReviewedTargetTariff {
  return (
    tariff?.kind === "TVOED_K" ||
    tariff?.kind === "TVOED_B" ||
    tariff?.kind === "TVL_KR" ||
    tariff?.kind === "TVH_KR" ||
    tariff?.kind === "TVUK_NURSING"
  );
}

export const TVL_KR_TARGET_REVIEW = {
  version: "2026-02-14",
  from: "2026-01-01",
  to: "2027-12-31",
} as const;

/** The existing KR/section-43 selection suggests a scope; it never confirms an entitlement. */
export function tvlKrTargetTariff(): ReviewedTargetTariff {
  return { kind: "TVL_KR", version: TVL_KR_TARGET_REVIEW.version, scopeConfirmed: null };
}

/** Published 2024 wording plus the 2026 agreement; bounded review, not a tariff expiry. */
export const TVH_KR_TARGET_REVIEW = {
  version: "2026-03-27",
  from: "2026-01-01",
  to: "2027-12-31",
} as const;

/** The KR selection suggests § 43; neither the salary nor Sunday answer confirms its scope. */
export function tvhKrTargetTariff(): ReviewedTargetTariff {
  return { kind: "TVH_KR", version: TVH_KR_TARGET_REVIEW.version, scopeConfirmed: null };
}

export const TVUK_TARGET_REVIEW = {
  version: "2025-01-01",
  from: "2026-01-01",
  to: "2027-12-31",
} as const;

/** Salary and Sunday-work settings suggest a forecast, never confirmed account coverage. */
export function tvUkTargetTariff(): Extract<TargetTariff, { kind: "TVUK_NURSING" }> {
  return {
    kind: "TVUK_NURSING",
    version: TVUK_TARGET_REVIEW.version,
    scopeConfirmed: null,
    accountRuleConfirmed: null,
  };
}

/** Family selection is enough for a forecast, never for an individual confirmed claim. */
export function targetTariffForSector(sector: string | undefined): ReviewedTargetTariff | null {
  if (sector !== "BT_K" && sector !== "BT_B") return null;
  return {
    kind: sector === "BT_K" ? "TVOED_K" : "TVOED_B",
    version: "2026-01-01",
    scopeConfirmed: null,
  };
}

const K_2026: TargetTariffRules = {
  part: "BT-K",
  label: "TVöD-K / BT-K",
  holidayWork: { kind: "TARGET_REDUCTION" },
  holiday: TARGET_RULES.tvoedKHoliday,
  holidayForecast: TARGET_RULES.tvoedKHolidayForecast,
  special: TARGET_RULES.tvoedKSpecial,
  specialForecast: TARGET_RULES.tvoedKSpecialForecast,
};
const K_2027: TargetTariffRules = {
  ...K_2026,
  holiday: TVOED_K_2027_RULES.tvoedKHoliday,
  holidayForecast: TVOED_K_2027_RULES.tvoedKHolidayForecast,
  special: TVOED_K_2027_RULES.tvoedKSpecial,
  specialForecast: TVOED_K_2027_RULES.tvoedKSpecialForecast,
};

/** Own BT-B sources and identities; no inheritance of BT-K entitlements. */
function bRules(year: 2026 | 2027): TargetTariffRules {
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
    holidayWork: { kind: "TARGET_REDUCTION" },
    holiday,
    special,
    holidayForecast: forecast(holiday),
    specialForecast: forecast(special),
  };
}

const B_2026 = bRules(2026),
  B_2027 = bRules(2027);

/** TV-L distinguishes worked holidays from roster-free fifth reductions (BAG 6 AZR 465/15). */
function tvlRules(year: 2026 | 2027): TargetTariffRules {
  const sourceUrl =
    "https://www.tdl-online.de/fileadmin/downloads/TV-L/260812_TV-L__i.d.F._des_%C3%84TV_Nr._14_VT_neu.pdf";
  const holiday = {
    ruleId: `tvl-kr-${year}-43-6-3-8`,
    legalBasis: "§ 43 Nr. 3 Ziff. 2 zu § 6 Abs. 3 Satz 8 TV-L; BAG 6 AZR 465/15",
    sourceUrl,
  };
  const special = {
    ruleId: `tvl-kr-${year}-43-6-3-1-3`,
    legalBasis: "§ 43 Nr. 3 Ziff. 2 zu § 6 Abs. 3 Sätze 1–3 TV-L",
    sourceUrl,
  };
  const forecast = (rule: TargetRuleSource): TargetRuleSource => ({
    ...rule,
    ruleId: rule.ruleId + "-forecast",
    legalBasis: "Planungsreferenz zu " + rule.legalBasis + "; kein bestätigter Tagesanspruch",
  });
  return {
    part: "TV-L § 43",
    label: "TV-L/KR / § 43",
    holidayWork: {
      kind: "SEPARATE_COMPENSATION",
      legalBasis: "§ 43 Nr. 3 Ziff. 2 zu § 6 Abs. 3 Sätze 4–7 TV-L; BAG 6 AZR 465/15",
    },
    holiday,
    holidayForecast: forecast(holiday),
    special,
    specialForecast: forecast(special),
  };
}
const TVL_2026 = tvlRules(2026),
  TVL_2027 = tvlRules(2027);

/** TV-H § 43 is nursing in the prison service, not the TV-L hospital scope. */
function tvhRules(year: 2026 | 2027): TargetTariffRules {
  const sourceUrl =
    "https://innen.hessen.de/sites/innen.hessen.de/files/2023-01/tv-h_fassung_aendtv_nr._20_vom_15.10.2021.pdf";
  const holiday = {
    ruleId: `tvh-kr-${year}-43-6-3-8`,
    legalBasis: "§ 43 Nr. 1 und Nr. 3 Ziff. 2 zu § 6 Abs. 3 Satz 8 TV-H (Justizvollzug)",
    sourceUrl,
  };
  const special = {
    ruleId: `tvh-kr-${year}-43-6-3-1-3`,
    legalBasis: "§ 43 Nr. 3 Ziff. 2 zu § 6 Abs. 3 Sätze 1–3 TV-H",
    sourceUrl,
  };
  const forecast = (rule: TargetRuleSource): TargetRuleSource => ({
    ...rule,
    ruleId: rule.ruleId + "-forecast",
    legalBasis: "Planungsreferenz zu " + rule.legalBasis + "; kein bestätigter Tagesanspruch",
  });
  return {
    part: "TV-H § 43",
    label: "TV-H (Justizvollzug)",
    forecastQualifier:
      "Planwert für dienstplanmäßig freie Feiertage. Feiertagsarbeit und Freizeitausgleich bleiben getrennt.",
    holidayWork: {
      kind: "SEPARATE_COMPENSATION",
      legalBasis: "§ 43 Nr. 3 Ziff. 2 zu § 6 Abs. 3 Sätze 4–7 TV-H",
    },
    holiday,
    holidayForecast: forecast(holiday),
    special,
    specialForecast: forecast(special),
  };
}
const TVH_2026 = tvhRules(2026),
  TVH_2027 = tvhRules(2027);

function tvUkRules(year: 2026 | 2027): TargetTariffRules {
  const sourceUrl =
    "https://agu-uniklinika.de/wp-content/uploads/2025/07/01_TV-UK_durchgeschrieben-Fassung-Ae9-vom-03.07.2024.pdf";
  const account = {
    ruleId: `tvuk-${year}-13-4-b`,
    legalBasis: "§ 13 Abs. 1 und Abs. 4 Buchst. b TV-UK (Kontenbereich, Montag bis Freitag)",
    sourceUrl,
  };
  const loss = {
    ruleId: `tvuk-${year}-8-3`,
    legalBasis: "§ 8 Abs. 3 Sätze 1–2 TV-UK (ausgefallene Stunden außerhalb des Kontenbereichs)",
    sourceUrl,
  };
  const forecast = (rule: TargetRuleSource): TargetRuleSource => ({
    ...rule,
    ruleId: rule.ruleId + "-forecast",
    legalBasis: "Planungsreferenz zu " + rule.legalBasis + "; kein bestätigter Tagesanspruch",
  });
  return {
    part: "TV-UK",
    label: "TV-UK Pflege BW",
    holidayWork: { kind: "TARGET_REDUCTION" },
    holiday: account,
    special: account,
    holidayForecast: forecast(account),
    specialForecast: forecast(account),
    tvUkLoss: { actual: loss, forecast: forecast(loss) },
  };
}
const TVUK_2026 = tvUkRules(2026),
  TVUK_2027 = tvUkRules(2027);
const TARGET_TARIFF_REVIEWS = {
  TVUK_NURSING: [
    {
      from: TVUK_TARGET_REVIEW.from,
      to: "2026-12-31",
      versions: [TVUK_TARGET_REVIEW.version],
      rules: TVUK_2026,
    },
    {
      from: "2027-01-01",
      to: TVUK_TARGET_REVIEW.to,
      versions: [TVUK_TARGET_REVIEW.version],
      rules: TVUK_2027,
    },
  ],
  TVOED_K: [
    { ...TVOED_K_TARGET_REVIEW, versions: ["2026-01-01"], rules: K_2026 },
    { from: "2027-01-01", to: "2027-12-31", versions: ["2026-01-01", "2027-01-01"], rules: K_2027 },
  ],
  TVOED_B: [
    { from: "2026-01-01", to: "2026-12-31", versions: ["2026-01-01"], rules: B_2026 },
    { from: "2027-01-01", to: "2027-12-31", versions: ["2026-01-01", "2027-01-01"], rules: B_2027 },
  ],
  TVL_KR: [
    {
      from: "2026-01-01",
      to: "2026-12-31",
      versions: [TVL_KR_TARGET_REVIEW.version],
      rules: TVL_2026,
    },
    {
      from: "2027-01-01",
      to: "2027-12-31",
      versions: [TVL_KR_TARGET_REVIEW.version],
      rules: TVL_2027,
    },
  ],
  TVH_KR: [
    {
      from: TVH_KR_TARGET_REVIEW.from,
      to: "2026-12-31",
      versions: [TVH_KR_TARGET_REVIEW.version],
      rules: TVH_2026,
    },
    {
      from: "2027-01-01",
      to: TVH_KR_TARGET_REVIEW.to,
      versions: [TVH_KR_TARGET_REVIEW.version],
      rules: TVH_2027,
    },
  ],
} as const;

/** Bounded legal review; not a tariff expiry or salary-table validity. */
export function reviewedTargetTariffRules(
  tariff: ReviewedTargetTariff,
  date: string,
): TargetTariffRules | null {
  return (
    TARGET_TARIFF_REVIEWS[tariff.kind].find(
      (review) =>
        date >= review.from &&
        date <= review.to &&
        review.versions.some((accepted) => accepted === tariff.version),
    )?.rules ?? null
  );
}

/** Provenance for a pending zero-minute line outside review coverage; never grants a deduction. */
export function knownTargetTariffRules(kind: ReviewedTargetTariff["kind"]): TargetTariffRules {
  return {
    TVOED_K: K_2026,
    TVOED_B: B_2026,
    TVL_KR: TVL_2026,
    TVH_KR: TVH_2026,
    TVUK_NURSING: TVUK_2026,
  }[kind];
}
