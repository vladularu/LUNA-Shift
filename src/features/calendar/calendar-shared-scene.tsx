import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import { Text } from "@/ui/text";
import { createContext, memo, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { CalendarEntry, CalendarViewMode, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { today } from "@/engine/calendar";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII } from "@/theme/tokens";
import type { CalendarAnchorRect } from "./calendar-layout";
import { calendarPrototypeLayout } from "./calendar-prototype-layout";
import { PrototypeDates, PrototypeMonthContent, PrototypeYear } from "./calendar-prototype-canvas";
import type { PrototypeDisplay } from "./prototype-entry-content";
import { useCalendarHolidayResolution } from "./calendar-holidays";
import { stampDayAccessibilityHint } from "./stamp-accessibility";
import { useCalendarController, type CalendarController } from "./use-calendar-controller";
import { CalendarMonthBackground } from "./calendar-background";
import {
  QUICK_PLANNER_EASING,
  quickPlannerTransitionDuration,
} from "./quick-planner-control-motion";

import { CalendarMonthTitle } from "./calendar-month-title";
import { calendarMonthRows } from "./calendar-render-data";
import { combinedCalendarPreview } from "./combined-calendar-preview";

interface SceneValue {
  headerOverlap: number;
  referenceMonth?: string;
  progress: SharedValue<number>;
  month: string;
  mode: CalendarViewMode;
  width: number;
  height: number;
  busy: boolean;
}
const Scene = createContext<SceneValue | null>(null);

/** Same persistent glyphs at both endpoints; no native measurements or overlay handoff. */
type SharedCalendarSceneProps = {
  month: string;
  viewMode: CalendarViewMode;
  active: boolean;
  bottomReserve: number;
  headerOverlap?: number;
  showBackground?: boolean;
  onSelectMonth: (month: string) => void;
  onTransitionStart?: (mode: CalendarViewMode) => void;
  onTransitionComplete?: () => void;
  children: ReactNode;
  controller?: CalendarController;
  referenceMonth?: string;
  entriesByDate?: ReadonlyMap<string, readonly CalendarEntry[]>;
  pastelColors?: boolean;
};

export function SharedCalendarScene(props: SharedCalendarSceneProps) {
  return props.controller ? (
    <CalendarSceneContent {...props} controller={props.controller} />
  ) : (
    <StandaloneCalendarScene {...props} />
  );
}

function StandaloneCalendarScene(props: SharedCalendarSceneProps) {
  const controller = useCalendarController({
    month: props.month,
    mode: props.viewMode,
    active: props.active,
    onTransitionStart: props.onTransitionStart,
    onTransitionComplete: props.onTransitionComplete,
  });
  return <CalendarSceneContent {...props} controller={controller} />;
}

function CalendarSceneContent({
  bottomReserve,
  headerOverlap = 0,
  showBackground = true,
  onSelectMonth,
  children,
  controller,
  referenceMonth,
  entriesByDate,
  pastelColors = false,
}: SharedCalendarSceneProps & { controller: CalendarController }) {
  const { month, mode: viewMode, progress, busy, yearVisible } = controller;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const height = Math.max(1, size.height - bottomReserve);
  const year = month.slice(0, 4);
  const layouts = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        calendarPrototypeLayout(
          `${year}-${String(index + 1).padStart(2, "0")}`,
          size.width,
          height,
          headerOverlap,
        ),
      ),
    [height, headerOverlap, size.width, year],
  );
  return (
    <Scene
      value={{
        progress,
        month,
        mode: viewMode,
        width: size.width,
        height,
        busy,
        headerOverlap,
        referenceMonth,
      }}
    >
      <View
        testID="calendar-shared-scene"
        style={[styles.fill, { marginTop: -headerOverlap }]}
        onLayout={(event) => {
          const { width, height: nextHeight } = event.nativeEvent.layout;
          setSize((old) =>
            old.width === width && old.height === nextHeight ? old : { width, height: nextHeight },
          );
        }}
      >
        {showBackground ? <CalendarMonthBackground progress={progress} /> : null}
        <CalendarYearOverview
          visible={yearVisible}
          busy={busy}
          mode={viewMode}
          layouts={layouts}
          selectedMonth={month}
          onSelect={onSelectMonth}
          progress={progress}
          referenceMonth={referenceMonth}
          entriesByDate={entriesByDate}
          pastelColors={pastelColors}
        />
        <View
          style={styles.fill}
          pointerEvents={viewMode === "MONTH" && !busy ? "auto" : "none"}
          accessibilityElementsHidden={viewMode !== "MONTH"}
          importantForAccessibility={viewMode === "MONTH" ? "auto" : "no-hide-descendants"}
        >
          {children}
        </View>
      </View>
    </Scene>
  );
}

// Retain the moving glyphs, but freeze their React data while the year is hidden.
const CalendarYearOverview = memo(
  function CalendarYearOverview({
    visible,
    busy,
    mode,
    ...props
  }: Parameters<typeof PrototypeYear>[0] & {
    visible: boolean;
    busy: boolean;
    mode: CalendarViewMode;
  }) {
    return (
      <View
        testID="calendar-year-overview-shell"
        style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0 }]}
        pointerEvents={mode === "YEAR" && !busy ? "auto" : "none"}
        accessibilityElementsHidden={mode !== "YEAR"}
        importantForAccessibility={mode === "YEAR" ? "auto" : "no-hide-descendants"}
      >
        <PrototypeYear {...props} />
      </View>
    );
  },
  (old, next) => !old.visible && !next.visible,
);

function useMonthRows<T>(rows: ReadonlyMap<string, readonly T[]> | undefined, month: string) {
  const [select] = useState(() => {
    let previous: ReadonlyMap<string, readonly T[]> = new Map();
    return (next: ReadonlyMap<string, readonly T[]> | undefined, key: string) => {
      previous = calendarMonthRows(previous, next ?? new Map(), key);
      return previous;
    };
  });
  return useMemo(() => select(rows, month), [month, rows, select]);
}

export function SharedCalendarMonth({
  month,
  pageHeight,
  entriesByDate,
  sharedEntriesByDate,
  display,
  profile,
  ruleResolver,
  showHolidays,
  onSelectDate,
  selectedDate,
  selectedDayOpacity,
  accessibilityVisible,
  testData,
  stampMode = false,
  stampTransitionProgress,
  stampToolLabel = null,
}: {
  month: string;
  pageHeight: number;
  entriesByDate: ReadonlyMap<string, readonly CalendarEntry[]>;
  sharedEntriesByDate?: ReadonlyMap<string, readonly SharedCalendarDayEntry[]>;
  display: PrototypeDisplay;
  profile: UserProfile;
  ruleResolver: RuleResolver;
  showHolidays: boolean;
  onSelectDate: (date: string, anchor: CalendarAnchorRect) => void;
  selectedDate: string | null;
  selectedDayOpacity?: SharedValue<number>;
  accessibilityVisible: boolean;
  testData: boolean;
  stampMode?: boolean;
  stampTransitionProgress?: SharedValue<number>;
  stampToolLabel?: string | null;
}) {
  const scene = use(Scene);
  const palette = usePalette();
  const still = useSharedValue(1);
  const internalStampProgress = useSharedValue(stampMode ? 1 : 0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (stampTransitionProgress) return;
    internalStampProgress.value = withTiming(stampMode ? 1 : 0, {
      duration: quickPlannerTransitionDuration(stampMode, reduced),
      easing: QUICK_PLANNER_EASING,
    });
  }, [internalStampProgress, reduced, stampMode, stampTransitionProgress]);
  const holidays = useCalendarHolidayResolution(month, profile, ruleResolver, showHolidays);
  const ownRows = useMonthRows(entriesByDate, month);
  const sharedRows = useMonthRows(sharedEntriesByDate, month);
  const selected = scene?.month === month;
  const { progress, mode, busy, width, height, headerOverlap = 0, referenceMonth } = scene ?? {};
  const monthScene = useMemo(
    () =>
      progress && mode && busy !== undefined && width !== undefined && height !== undefined
        ? {
            progress,
            mode,
            busy,
            width,
            height,
            headerOverlap,
            referenceMonth,
            month: selected ? month : "",
          }
        : null,
    [progress, mode, busy, width, height, headerOverlap, referenceMonth, selected, month],
  );
  if (!monthScene) throw new Error("SharedCalendarMonth requires SharedCalendarScene");
  return (
    <SharedMonthBody
      month={month}
      pageHeight={pageHeight}
      entriesByDate={ownRows}
      sharedEntriesByDate={sharedRows}
      display={display}
      profile={profile}
      onSelectDate={onSelectDate}
      selectedDate={selectedDate?.startsWith(month) ? selectedDate : null}
      selectedDayOpacity={selectedDayOpacity}
      accessibilityVisible={accessibilityVisible}
      testData={testData}
      stampMode={stampMode}
      stampTransitionProgress={stampTransitionProgress ?? internalStampProgress}
      stampToolLabel={stampToolLabel}
      scene={monthScene}
      still={still}
      holidays={holidays.holidays}
      specialDays={holidays.specialDays}
      separator={palette.textMuted}
      slotFill={palette.surface}
    />
  );
}

const SharedMonthBody = memo(function SharedMonthBody({
  month,
  pageHeight,
  entriesByDate,
  sharedEntriesByDate,
  display,
  profile,
  onSelectDate,
  selectedDate,
  selectedDayOpacity,
  accessibilityVisible,
  testData,
  scene,
  still,
  holidays,
  specialDays,
  separator,
  slotFill,
  stampMode,
  stampTransitionProgress,
  stampToolLabel,
}: Omit<Parameters<typeof SharedCalendarMonth>[0], "ruleResolver" | "showHolidays"> & {
  scene: SceneValue;
  still: SharedValue<number>;
  holidays: ReadonlyMap<string, { name: string }>;
  specialDays: ReadonlyMap<string, { readonly label: string }>;
  separator: string;
  slotFill: string;
}) {
  const layout = useMemo(
    () => calendarPrototypeLayout(month, scene.width, scene.height, scene.headerOverlap),
    [month, scene.width, scene.height, scene.headerOverlap],
  );
  const selected = month === scene.month;
  const currentDate = today(profile.timeZone);
  const detailed = display.showShiftTimes || display.showShiftDuration;
  const slot = combinedCalendarPreview([], [], layout.weekHeight, detailed);
  const progress = selected ? scene.progress : still;
  const visible = accessibilityVisible && scene.mode === "MONTH" && !scene.busy;
  const opacity = useAnimatedStyle(() => ({ opacity: selected ? 1 : scene.progress.value }));
  const titleOpacity = useAnimatedStyle(() => ({ opacity: scene.progress.value }));
  return (
    <Animated.View
      testID={`shared-month-${month}`}
      style={[{ height: pageHeight, width: scene.width }, opacity]}
    >
      {scene.headerOverlap > 0 && scene.width > 0 ? (
        <Animated.View style={titleOpacity} pointerEvents="none">
          <CalendarMonthTitle
            month={month}
            referenceMonth={scene.referenceMonth ?? currentDate.slice(0, 7)}
            accessible={visible}
          />
        </Animated.View>
      ) : null}
      <PrototypeMonthContent
        animateChanges={stampMode && visible}
        layout={layout}
        progress={progress}
        entriesByDate={entriesByDate}
        sharedEntriesByDate={sharedEntriesByDate}
        holidays={holidays}
        specialDays={specialDays}
        display={display}
        timeZone={profile.timeZone}
        visible={false}
      />
      <PrototypeDates
        layout={layout}
        progress={progress}
        currentDate={currentDate}
        selectedDate={scene.mode === "MONTH" ? selectedDate : null}
        selectedDayOpacity={selectedDayOpacity}
      />
      <View
        pointerEvents={visible ? "box-none" : "none"}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
        style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0 }]}
      >
        {layout.days.map((day) => (
          <Pressable
            key={day.date}
            testID={`calendar-day-${day.date}`}
            accessibilityRole="button"
            accessibilityHint={
              stampMode ? stampDayAccessibilityHint(stampToolLabel ?? null) : "Tagesfenster öffnen"
            }
            accessibilityLabel={`${day.date}, ${holidays.get(day.date)?.name ?? specialDays.get(day.date)?.label ?? ""} ${[...(entriesByDate.get(day.date) ?? []).map((entry) => entry.title), ...(sharedEntriesByDate?.get(day.date) ?? []).map((row) => `${row.calendarName}: ${row.entry.title}`)].join(", ")}`}
            accessibilityState={{ selected: selectedDate === day.date }}
            onPress={(event) => {
              const { pageX, pageY, locationX, locationY } = event.nativeEvent;
              onSelectDate(day.date, {
                x: pageX - locationX,
                y: pageY - locationY,
                width: layout.cellWidth,
                height: layout.weekHeight,
              });
            }}
            style={{
              borderCurve: CORNER_CURVE,
              position: "absolute",
              left: day.toX - layout.cellWidth / 2,
              top: day.toY - 20,
              width: layout.cellWidth,
              height: layout.weekHeight,
              borderRadius: RADII.small,
            }}
          >
            {!entriesByDate.get(day.date)?.length &&
            !sharedEntriesByDate?.get(day.date)?.length &&
            day.date !== currentDate &&
            stampTransitionProgress ? (
              <StampDayOutline
                date={day.date}
                progress={stampTransitionProgress}
                color={separator}
                fill={slotFill}
                top={slot.headerHeight}
                height={slot.lineHeight * (detailed ? 2 : 1)}
              />
            ) : null}
          </Pressable>
        ))}
      </View>
      {testData ? <Text style={{ position: "absolute", bottom: 0 }}>Testdaten</Text> : null}
    </Animated.View>
  );
});

function StampDayOutline({
  date,
  progress,
  color,
  fill,
  top,
  height,
}: {
  date: string;
  progress: SharedValue<number>;
  color: string;
  fill: string;
  top: number;
  height: number;
}) {
  const motionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      testID={`quick-stamp-outline-${date}`}
      style={[
        {
          position: "absolute",
          top,
          height,
          left: 1,
          right: 1,
          borderWidth: 1,
          borderColor: color,
          backgroundColor: fill + "40",
          borderRadius: RADII.small,
          borderCurve: CORNER_CURVE,
        },
        motionStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, overflow: "hidden" } });
