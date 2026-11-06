import { useMemo } from "react";
import { View } from "react-native";
import type { ShiftEntry } from "@/domain/types";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTemplates,
} from "@/application/pflegeshift-provider";
import { createMonthGrid, today } from "@/engine/calendar";
import { useActiveMonth } from "@/navigation/active-month";
import { CalendarBackground } from "@/features/calendar/calendar-background";
import { calendarShiftDetail } from "@/features/calendar/calendar-display";
import { useCalendarPreferences } from "@/features/calendar/calendar-preferences";
import { calendarDesignPreviewData } from "./calendar-design-preview-data";
import { usePalette } from "@/theme/palette";
import { calendarDayTints } from "@/theme/calendar-day-tints";
import { calendarChipPalette } from "@/theme/color-contrast";
import {
  CORNER_CURVE,
  CALENDAR_METRICS,
  RADII,
  CALENDAR_WIDGET_PREVIEW_METRICS as WIDGET_PREVIEW,
} from "@/theme/tokens";
import { INTER_FONTS } from "@/theme/shadcn";
import { ShiftSymbol } from "@/ui/shift-symbol";
import { Text } from "@/ui/text";

export function AppearanceCalendarPreview() {
  const palette = usePalette();
  const month = useActiveMonth();
  const { entries } = usePflegeShiftEntries();
  const { profile } = usePflegeShiftProfile();
  const { templates } = usePflegeShiftTemplates();
  const examples = useMemo(
    () => calendarDesignPreviewData(month, templates, entries),
    [month, templates, entries],
  );
  const preferences = useCalendarPreferences();
  const days = useMemo(() => createMonthGrid(month).slice(0, 14), [month]);
  const byDate = useMemo(
    () =>
      new Map(
        examples.entries
          .filter((entry): entry is ShiftEntry => entry.kind === "SHIFT")
          .map((entry) => [entry.date, entry]),
      ),
    [examples.entries],
  );
  const timeZone = profile?.timeZone ?? "Europe/Berlin";
  const currentDate = today(timeZone);
  const tints = calendarDayTints(palette, preferences.holidayColor);
  const rowText = {
    height: WIDGET_PREVIEW.lineHeight,
    lineHeight: WIDGET_PREVIEW.lineHeight,
    fontSize: WIDGET_PREVIEW.chipFont,
    fontFamily: INTER_FONTS.medium,
    fontWeight: "500" as const,
    fontVariant: ["tabular-nums" as const],
    textAlign: "center" as const,
    width: "100%" as const,
  };
  return (
    <View
      testID="appearance-calendar-preview"
      accessibilityLabel={`Zwei-Wochen-Vorschau, ${month}`}
      style={{
        borderCurve: CORNER_CURVE,
        borderRadius: RADII.card,
        overflow: "hidden",
        backgroundColor: palette.calendarBackground,
      }}
    >
      <CalendarBackground />
      <View
        testID="appearance-preview-month"
        style={{
          height: WIDGET_PREVIEW.height,
          paddingHorizontal: WIDGET_PREVIEW.horizontalInset,
          paddingVertical: WIDGET_PREVIEW.verticalInset,
        }}
      >
        {[0, 1].map((week) => (
          <View
            key={week}
            testID={`appearance-preview-week-${week}`}
            style={{ flex: 1, flexDirection: "row", gap: 2 }}
          >
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const shift = preferences.showShifts ? byDate.get(day.date) : undefined;
              const holiday = preferences.showHolidays
                ? examples.holidays.get(day.date)
                : undefined;
              const isToday = day.date === currentDate;
              const colors = shift
                ? calendarChipPalette(shift.color, palette.dark, preferences.pastelColors)
                : null;
              const detail = shift
                ? calendarShiftDetail(shift, { ...preferences, timeZone })
                : null;
              const titleColor = preferences.pastelColors
                ? colors?.onMain
                : CALENDAR_METRICS.chipTextColor;
              return (
                <View
                  key={day.date}
                  testID={`calendar-combined-day-${day.date}`}
                  accessible
                  accessibilityLabel={`${day.date}, ${shift?.title ?? "Keine Einträge"}${holiday ? ", " + holiday.name : ""}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    alignItems: "center",
                    borderRadius: CALENDAR_METRICS.chipRadius,
                    backgroundColor: holiday
                      ? tints.specialDay
                      : day.weekend
                        ? tints.weekend
                        : "transparent",
                  }}
                >
                  <View
                    testID={
                      day.inMonth
                        ? `calendar-date-marker-${day.date}`
                        : `calendar-adjacent-${day.date}`
                    }
                    style={{
                      width: WIDGET_PREVIEW.dayWidth,
                      height: WIDGET_PREVIEW.dayHeight,
                      marginBottom: WIDGET_PREVIEW.dateGap,
                      borderRadius: WIDGET_PREVIEW.dayHeight / 2,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isToday ? palette.calendarToday : "transparent",
                    }}
                  >
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      style={{
                        fontSize: WIDGET_PREVIEW.dayFont,
                        fontFamily: isToday ? INTER_FONTS.semibold : INTER_FONTS.regular,
                        fontWeight: isToday ? "600" : "400",
                        color: isToday ? palette.onCalendarToday : palette.text,
                      }}
                    >
                      {day.day}
                    </Text>
                  </View>
                  {shift && colors ? (
                    <View
                      style={{
                        width: "100%",
                        borderRadius: CALENDAR_METRICS.chipRadius,
                        borderCurve: CORNER_CURVE,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height: WIDGET_PREVIEW.lineHeight,
                          backgroundColor: colors.main,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {preferences.labelMode === "SYMBOL" ? (
                          <ShiftSymbol
                            value={shift.symbol}
                            color={titleColor!}
                            size={WIDGET_PREVIEW.chipFont}
                          />
                        ) : (
                          <Text
                            allowFontScaling={false}
                            adjustsFontSizeToFit
                            minimumFontScale={0.7}
                            numberOfLines={1}
                            style={[rowText, { color: titleColor }]}
                          >
                            {preferences.labelMode === "SHORT"
                              ? shift.title.slice(0, 1)
                              : shift.title}
                          </Text>
                        )}
                      </View>
                      {detail ? (
                        <Text
                          allowFontScaling={false}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                          numberOfLines={1}
                          style={[
                            rowText,
                            {
                              fontFamily: INTER_FONTS.regular,
                              fontWeight: "400",
                              backgroundColor: colors.detail,
                              color: colors.onDetail,
                            },
                          ]}
                        >
                          {detail}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
