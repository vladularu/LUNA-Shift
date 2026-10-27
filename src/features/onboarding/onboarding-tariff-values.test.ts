import { describe, expect, it } from "vitest";
import { validateProfile } from "@/domain/validation";
import { SALARY_BASIS_OPTIONS } from "@/features/settings/salary-basis-options";
import {
  EMPTY_TARIFF_SELECTION,
  onboardingTariffErrors,
  onboardingTariffProfile,
  type OnboardingTariffMode,
  type OnboardingTariffSelection,
} from "./onboarding-tariff-values";

const cases: readonly [OnboardingTariffMode, Partial<OnboardingTariffSelection>, string][] = [
  ["TVOED_P", { group: "P8", level: 4, sector: "BT_K", tariffRegion: "OTHER" }, "tariff"],
  ["TVOED_E", { group: "E8", level: 4, sector: "BT_K", tariffRegion: "OTHER" }, "vkaETariff"],
  ["TVL_KR", { group: "KR8", level: 4, universityRegion: "WEST" }, "tvlKrTariff"],
  ["TVH_KR", { group: "KR5", level: "1a", fullTime: 2310 }, "tvhKrTariff"],
  ["TVUK_NURSING", { group: "PUK8", level: 7 }, "tvUkNursingTariff"],
  [
    "TVAOED_PFLEGE",
    { trainingYear: 2, sector: "BT_K", tariffRegion: "OTHER" },
    "nursingTrainingTariff",
  ],
  ["TVAL_PFLEGE", { trainingYear: 3, universityRegion: "EAST" }, "tvalPflegeTariff"],
];
describe("onboarding tariff contracts", () => {
  it.each(cases)(
    "validates %s through the existing profile contract without confirming check evidence",
    (mode, fields, key) => {
      const salary = onboardingTariffProfile({ ...EMPTY_TARIFF_SELECTION, mode, ...fields }, 1800);
      const profile = validateProfile({
        ...salary,
        federalState: "NW",
        holidayRegion: "NONE",
        weeklyMinutes: 1800,
        timeZone: "Europe/Berlin",
        industry: "HEALTHCARE",
      });
      expect(salary[key as keyof typeof salary]).toBeTruthy();
      expect(Object.values(salary).filter((value) => value !== null)).toHaveLength(1);
      expect(profile.allEmploymentWorkRecorded).toBeNull();
      expect(profile.regularRotatingNightWork).toBeNull();
      expect(profile.sundayHolidayWorkEligible).toBeNull();
    },
  );
  it("covers every selectable tariff from settings", () => {
    expect(cases.map(([mode]) => mode).sort()).toEqual(
      SALARY_BASIS_OPTIONS.filter((option) => !["UNSET", "MANUAL"].includes(option.value))
        .map((option) => option.value)
        .sort(),
    );
  });
  it("refuses unknown selections, incompatible stages and missing tariff regions", () => {
    expect(() => onboardingTariffProfile(EMPTY_TARIFF_SELECTION, 1800)).toThrow();
    expect(
      onboardingTariffErrors(
        {
          ...EMPTY_TARIFF_SELECTION,
          mode: "TVOED_P",
          group: "P7",
          level: 1,
          sector: "BT_K",
          tariffRegion: "OTHER",
        },
        1800,
      ),
    ).toHaveProperty("level");
    expect(
      onboardingTariffErrors(
        { ...EMPTY_TARIFF_SELECTION, mode: "TVUK_NURSING", group: "PUK10", level: 7 },
        1800,
      ),
    ).toHaveProperty("level");
    expect(
      onboardingTariffErrors(
        { ...EMPTY_TARIFF_SELECTION, mode: "TVOED_P", group: "P8", level: 4, sector: "BT_K" },
        1800,
      ),
    ).toHaveProperty("tariffRegion");
    expect(
      onboardingTariffErrors(
        { ...EMPTY_TARIFF_SELECTION, mode: "TVH_KR", group: "KR5", level: "1a", fullTime: 2310 },
        2400,
      ),
    ).toHaveProperty("hours");
  });
});

it.each(["SECTION_43", "GENERAL", null] as const)(
  "keeps optional TVA-L workplace %s in the existing onboarding contract",
  (tvalEmployerScope) => {
    const salary = onboardingTariffProfile(
      {
        ...EMPTY_TARIFF_SELECTION,
        mode: "TVAL_PFLEGE",
        trainingYear: 2,
        universityRegion: "WEST",
        tvalEmployerScope,
      },
      2310,
    );
    expect(salary.tvalPflegeTariff).toEqual({
      trainingYear: 2,
      universityRegion: "WEST",
      ...(tvalEmployerScope ? { employerScope: tvalEmployerScope } : {}),
    });
  },
);
