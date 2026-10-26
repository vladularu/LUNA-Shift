import { employmentProfileAt } from "@/domain/employment-history";
import { useMemo } from "react";
import { View } from "react-native";

import {
  resolveCalendarSpecialDays,
  type CalendarSpecialDayResolution,
} from "./calendar-special-days";
import type { UserProfile } from "@/domain/types";
import {
  resolveHolidayMapForMonths,
  resolveProfileHolidayMapForMonth,
  type HolidayMonthResolution,
} from "@/engine/holidays";
import type { RuleResolver } from "@/rules/rule-resolver";
import { SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { InlineNotice } from "@/ui/design-system";

type CalendarHolidayResolution = HolidayMonthResolution & {
  readonly specialDays: CalendarSpecialDayResolution["days"];
  readonly specialDaysUnavailable: boolean;
};

const HOLIDAYS_HIDDEN: CalendarHolidayResolution = Object.freeze({
  status: "AVAILABLE",
  holidays: new Map(),
  failure: null,
  specialDays: new Map(),
  specialDaysUnavailable: false,
});

export function useCalendarHolidayResolution(
  month: string,
  profile: UserProfile | null,
  ruleResolver: RuleResolver,
  showHolidays: boolean,
): CalendarHolidayResolution {
  return useMemo(() => {
    if (profile === null || !showHolidays) return HOLIDAYS_HIDDEN;
    const holidays = resolveProfileHolidayMapForMonth(month, profile, ruleResolver);
    const special = resolveCalendarSpecialDays(month, profile, ruleResolver);
    return {
      ...holidays,
      specialDays: special.days,
      specialDaysUnavailable: special.status === "UNAVAILABLE",
    };
  }, [month, profile, ruleResolver, showHolidays]);
}

export function holidayNameForDate(
  date: string,
  profile: UserProfile,
  ruleResolver: RuleResolver,
): string | undefined {
  profile = employmentProfileAt(profile, date);
  return resolveHolidayMapForMonths(
    [date.slice(0, 7)],
    profile.federalState,
    ruleResolver,
    profile.holidayRegion,
  ).holidays.get(date)?.name;
}

/** Full day-window label; public-holiday lookup remains statutory-only. */
export function calendarDayLabelForDate(
  date: string,
  profile: UserProfile,
  resolver: RuleResolver,
): string | undefined {
  return (
    holidayNameForDate(date, profile, resolver) ??
    resolveCalendarSpecialDays(date.slice(0, 7), profile, resolver).days.get(date)?.label
  );
}

export function CalendarHolidayCoverageNotice({
  resolution,
}: {
  readonly resolution: HolidayMonthResolution & { readonly specialDaysUnavailable?: boolean };
}) {
  if (resolution.status === "AVAILABLE" && !resolution.specialDaysUnavailable) return null;
  return (
    <View
      style={{
        paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
        paddingBottom: SPACING.sm,
      }}
    >
      <InlineNotice
        message={
          resolution.status !== "AVAILABLE"
            ? "Feiertagsregeln für diesen Zeitraum noch nicht verfügbar."
            : "Tarifliche Sondertage können gerade nicht angezeigt werden. Prüfe die Arbeitszeitangaben."
        }
        tone="warning"
      />
    </View>
  );
}
