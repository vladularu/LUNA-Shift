import { Temporal } from "@js-temporal/polyfill";
import type { UserProfile } from "@/domain/types";
import type { WorkingTimeTargetProfile } from "@/domain/working-time-target";
import { resolveProfileHolidayMapForMonth } from "@/engine/holidays";
import { resolveCalendarSpecialDays } from "@/features/calendar/calendar-special-days";
import type { RuleResolver } from "@/rules/rule-resolver";

/** Resolve each month once using the calendar's employment history and tariff rules. */
export function widgetCalendarHighlights(
  range: { readonly startDate: string; readonly endDate: string },
  profile: UserProfile & WorkingTimeTargetProfile,
  resolver: RuleResolver,
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  let month = Temporal.PlainDate.from(range.startDate).with({ day: 1 });
  const end = Temporal.PlainDate.from(range.endDate);
  while (Temporal.PlainDate.compare(month, end) <= 0) {
    const key = month.toString().slice(0, 7);
    const holidays = resolveProfileHolidayMapForMonth(key, profile, resolver);
    const special = resolveCalendarSpecialDays(key, profile, resolver);
    for (const [date, day] of special.days) labels.set(date, day.label);
    for (const [date, holiday] of holidays.holidays) labels.set(date, holiday.name);
    month = month.add({ months: 1 });
  }
  return labels;
}
