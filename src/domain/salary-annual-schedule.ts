import type { UserProfile } from "./types";

/** Regular dates only. Early/actual payments and reduced entitlements need confirmation.
 * Sources and draft boundaries: docs/jahressonderzahlung-netto-2026.md.
 */
export const SALARY_ANNUAL_SCHEDULES = {
  TVOED_P: { label: "TVöD-P", months: [11], followingYearMonths: [] },
  TVOED_E: { label: "TVöD VKA E / Anlage A", months: [11], followingYearMonths: [] },
  TVOED_SUE: { label: "TVöD SuE", months: [11], followingYearMonths: [] },
  TVL_KR: { label: "TV-L / KR", months: [11], followingYearMonths: [] },
  TVH_KR: { label: "TV-H / KR", months: [11], followingYearMonths: [] },
  TVUK: { label: "TV-UK Pflege", months: [11], followingYearMonths: [] },
  TVAOED: { label: "TVAöD Pflege", months: [11], followingYearMonths: [] },
  TVAL: { label: "TVA-L Pflege", months: [11], followingYearMonths: [] },
  CARITAS: { label: "AVR Caritas Pflege (Anlagen 31/32)", months: [11], followingYearMonths: [] },
  DRK: {
    label: "DRK-Reformtarifvertrag E/P/S und Ausbildung",
    months: [11],
    followingYearMonths: [],
  },
  AVR_DD: {
    label: "AVR-DD (Anspruch und betriebliche Kürzungen prüfen)",
    months: [11],
    followingYearMonths: [6],
  },
  OWN: { label: "Eigene Vergütung / Haustarif", months: [], followingYearMonths: [] },
} as const;
export type SalaryAnnualFamily = keyof typeof SALARY_ANNUAL_SCHEDULES;

export function annualPayoutMonths(
  family: SalaryAnnualFamily,
  entitlementYear: number,
): readonly string[] {
  if (
    !Number.isInteger(entitlementYear) ||
    entitlementYear < 1900 ||
    entitlementYear > 4099 ||
    (family === "AVR_DD" && entitlementYear > 4098)
  )
    throw new Error("Ungültiges Anspruchsjahr.");
  const rule = SALARY_ANNUAL_SCHEDULES[family];
  return [
    ...rule.months.map((m) => `${entitlementYear}-${String(m).padStart(2, "0")}`),
    ...rule.followingYearMonths.map((m) => `${entitlementYear + 1}-${String(m).padStart(2, "0")}`),
  ];
}

export function salaryAnnualFamily(profile: UserProfile): SalaryAnnualFamily {
  if (profile.salaryBasisConflict) return "OWN";
  if (profile.nursingTrainingTariff) return "TVAOED";
  if (profile.tvalPflegeTariff) return "TVAL";
  if (profile.vkaETariff) return "TVOED_E";
  if (profile.tvlKrTariff) return "TVL_KR";
  if (profile.tvhKrTariff) return "TVH_KR";
  if (profile.tvUkNursingTariff) return "TVUK";
  return profile.tariff ? "TVOED_P" : "OWN";
}
