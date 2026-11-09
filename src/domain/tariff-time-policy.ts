import type { TariffComplianceEvidence } from "./tariff-compliance";

type BaseFamily = "TVOED_K" | "TVOED_B" | "TVL_KR" | "TVL_GENERAL" | "TVH_KR" | "TVUK";
export type TariffTimeFamily = BaseFamily | "TVAOED_K" | "TVAOED_B" | "TVAL_KR" | "TVAL_GENERAL";
type Source = TariffComplianceEvidence["source"];

const tvoed: Source = {
  title: "TVöD – Allgemeiner Teil",
  url: "https://www.vka.de/assets/media/docs/0/Tarifvertr%C3%A4ge/TVoeD_AT_AETV_22_Lesefassung_Stand_01_01_2026.pdf",
  section: "§ 6 Abs. 1 Satz 3",
  version: "01.01.2026",
};
const tvl: Source = {
  title: "TV-L",
  url: "https://www.gesetze-bayern.de/Content/Document/TV_L-6",
  section: "§ 6 Abs. 1 Satz 3",
  version: "01.07.2026",
};
const tvh: Source = {
  title: "TV-H",
  url: "https://innen.hessen.de/sites/innen.hessen.de/files/2023-01/tv-h_fassung_aendtv_nr._20_vom_15.10.2021.pdf",
  section: "§ 6 Abs. 1 und § 43",
  version: "Mantel 2024; Einigung 27.03.2026 geprüft",
};
const tvuk: Source = {
  title: "TV-UK Baden-Württemberg",
  url: "https://agu-uniklinika.de/wp-content/uploads/2025/07/01_TV-UK_durchgeschrieben-Fassung-Ae9-vom-03.07.2024.pdf",
  section: "§ 8 Abs. 2",
  version: "ÄTV 9, gültig ab 01.01.2025",
};

export interface TariffTimePolicy {
  readonly family: TariffTimeFamily;
  readonly label: string;
  readonly source: Source;
  readonly freeSource: Source | null;
  readonly averageFive: boolean;
  readonly sixthDayReason: "notwendige" | "dringende";
  readonly consecutiveFreeDays: boolean;
  readonly ruleText: string;
  readonly freeRuleText: string;
}

const regularFive = (reason: "notwendige" | "dringende") =>
  `Die regelmäßige Arbeitszeit wird auf fünf Tage verteilt. Sechs Tage erfordern ${reason} betriebliche oder dienstliche Gründe.`;
const twoFree =
  "Bei regelmäßiger Sonn- und Feiertagsarbeit sind innerhalb von zwei Wochen zwei arbeitsfreie Tage vorgesehen. Einer soll auf einen Sonntag fallen.";

/** Review coverage is not the legal expiry of a tariff. */
export const TARIFF_TIME_REVIEW = {
  from: "2026-01-01",
  until: "2026-12-31",
  version: "2026-11-08",
} as const;

const basePolicies: Readonly<Record<BaseFamily, TariffTimePolicy>> = {
  TVOED_K: {
    family: "TVOED_K",
    label: "TVöD · BT-K",
    source: tvoed,
    freeSource: {
      title: "TVöD – Besonderer Teil Krankenhäuser",
      url: "https://www.kavsh.de/download/lesefassung-tvoed-bt-k-01012026",
      section: "§ 49 Abs. 3",
      version: "01.01.2026",
    },
    averageFive: false,
    sixthDayReason: "notwendige",
    consecutiveFreeDays: false,
    ruleText: regularFive("notwendige"),
    freeRuleText: twoFree,
  },
  TVOED_B: {
    family: "TVOED_B",
    label: "TVöD · BT-B",
    source: tvoed,
    freeSource: {
      title: "TVöD – Besonderer Teil Pflege und Betreuung",
      url: "https://www.kavsh.de/download/lesefassung-tvoed-bt-b-01012026",
      section: "§ 49 Abs. 3",
      version: "01.01.2026",
    },
    averageFive: false,
    sixthDayReason: "notwendige",
    consecutiveFreeDays: false,
    ruleText: regularFive("notwendige"),
    freeRuleText: twoFree,
  },
  TVL_KR: {
    family: "TVL_KR",
    label: "TV-L · Pflege",
    source: tvl,
    freeSource: {
      title: "TV-L – Sonderregelungen Krankenhäuser",
      url: "https://www.gesetze-bayern.de/Content/Document/TV_L-43",
      section: "§ 43 Nr. 3",
      version: "01.07.2026",
    },
    averageFive: false,
    sixthDayReason: "dringende",
    consecutiveFreeDays: false,
    ruleText: regularFive("dringende"),
    freeRuleText: twoFree,
  },
  TVL_GENERAL: {
    family: "TVL_GENERAL",
    label: "TV-L",
    source: tvl,
    freeSource: null,
    averageFive: false,
    sixthDayReason: "dringende",
    consecutiveFreeDays: false,
    ruleText: regularFive("dringende"),
    freeRuleText: "",
  },
  TVH_KR: {
    family: "TVH_KR",
    label: "TV-H · Pflege",
    source: tvh,
    freeSource: { ...tvh, section: "§ 43 Nr. 3" },
    averageFive: false,
    sixthDayReason: "dringende",
    consecutiveFreeDays: false,
    ruleText: regularFive("dringende"),
    freeRuleText: twoFree,
  },
  TVUK: {
    family: "TVUK",
    label: "TV-UK · Pflege BW",
    source: tvuk,
    freeSource: { ...tvuk, section: "§ 11 Abs. 2" },
    averageFive: true,
    sixthDayReason: "notwendige",
    consecutiveFreeDays: true,
    ruleText:
      "Die regelmäßige Arbeitszeit wird auf durchschnittlich fünf Tage verteilt. Aus notwendigen betrieblichen Gründen sind bis zu sechs Tage pro Woche möglich.",
    freeRuleText:
      "Bei regelmäßiger Sonn- und Feiertagsarbeit sind innerhalb von zwei Wochen mindestens zwei zusammenhängende freie Tage vorgesehen. Einer soll auf einen Sonntag fallen.",
  },
};

const tvaoed: Source = {
  title: "TVAöD – Besonderer Teil Pflege",
  url: "https://vka.de/wp-content/uploads/2026/04/TVAOED_BT-Pflege_AETV_18_Lesefassung_Stand_01_07_2025.pdf",
  section: "§ 7 Abs. 1 in Verbindung mit § 6 TVöD",
  version: "ÄTV 18, Stand 01.07.2025",
};
const tval: Source = {
  title: "TVA-L Pflege",
  url: "https://www.gesetze-bayern.de/Content/Document/TVA_L_Pflege-7",
  section: "§ 7 Abs. 1 in Verbindung mit § 6 TV-L",
  version: "§ 7 Abs. 1; ÄTV 13 vom 14.02.2026 gegengeprüft",
};
function trainingPolicy(
  base: BaseFamily,
  family: TariffTimeFamily,
  label: string,
  source: Source,
): TariffTimePolicy {
  return {
    ...basePolicies[base],
    family,
    label,
    source,
    ruleText: `Für Erwachsene gilt das Beschäftigten-Arbeitszeitrecht des Ausbildenden. ${basePolicies[base].ruleText}`,
    freeRuleText: `Bei entsprechender Verweisung auf diesen Beschäftigtenbereich gilt: ${basePolicies[base].freeRuleText}`,
  };
}
export const TARIFF_TIME_POLICIES: Readonly<Record<TariffTimeFamily, TariffTimePolicy>> = {
  ...basePolicies,
  TVAOED_K: trainingPolicy("TVOED_K", "TVAOED_K", "TVAöD Pflege · BT-K", tvaoed),
  TVAOED_B: trainingPolicy("TVOED_B", "TVAOED_B", "TVAöD Pflege · BT-B", tvaoed),
  TVAL_KR: trainingPolicy("TVL_KR", "TVAL_KR", "TVA-L Pflege · § 43", tval),
  TVAL_GENERAL: trainingPolicy("TVL_GENERAL", "TVAL_GENERAL", "TVA-L Pflege", tval),
};

export const TARIFF_SCOPE_SOURCE: Source = {
  title: "LUNA – Umfang der Tarifprüfung",
  url: "https://github.com/vladularu/LUNA-Shift",
  section: "Keine hinreichend bestimmte Tarifgrundlage",
  version: TARIFF_TIME_REVIEW.version,
};

/** Cached result metadata never authorizes arbitrary external links. */
export function isTariffSourceUrl(url: string): boolean {
  return (
    url === TARIFF_SCOPE_SOURCE.url ||
    Object.values(TARIFF_TIME_POLICIES).some(
      (policy) => policy.source.url === url || policy.freeSource?.url === url,
    )
  );
}
