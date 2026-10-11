import type { MonthlyNetPaySettings } from "./net-pay-profile";

export function settings(month = "2026-07"): MonthlyNetPaySettings {
  return {
    version: 1,
    month,
    profile: {
      birthDate: "1990-01-15",
      taxClass: 1,
      factorPermille: null,
      churchTaxRatePercent: 0,
      childAllowanceHalfUnits: 0,
      isParent: false,
      childrenUnder25: 0,
      worksInSaxony: false,
      healthAdditionalRateBps: 290,
      monthlyTaxAllowanceCents: 0,
    },
    specialCases: [],
    sfnBasicHourlyPayCents: null,
  };
}
