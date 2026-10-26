import type { SaveProfileInput, UserProfile } from "@/domain/types";
import { FEDERAL_STATE_LABELS, HOLIDAY_REGION_LABELS, INDUSTRY_LABELS } from "@/domain/types";
import {
  captureEmploymentProfile,
  employmentTimelineKey,
  type EmploymentProfileData,
} from "@/domain/employment-history";
import { profileSalaryLabel } from "./work-profile-summary";

const salaryFields = [
  "tariff",
  "manualMonthlyGrossCents",
  "nursingTrainingTariff",
  "vkaETariff",
  "tvlKrTariff",
  "tvUkNursingTariff",
  "tvhKrTariff",
  "tvalPflegeTariff",
];
const labels: Record<keyof EmploymentProfileData, string> = {
  timeZone: "Zeitzone",
  weeklyMinutes: "Wochenstunden",
  federalState: "Bundesland",
  holidayRegion: "Regionale Feiertage",
  industry: "Arbeitsbereich",
  tariff: "Tarif",
  manualMonthlyGrossCents: "Bruttogehalt",
  nursingTrainingTariff: "Tarif",
  vkaETariff: "Tarif",
  tvlKrTariff: "Tarif",
  tvUkNursingTariff: "Tarif",
  tvhKrTariff: "Tarif",
  tvalPflegeTariff: "Tarif",
  regularRotatingNightWork: "Regelmäßige Nachtarbeit",
  sundayHolidayWorkEligible: "Sonn- und Feiertagsarbeit",
  allEmploymentWorkRecorded: "Alle Arbeitszeiten erfasst",
  workPattern: "Schichtmodell",
};
const ordered = (value: unknown) =>
  JSON.stringify(value, (_key, child: unknown) =>
    child !== null && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)))
      : child,
  );
export function employmentChangedFields(before: SaveProfileInput, after: SaveProfileInput) {
  const a = captureEmploymentProfile(before),
    b = captureEmploymentProfile(after);
  return (Object.keys(a) as (keyof EmploymentProfileData)[]).filter(
    (key) => ordered(a[key]) !== ordered(b[key]),
  );
}
export function employmentChangeLines(before: UserProfile, after: SaveProfileInput) {
  const fields = employmentChangedFields(before, after);
  const result: string[] = [];
  if (fields.some((key) => salaryFields.includes(key)))
    result.push(
      `Tarif & Gehalt: ${profileSalaryLabel(before)} → ${profileSalaryLabel({ ...before, ...after })}`,
    );
  const format = (p: SaveProfileInput, key: keyof EmploymentProfileData): string => {
    const data = captureEmploymentProfile(p),
      value = data[key];
    if (key === "weeklyMinutes") return String(data.weeklyMinutes / 60).replace(".", ",") + " Std.";
    if (key === "federalState") return FEDERAL_STATE_LABELS[data.federalState];
    if (key === "holidayRegion") return HOLIDAY_REGION_LABELS[data.holidayRegion];
    if (key === "industry") return data.industry ? INDUSTRY_LABELS[data.industry] : "Noch offen";
    if (key === "workPattern")
      return value
        ? `${data.workPattern?.workplaceCoverage === "AROUND_THE_CLOCK" ? "24/7" : data.workPattern?.workplaceCoverage === "NOT_AROUND_THE_CLOCK" ? "Nicht 24/7" : "Ungeklärt"} · ${data.workPattern?.assignment === "PERMANENT" ? "Dauerhaft" : data.workPattern?.assignment === "TEMPORARY" ? "Gelegentlich" : "Ungeklärt"}`
        : "Noch offen";
    return value === true
      ? "Ja"
      : value === false
        ? "Nein"
        : value == null
          ? "Noch offen"
          : String(value);
  };
  for (const key of fields.filter((key) => !salaryFields.includes(key)))
    result.push(`${labels[key]}: ${format(before, key)} → ${format(after, key)}`);
  return result;
}
export function employmentUndoInput(before: UserProfile, saved: UserProfile): SaveProfileInput {
  return {
    ...before,
    validity: {
      effectiveFrom: null,
      baseline: captureEmploymentProfile(saved),
      expectedProfileUpdatedAt: saved.updatedAt,
      expectedTimeline: employmentTimelineKey(saved.employmentTimeline ?? []),
      restoreTimeline: before.employmentTimeline ?? [],
    },
  };
}
