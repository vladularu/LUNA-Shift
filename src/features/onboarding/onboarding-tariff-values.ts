import { Temporal } from "@js-temporal/polyfill";
import { tariffFullTimeWeeklyMinutes } from "@/domain/employment-profile";
import { UserFacingError } from "@/domain/errors";
import {
  PAY_GROUPS,
  payLevelsForGroup,
  type PayGroup,
  type PayLevel,
  type FederalState,
  type SaveProfileInput,
  type TariffRegion,
  type TariffSector,
  type VkaETariff,
} from "@/domain/types";
import { VKA_E_GROUPS, ePayLevels } from "@/domain/vka-e-tariff";
import {
  TVL_KR_GROUPS,
  tvlKrLevelsForGroup,
  type TvlKrGroup,
  type TvlKrUniversityRegion,
} from "@/domain/tvl-kr-tariff";
import {
  TVH_KR_GROUPS,
  tvhKrLevelsForGroup,
  type TvhKrGroup,
  type TvhKrPayLevel,
} from "@/domain/tvh-kr-tariff";
import {
  TVUK_NURSING_GROUPS,
  tvUkLevelsForGroup,
  type TvUkNursingGroup,
  type TvUkPayLevel,
} from "@/domain/tvuk-nursing-tariff";
import { getTvlKrUniversityFullTimeMinutes } from "@/engine/simple-tvl-kr-pay";
import { getTvalPflegeFullTimeMinutes } from "@/engine/simple-tval-pflege-pay";
import type { SalaryMode } from "@/features/settings/settings-form-values";

export type OnboardingTariffMode = Exclude<SalaryMode, "MANUAL" | "UNSET">;
export interface OnboardingTariffSelection {
  readonly mode: OnboardingTariffMode | null;
  readonly group: string | null;
  readonly level: string | number | null;
  readonly sector: TariffSector | null;
  readonly tariffRegion: TariffRegion | null;
  readonly universityRegion: TvlKrUniversityRegion | null;
  readonly trainingYear: 1 | 2 | 3 | null;
  readonly fullTime: 2310 | 2400 | null;
}
export const EMPTY_TARIFF_SELECTION: OnboardingTariffSelection = {
  mode: null,
  group: null,
  level: null,
  sector: null,
  tariffRegion: null,
  universityRegion: null,
  trainingYear: null,
  fullTime: null,
};
export type OnboardingTariffErrors = Partial<
  Record<
    | "tariff"
    | "group"
    | "level"
    | "sector"
    | "tariffRegion"
    | "region"
    | "year"
    | "fulltime"
    | "hours",
    string
  >
>;
export function isTrainingTariff(mode: OnboardingTariffMode | null): boolean {
  return mode === "TVAOED_PFLEGE" || mode === "TVAL_PFLEGE";
}
export function onboardingTariffGroups(mode: OnboardingTariffMode | null): readonly string[] {
  switch (mode) {
    case "TVOED_P":
      return PAY_GROUPS;
    case "TVOED_E":
      return VKA_E_GROUPS;
    case "TVL_KR":
      return TVL_KR_GROUPS;
    case "TVH_KR":
      return TVH_KR_GROUPS;
    case "TVUK_NURSING":
      return TVUK_NURSING_GROUPS;
    default:
      return [];
  }
}
export function onboardingTariffLevels(
  mode: OnboardingTariffMode | null,
  group: string | null,
): readonly (string | number)[] {
  if (!group || !onboardingTariffGroups(mode).includes(group)) return [];
  switch (mode) {
    case "TVOED_P":
      return payLevelsForGroup(group as PayGroup);
    case "TVOED_E":
      return ePayLevels(group as VkaETariff["payGroup"]);
    case "TVL_KR":
      return tvlKrLevelsForGroup(group as TvlKrGroup);
    case "TVH_KR":
      return tvhKrLevelsForGroup(group as TvhKrGroup);
    case "TVUK_NURSING":
      return tvUkLevelsForGroup(group as TvUkNursingGroup);
    default:
      return [];
  }
}
export function onboardingTariffFullTime(selection: OnboardingTariffSelection): number | null {
  const date = Temporal.Now.plainDateISO("Europe/Berlin").toString();
  switch (selection.mode) {
    case "TVL_KR":
      return selection.universityRegion
        ? getTvlKrUniversityFullTimeMinutes(date, selection.universityRegion)
        : null;
    case "TVAL_PFLEGE":
      return selection.universityRegion
        ? getTvalPflegeFullTimeMinutes(date, selection.universityRegion)
        : null;
    case "TVH_KR":
      return selection.fullTime;
    case "TVUK_NURSING":
      return 2310;
    case "TVAOED_PFLEGE":
      return selection.sector === "BT_K" ? 2310 : selection.sector === "BT_B" ? 2340 : null;
    default:
      return selection.sector && selection.tariffRegion
        ? tariffFullTimeWeeklyMinutes(selection.sector, selection.tariffRegion)
        : null;
  }
}
export function onboardingTariffErrors(
  selection: OnboardingTariffSelection,
  weeklyMinutes: number,
): OnboardingTariffErrors {
  const errors: OnboardingTariffErrors = {};
  if (!selection.mode) return { tariff: "Bitte wähle deinen Tarifvertrag." };
  if (isTrainingTariff(selection.mode)) {
    if (![1, 2, 3].includes(selection.trainingYear ?? 0))
      errors.year = "Bitte wähle dein Ausbildungsjahr.";
  } else {
    if (!selection.group || !onboardingTariffGroups(selection.mode).includes(selection.group))
      errors.group = "Bitte wähle deine Entgeltgruppe.";
    if (
      selection.level === null ||
      !onboardingTariffLevels(selection.mode, selection.group).includes(selection.level)
    )
      errors.level = "Bitte wähle deine Stufe.";
  }
  if (["TVOED_P", "TVOED_E", "TVAOED_PFLEGE"].includes(selection.mode)) {
    if (!selection.sector) errors.sector = "Bitte wähle deinen Tarifbereich.";
    if (!selection.tariffRegion) errors.tariffRegion = "Bitte wähle dein Tarifgebiet.";
  }
  if (["TVL_KR", "TVAL_PFLEGE"].includes(selection.mode) && !selection.universityRegion)
    errors.region = "Bitte wähle dein Tarifgebiet.";
  if (selection.mode === "TVH_KR" && !selection.fullTime)
    errors.fulltime = "Bitte wähle die tarifliche Vollzeit.";
  if (Object.keys(errors).length === 0 && !["TVOED_P", "TVOED_E"].includes(selection.mode)) {
    const fullTime = onboardingTariffFullTime(selection);
    if (!fullTime || weeklyMinutes > fullTime)
      errors.hours =
        "Bitte prüfe deine Wochenstunden. Sie liegen über der tariflichen Vollzeit oder die Zeitgrundlage fehlt.";
  }
  return errors;
}

type SalaryFields = Pick<
  SaveProfileInput,
  | "tariff"
  | "manualMonthlyGrossCents"
  | "nursingTrainingTariff"
  | "vkaETariff"
  | "tvlKrTariff"
  | "tvUkNursingTariff"
  | "tvhKrTariff"
  | "tvalPflegeTariff"
>;
export function onboardingTariffProfile(
  selection: OnboardingTariffSelection,
  weeklyMinutes: number,
): SalaryFields {
  const error = Object.values(onboardingTariffErrors(selection, weeklyMinutes)).find(Boolean);
  if (error) throw new UserFacingError(error);
  const base: SalaryFields = {
    tariff: null,
    manualMonthlyGrossCents: null,
    nursingTrainingTariff: null,
    vkaETariff: null,
    tvlKrTariff: null,
    tvUkNursingTariff: null,
    tvhKrTariff: null,
    tvalPflegeTariff: null,
  };
  switch (selection.mode) {
    case "TVOED_P":
      return {
        ...base,
        tariff: {
          payGroup: selection.group as PayGroup,
          payLevel: selection.level as PayLevel,
          sector: selection.sector!,
          tariffRegion: selection.tariffRegion!,
          fullTimeWeeklyMinutes: onboardingTariffFullTime(selection)!,
        },
      };
    case "TVOED_E":
      return {
        ...base,
        vkaETariff: {
          payGroup: selection.group as VkaETariff["payGroup"],
          payLevel: selection.level as PayLevel,
          sector: selection.sector!,
          tariffRegion: selection.tariffRegion!,
        },
      };
    case "TVL_KR":
      return {
        ...base,
        tvlKrTariff: {
          payGroup: selection.group as TvlKrGroup,
          payLevel: selection.level as PayLevel,
          universityRegion: selection.universityRegion!,
        },
      };
    case "TVUK_NURSING":
      return {
        ...base,
        tvUkNursingTariff: {
          payGroup: selection.group as TvUkNursingGroup,
          payLevel: selection.level as TvUkPayLevel,
        },
      };
    case "TVH_KR":
      return {
        ...base,
        tvhKrTariff: {
          payGroup: selection.group as TvhKrGroup,
          payLevel: selection.level as TvhKrPayLevel,
          fullTimeWeeklyMinutes: selection.fullTime!,
        },
      };
    case "TVAOED_PFLEGE":
      return {
        ...base,
        nursingTrainingTariff: {
          trainingYear: selection.trainingYear!,
          sector: selection.sector!,
          tariffRegion: selection.tariffRegion!,
        },
      };
    case "TVAL_PFLEGE":
      return {
        ...base,
        tvalPflegeTariff: {
          trainingYear: selection.trainingYear!,
          universityRegion: selection.universityRegion!,
        },
      };
    default:
      throw new UserFacingError("Bitte wähle deinen Tarifvertrag.");
  }
}

export function onboardingTariffRegionMismatch(
  mode: OnboardingTariffMode | null,
  federalState: FederalState | null,
): string | null {
  if (!federalState) return null;
  if (mode === "TVH_KR" && federalState !== "HE")
    return "Dieser Tarif gehört zu Hessen. Bitte prüfe, ob er für dich gilt.";
  if (mode === "TVUK_NURSING" && federalState !== "BW")
    return "Dieser Tarif gehört zu Baden-Württemberg. Bitte prüfe, ob er für dich gilt.";
  return null;
}
