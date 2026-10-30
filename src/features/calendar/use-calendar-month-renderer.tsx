import { useCallback, useMemo } from "react";
import type { UserProfile } from "@/domain/types";
import { SharedCalendarMonth } from "./calendar-shared-scene";

type MonthProps = Parameters<typeof SharedCalendarMonth>[0];
type Options = Omit<MonthProps, "month" | "profile" | "accessibilityVisible" | "testData"> & {
  profile: UserProfile | null;
  isFocused: boolean;
  visibleMonth: string;
  testMonths: readonly string[];
};

/** Stable display settings and month props keep background commits out of unchanged pages. */
export function useCalendarMonthRenderer({
  entriesByDate,
  sharedEntriesByDate,
  display,
  profile,
  onSelectDate,
  pageHeight,
  ruleResolver,
  selectedDate,
  selectedDayOpacity,
  showHolidays,
  stampMode,
  stampTransitionProgress,
  stampToolLabel,
  isFocused,
  visibleMonth,
  testMonths,
}: Options) {
  const monthDisplay = useMemo(
    () => ({
      labelMode: display.labelMode,
      showShiftTimes: display.showShiftTimes,
      showShiftDuration: display.showShiftDuration,
      holidayColor: display.holidayColor,
      pastelColors: display.pastelColors,
    }),
    [
      display.labelMode,
      display.showShiftTimes,
      display.showShiftDuration,
      display.holidayColor,
      display.pastelColors,
    ],
  );
  return useCallback(
    (month: string) =>
      profile ? (
        <SharedCalendarMonth
          month={month}
          entriesByDate={entriesByDate}
          sharedEntriesByDate={sharedEntriesByDate}
          display={monthDisplay}
          profile={profile}
          onSelectDate={onSelectDate}
          pageHeight={pageHeight}
          ruleResolver={ruleResolver}
          selectedDate={selectedDate}
          selectedDayOpacity={selectedDayOpacity}
          showHolidays={showHolidays}
          stampMode={stampMode}
          stampTransitionProgress={stampTransitionProgress}
          stampToolLabel={stampToolLabel}
          testData={testMonths.includes(month)}
          accessibilityVisible={isFocused && month === visibleMonth}
        />
      ) : null,
    [
      entriesByDate,
      sharedEntriesByDate,
      monthDisplay,
      profile,
      onSelectDate,
      pageHeight,
      ruleResolver,
      selectedDate,
      selectedDayOpacity,
      showHolidays,
      stampMode,
      stampTransitionProgress,
      stampToolLabel,
      testMonths,
      isFocused,
      visibleMonth,
    ],
  );
}
