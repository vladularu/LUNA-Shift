import { hasTariffAbsenceInMonth, hasTariffAbsenceInPayrollYear } from "@/domain/absence-pay";
import { employmentProfileAt } from "@/domain/employment-history";
import type { CalendarEntry, UserProfile } from "@/domain/types";

// Build 57 can read older P catalogs whose fixed allowance is selected by state.
function needsEmployerRegion(profile: UserProfile, from: string, to: string) {
  const dates = [
    from,
    ...(profile.employmentTimeline ?? []).flatMap((row) =>
      row.effectiveFrom && row.effectiveFrom > from && row.effectiveFrom <= to
        ? [row.effectiveFrom]
        : [],
    ),
  ];
  return dates.some((date) => {
    const dated = employmentProfileAt(profile, date);
    return (
      dated.tariff != null &&
      (dated.tariff.tariffRegion === "KAV_BW") !== (dated.federalState === "BW")
    );
  });
}
export function needsCalendarSalaryInMonth(
  month: string,
  entries: readonly CalendarEntry[],
  profile: UserProfile,
) {
  return (
    hasTariffAbsenceInMonth(month, entries, profile) ||
    needsEmployerRegion(profile, month + "-01", month + "-31")
  );
}
export function needsCalendarSalaryInYear(
  year: number,
  entries: readonly CalendarEntry[],
  profile: UserProfile,
) {
  return (
    hasTariffAbsenceInPayrollYear(year, entries, profile) ||
    needsEmployerRegion(profile, year - 1 + "-11-01", year + "-12-31")
  );
}
