import { Text } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import { memo } from "react";
import { today } from "@/engine/calendar";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { usePalette } from "@/theme/palette";
import { calendarImageLabelColor } from "@/theme/calendar-image";
import { useCalendarBackground } from "@/features/settings/calendar-background-context";
import { CALENDAR_METRICS, RADII } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import type { CalendarEntry } from "@/domain/types";
import { combinedCalendarPreview } from "./combined-calendar-preview";
import { SharedCalendarEntryContent } from "./shared-calendar-entry-content";
import { PrototypeEntryContent, type PrototypeDisplay } from "./prototype-entry-content";
import {
  PROTOTYPE_MONTH_NAMES,
  type PrototypeDay,
  type PrototypeMonth,
} from "./calendar-prototype-layout";

const MovingDay = memo(function MovingDay({
  day,
  progress,
  currentDate,
  selectedDate,
  selectedDayOpacity,
  testIDPrefix = "calendar-date-marker",
}: {
  day: PrototypeDay;
  progress: SharedValue<number>;
  currentDate: string;
  selectedDate?: string | null;
  selectedDayOpacity?: SharedValue<number>;
  testIDPrefix?: string;
}) {
  const palette = usePalette();
  const isToday = currentDate === day.date;
  const isSelected = selectedDate === day.date;
  const motion = useAnimatedStyle(() => ({
    transform: [
      { translateX: day.fromX + (day.toX - day.fromX) * progress.value - 15 },
      {
        translateY: day.fromY + (day.toY - day.fromY) * progress.value - 15 - 5 * progress.value,
      },
      { scale: 0.6 + 0.4 * progress.value },
    ],
  }));
  // The normal glyph stays mounted; the bold selection fades as a separate layer.
  return (
    <Animated.View testID={`${testIDPrefix}-${day.date}`} style={[styles.day, motion]}>
      <View
        pointerEvents="none"
        testID={
          isSelected && !isToday ? undefined : `calendar-highlight-${testIDPrefix}-${day.date}`
        }
        style={[
          styles.dayHighlight,
          { backgroundColor: isToday ? palette.calendarToday : "transparent", opacity: 1 },
        ]}
      />
      <Text
        testID={`calendar-base-label-${testIDPrefix}-${day.date}`}
        allowFontScaling={false}
        style={{
          fontFamily: INTER_FONTS.regular,
          fontSize: CALENDAR_METRICS.dayNumberFontSize,
          fontWeight: isToday ? "700" : "500",
          color: isToday ? palette.onCalendarToday : day.weekend ? palette.danger : palette.text,
        }}
      >
        {day.day}
      </Text>
      {isSelected && !isToday ? (
        <SelectedDayGlyph day={day} opacity={selectedDayOpacity} testIDPrefix={testIDPrefix} />
      ) : null}
    </Animated.View>
  );
});

const SelectedDayGlyph = memo(function SelectedDayGlyph({
  day,
  opacity,
  testIDPrefix,
}: {
  readonly day: PrototypeDay;
  readonly opacity?: SharedValue<number>;
  readonly testIDPrefix: string;
}) {
  const palette = usePalette();
  const fade = useAnimatedStyle(() => ({ opacity: opacity?.get() ?? 1 }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`calendar-selection-${testIDPrefix}-${day.date}`}
      style={[StyleSheet.absoluteFill, styles.daySelection, fade]}
    >
      <View
        testID={`calendar-highlight-${testIDPrefix}-${day.date}`}
        style={[styles.dayHighlight, { backgroundColor: palette.calendarToday }]}
      />
      <Text
        testID={`calendar-active-label-${testIDPrefix}-${day.date}`}
        allowFontScaling={false}
        style={{
          fontFamily: INTER_FONTS.regular,
          fontSize: CALENDAR_METRICS.dayNumberFontSize,
          fontWeight: "700",
          color: palette.onCalendarToday,
        }}
      >
        {day.day}
      </Text>
    </Animated.View>
  );
});

function YearMonthDates({
  layout,
  progress,
  selected,
}: {
  readonly layout: PrototypeMonth;
  readonly progress: SharedValue<number>;
  readonly selected: boolean;
}) {
  const palette = usePalette();
  const still = useSharedValue(0);
  const currentDate = today("Europe/Berlin");
  // Fully shown years are independent of any native pager repositioning.
  const motion = useAnimatedStyle(() => ({ opacity: selected && progress.value > 0 ? 0 : 1 }));
  return (
    <Animated.View
      pointerEvents="none"
      testID={"calendar-year-dates-" + layout.month}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, motion]}
    >
      {layout.days.map((day) =>
        selected ? (
          <MovingDay
            key={day.day}
            day={day}
            progress={still}
            currentDate={currentDate}
            testIDPrefix="calendar-year-date"
          />
        ) : (
          <Text
            key={day.day}
            testID={"calendar-year-date-" + day.date}
            pointerEvents="none"
            accessible={false}
            allowFontScaling={false}
            style={[
              styles.miniDay,
              {
                left: day.fromX - 9,
                top: day.fromY - 9,
                color: day.weekend ? palette.danger : palette.text,
              },
            ]}
          >
            {day.day}
          </Text>
        ),
      )}
    </Animated.View>
  );
}

export const PrototypeYear = memo(function PrototypeYear({
  layouts,
  selectedMonth,
  onSelect,
  progress,
  referenceMonth = today("Europe/Berlin").slice(0, 7),
  entriesByDate,
}: {
  layouts: readonly PrototypeMonth[];
  selectedMonth: string;
  onSelect: (month: string) => void;
  progress: SharedValue<number>;
  referenceMonth?: string;
  entriesByDate?: ReadonlyMap<string, readonly CalendarEntry[]>;
}) {
  const palette = usePalette();
  const motion = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, motion]}>
      {layouts.map((layout, index) => (
        <View
          key={index}
          testID={`calendar-year-month-${index + 1}`}
          pointerEvents="box-none"
          style={StyleSheet.absoluteFill}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: layout.month === selectedMonth }}
            accessibilityLabel={`${PROTOTYPE_MONTH_NAMES[index]} ${layout.month.slice(0, 4)} öffnen`}
            onPress={() => onSelect(layout.month)}
            style={{
              position: "absolute",
              left: layout.tile.x,
              top: layout.tile.y,
              width: layout.tile.width,
              height: layout.tile.height,
            }}
          />
          <Text
            pointerEvents="none"
            accessible={false}
            style={[
              styles.title,
              {
                left: layout.title.x,
                top: layout.title.y,
                color: layout.month === referenceMonth ? palette.calendarYearAccent : palette.text,
              },
            ]}
          >
            {PROTOTYPE_MONTH_NAMES[index]}
          </Text>
          {layout.days.map((day) => {
            const shifts = (entriesByDate?.get(day.date) ?? [])
              .filter((entry) => entry.kind === "SHIFT" && !entry.deletedAt)
              .slice(0, 2);
            return shifts.length ? (
              <View
                key={`marks-${day.day}`}
                pointerEvents="none"
                accessible={false}
                testID={`calendar-mini-shifts-${day.date}`}
                style={{
                  position: "absolute",
                  left: day.fromX - (shifts.length * 4 - 1) / 2,
                  top: day.fromY + 8,
                  flexDirection: "row",
                  gap: CALENDAR_METRICS.chipGap,
                }}
              >
                {shifts.map((entry) => (
                  <View
                    key={entry.id}
                    style={{
                      width: 3,
                      height: 3,
                      borderRadius: RADII.pill,
                      backgroundColor: entry.color,
                    }}
                  />
                ))}
              </View>
            ) : null;
          })}
          <YearMonthDates
            layout={layout}
            progress={progress}
            selected={layout.month === selectedMonth}
          />
        </View>
      ))}
    </Animated.View>
  );
});

export function PrototypeMonthContent({
  layout,
  progress,
  entriesByDate,
  sharedEntriesByDate,
  holidays,
  display,
  timeZone,
  visible,
}: {
  layout: PrototypeMonth;
  progress: SharedValue<number>;
  entriesByDate: ReadonlyMap<string, readonly CalendarEntry[]>;
  sharedEntriesByDate?: ReadonlyMap<string, readonly SharedCalendarDayEntry[]>;
  holidays: ReadonlyMap<string, { readonly name: string }>;
  display: PrototypeDisplay;
  timeZone: string;
  visible: boolean;
}) {
  const palette = usePalette();
  const background = useCalendarBackground();
  const labelColor = background.uri
    ? calendarImageLabelColor(palette, background.strength)
    : palette.textMuted;
  const motion = useAnimatedStyle(() => ({ opacity: Math.max(0, (progress.value - 0.4) / 0.6) }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      style={[StyleSheet.absoluteFill, motion]}
    >
      <View testID="calendar-month-weekdays" style={styles.weekdays}>
        {["M", "D", "M", "D", "F", "S", "S"].map((label, i) => (
          <Text
            key={i}
            style={{
              width: layout.cellWidth,
              textAlign: "center",
              color: i >= 5 ? palette.danger : labelColor,
            }}
          >
            {label}
          </Text>
        ))}
      </View>
      {[...layout.adjacentDays, ...layout.days].map((day) => (
        <CombinedDayContent
          key={day.date}
          day={day}
          layout={layout}
          entries={entriesByDate.get(day.date) ?? []}
          shared={sharedEntriesByDate?.get(day.date) ?? []}
          display={display}
          timeZone={timeZone}
          labelColor={labelColor}
          visible={visible}
          adjacent={day.date.slice(0, 7) !== layout.month}
          holiday={holidays.get(day.date)?.name}
        />
      ))}
    </Animated.View>
  );
}

function CombinedDayContent({
  day,
  layout,
  entries,
  shared,
  display,
  timeZone,
  labelColor,
  visible,
  adjacent = false,
  holiday,
}: {
  readonly day: {
    readonly date: string;
    readonly day: number;
    readonly toX: number;
    readonly toY: number;
    readonly weekend: boolean;
  };
  readonly layout: PrototypeMonth;
  readonly entries: readonly CalendarEntry[];
  readonly shared: readonly SharedCalendarDayEntry[];
  readonly display: PrototypeDisplay;
  readonly timeZone: string;
  readonly labelColor: string;
  readonly visible: boolean;
  readonly adjacent?: boolean;
  readonly holiday?: string;
}) {
  const palette = usePalette();
  const preview = combinedCalendarPreview(
    entries,
    shared,
    layout.weekHeight,
    display.showShiftTimes || display.showShiftDuration,
  );
  const usedHeight =
    preview.rows.length *
      preview.lineHeight *
      (display.showShiftTimes || display.showShiftDuration ? 2 : 1) +
    Math.max(0, preview.rows.length - 1);
  return (
    <View
      accessible={visible}
      accessibilityLabel={
        day.date +
        ", " +
        ([
          ...entries.map((e) => e.title),
          ...shared.map((r) => r.calendarName + ": " + r.entry.title),
        ].join(", ") || "Keine Einträge") +
        (holiday ? ", " + holiday : "")
      }
      testID={"calendar-combined-day-" + day.date}
      style={{
        position: "absolute",
        left: day.toX - layout.cellWidth / 2,
        top: day.toY - 20,
        width: layout.cellWidth,
        height: layout.weekHeight,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: palette.separator,
        overflow: "hidden",
        opacity: 1,
      }}
    >
      {adjacent ? (
        <View style={{ height: preview.headerHeight, alignItems: "center" }}>
          <View
            testID={"calendar-adjacent-date-box-" + day.date}
            style={[styles.day, { position: "relative" }]}
          >
            <Text
              testID={"calendar-adjacent-" + day.date}
              allowFontScaling={false}
              style={{
                opacity: 0.5,
                fontFamily: INTER_FONTS.regular,
                fontWeight: "500",
                fontSize: CALENDAR_METRICS.dayNumberFontSize,
                color: day.weekend ? palette.danger : labelColor,
              }}
            >
              {day.day}
            </Text>
          </View>
        </View>
      ) : null}
      {preview.overflowCount > 0 ? (
        <Text
          testID={"calendar-overflow-" + day.date}
          allowFontScaling={false}
          style={{
            position: "absolute",
            right: 2,
            top: 3,
            fontSize: CALENDAR_METRICS.weekNumberFontSize,
            color: labelColor,
          }}
        >
          {"+" + preview.overflowCount}
        </Text>
      ) : null}
      <View
        testID={
          (adjacent ? "calendar-adjacent-entry-layer-" : "calendar-combined-entries-") + day.date
        }
        style={{
          marginTop: adjacent ? 0 : preview.headerHeight,
          marginHorizontal: CALENDAR_METRICS.chipHorizontalInset,
          gap: CALENDAR_METRICS.chipGap,
          opacity: adjacent ? 0.3 : 1,
        }}
      >
        {preview.rows.map((item, index) => (
          <View
            key={
              item.kind === "own"
                ? "own:" + item.entry.id
                : item.row.calendarId + ":" + item.row.entry.id
            }
            testID={"calendar-entry-slot-" + day.date + "-" + index}
            style={{
              height:
                preview.lineHeight * (display.showShiftTimes || display.showShiftDuration ? 2 : 1),
            }}
          >
            {item.kind === "own" ? (
              <PrototypeEntryContent
                entry={item.entry}
                display={display}
                timeZone={timeZone}
                lineHeight={preview.lineHeight}
              />
            ) : (
              <SharedCalendarEntryContent
                row={item.row}
                display={display}
                lineHeight={preview.lineHeight}
              />
            )}
          </View>
        ))}

        {holiday && preview.headerHeight + usedHeight + 18 < layout.weekHeight ? (
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={{
              height: CALENDAR_METRICS.entryRowHeight,
              color: labelColor,
              fontSize: CALENDAR_METRICS.entryFontSize,
            }}
          >
            {holiday}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function PrototypeDates({
  layout,
  progress,
  currentDate,
  selectedDate,
  selectedDayOpacity,
}: {
  layout: PrototypeMonth;
  progress: SharedValue<number>;
  currentDate: string;
  selectedDate?: string | null;
  selectedDayOpacity?: SharedValue<number>;
}) {
  const motion = useAnimatedStyle(() => ({ opacity: progress.value > 0 ? 1 : 0 }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, motion]}
    >
      {layout.days.map((day) => (
        <MovingDay
          key={day.day}
          day={day}
          progress={progress}
          currentDate={currentDate}
          selectedDate={selectedDate}
          selectedDayOpacity={selectedDayOpacity}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  daySelection: {
    alignItems: "center",
    justifyContent: "center",
  },
  dayHighlight: {
    position: "absolute",
    width: CALENDAR_METRICS.dayMarkerSize,
    height: CALENDAR_METRICS.dayMarkerSize,
    left: (30 - CALENDAR_METRICS.dayMarkerSize) / 2,
    top: (30 - CALENDAR_METRICS.dayMarkerSize) / 2,
    borderRadius: RADII.pill,
  },
  day: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: RADII.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    position: "absolute",
    minHeight: 44,
    minWidth: 44,
    fontFamily: INTER_FONTS.bold,
    fontSize: TYPOGRAPHY.sectionTitle.fontSize,
    fontWeight: "700",
  },
  miniDay: {
    position: "absolute",
    width: 18,
    height: 18,
    fontFamily: INTER_FONTS.regular,
    fontSize: CALENDAR_METRICS.dayNumberFontSize * 0.6,
    textAlign: "center",
    lineHeight: TYPOGRAPHY.label.lineHeight,
  },
  weekdays: { flexDirection: "row", height: 32, alignItems: "center" },
});
