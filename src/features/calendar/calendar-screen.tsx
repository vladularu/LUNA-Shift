import { calendarDataMonths } from "./calendar-render-data";
import { useCalendarMonthRenderer } from "./use-calendar-month-renderer";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import { useSharedCalendarDays } from "./use-shared-calendar-days";
import { calendarDesignRoute } from "@/navigation/calendar-design-route";
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, View, type LayoutChangeEvent } from "react-native";
import Animated, { useReducedMotion, useSharedValue } from "react-native-reanimated";

import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTemplates,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import {
  calendarRangeCoversMonth,
  calendarRangeCoversYear,
} from "@/application/calendar-entry-loading";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { CalendarEntry } from "@/domain/types";
import { addMonths, currentMonth, today } from "@/engine/calendar";
import { calendarPerformance } from "@/application/calendar-performance";
import { useCalendarStartup } from "./use-calendar-startup";
import { useCalendarPerformance, useMeasuredCalendarEntries } from "./use-calendar-performance";
import { CalendarHeader, useCalendarHeaderOverlap } from "@/features/calendar/calendar-header";
import { CalendarMonthBackground } from "./calendar-background";
import { SharedCalendarScene } from "./calendar-shared-scene";
import { CalendarStablePager } from "./calendar-stable-pager";
import { calendarPageTarget } from "./calendar-page-window";
import { useCalendarController } from "./use-calendar-controller";
import { calendarDayPressAction } from "@/features/calendar/calendar-display";
import * as CalendarHolidays from "@/features/calendar/calendar-holidays";
import type { CalendarAnchorRect } from "@/features/calendar/calendar-layout";
import { clampDateToMonth } from "@/features/calendar/calendar-metrics";
import { useCalendarPreferences } from "@/features/calendar/calendar-preferences";
import { createMonthWindow, shouldRecenterMonthWindow } from "@/features/calendar/month-window";
import {
  buildQuickEntryActions,
  isQuickEntryStampAction,
  quickEntryEditorTarget,
  quickEntryServiceActions,
  type QuickEntryAction,
  type QuickEntryStampAction,
} from "@/features/calendar/quick-entry-actions";
import { consumeShiftSelectionPopupRestore } from "@/features/calendar/quick-entry-navigation";
import { QuickEntryPopup } from "@/features/calendar/quick-entry-popup";
import { SharedCalendarFilters } from "./shared-calendar-filters";
import { QuickPlannerDock } from "@/features/calendar/quick-planner-dock";
import { CalendarQuickOverlay } from "./calendar-quick-overlay";
import { stampToolSelectedAnnouncement } from "@/features/calendar/stamp-accessibility";
import { useCalendarTodayScroll } from "@/features/calendar/use-calendar-today-scroll";
import { useCalendarPaging } from "@/features/calendar/use-calendar-paging";
import { useOpenShiftSelection } from "@/features/calendar/use-open-shift-selection";
import { useQuickStampAction } from "@/features/calendar/use-quick-stamp-action";
import { dayEditorRoute, sharedDayEditorRoute, quickAddRoute } from "@/navigation/routes";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { useActiveMonthCoordinator } from "@/navigation/active-month";
import { usePalette } from "@/theme/palette";
import { SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { InlineNotice } from "@/ui/design-system";
import { PrimaryButton } from "@/ui/form-controls";
import { selectionFeedback } from "@/ui/haptics";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { useThemeStatusBar } from "@/ui/use-theme-status-bar";

const [MONTHS_BEFORE, MONTHS_AFTER] = [24, 36] as const;
interface QuickPopupState {
  readonly revision: number;
  readonly date: string;
  readonly anchor: CalendarAnchorRect;
}

export function CalendarScreen() {
  const palette = usePalette();
  useThemeStatusBar();
  const isFocused = useIsFocused();
  const preferences = useCalendarPreferences();
  const { setViewMode } = preferences;
  const activeMonthCoordinator = useActiveMonthCoordinator();
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const { ready, calendarRange, error, reload } = usePflegeShiftStatus();
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
  const { templates } = usePflegeShiftTemplates();
  const { entries, removeEntry, upsertShift } = usePflegeShiftEntries();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver: ruleResolver } = useRuleCatalogRuntime();
  const timeZone = profile?.timeZone ?? "Europe/Berlin";
  const parsedMonth = parseMonthRouteParam(params.month);
  const routeMonth = parsedMonth.status === "valid" ? parsedMonth.value : null;
  const [initialMonth] = useState(() => routeMonth ?? activeMonthCoordinator.getMonth());
  const targetMonth = routeMonth ?? initialMonth;
  const [monthAnchor, setMonthAnchor] = useState(targetMonth);
  const months = useMemo(
    () => [...createMonthWindow(monthAnchor, MONTHS_BEFORE, MONTHS_AFTER)],
    [monthAnchor],
  );
  const initialDate =
    targetMonth === currentMonth(timeZone) ? today(timeZone) : `${targetMonth}-01`;
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectionVisible, setSelectionVisible] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(targetMonth);
  useCalendarPerformance(isFocused, visibleMonth, preferences.viewMode);
  const [pageHeight, setPageHeight] = useState(0);
  const { headerOverlap, measureHeader } = useCalendarHeaderOverlap();
  const [pagerResetRevision, setPagerResetRevision] = useState(0);
  const [positionedTarget, setPositionedTarget] = useState<string | null>(null);
  const monthPositioned =
    pageHeight > 0 &&
    positionedTarget ===
      calendarPageTarget(visibleMonth, pagerResetRevision, months[0], pageHeight);
  const controller = useCalendarController({
    month: visibleMonth,
    mode: preferences.viewMode,
    active: isFocused,
    ready: monthPositioned,
    revision: pagerResetRevision,
  });
  const dataYear = controller.displayMonth.slice(0, 4);
  const dataMonths = useMemo(() => calendarDataMonths(dataYear), [dataYear]);
  const isTransitionInFlight = controller.isTransitionInFlight;
  const tryBeginTransition = controller.tryBeginTransition;
  const monthSelectionPending = useRef(false);
  const calendarReady =
    (calendarRange === null && ready) ||
    (preferences.viewMode === "MONTH"
      ? calendarRangeCoversMonth(calendarRange ?? null, visibleMonth)
      : calendarRangeCoversYear(calendarRange ?? null, Number(visibleMonth.slice(0, 4))));
  useCalendarStartup({
    active: isFocused,
    ready: calendarReady && profile !== null && preferences.ready !== false,
    failed: error !== null || !!preferences.error,
    positioned: preferences.viewMode !== "MONTH" || monthPositioned,
  });
  const [headerDirection, setHeaderDirection] = useState<"NEXT" | "PREVIOUS">("NEXT");
  const [headerTransition, setHeaderTransition] = useState<"SPATIAL" | "CROSSFADE">("SPATIAL");
  const [plannerMode, setPlannerMode] = useState(false);
  const plannerTransition = useSharedValue(0);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [stampTool, setStampTool] = useState<QuickEntryStampAction | null>(null);
  const [quickPopup, setQuickPopup] = useState<QuickPopupState | null>(null);
  const dayHighlightOpacity = useSharedValue(1);
  const closeQuickPopup = useCallback(() => setQuickPopup(null), []);
  const { sharedEntriesByDate } = useSharedCalendarDays(timeZone, controller.displayMonth);
  const popupRevision = useRef(0);
  const pendingSelectedDate = useRef<string | null>(null);
  const settledMonth = useRef(targetMonth);

  useEffect(() => {
    if (ready && error === null && profile === null) router.replace("/onboarding");
  }, [error, profile, ready]);
  useEffect(() => {
    const next = targetMonth === currentMonth(timeZone) ? today(timeZone) : `${targetMonth}-01`;
    activeMonthCoordinator.setMonth(targetMonth);
    pendingSelectedDate.current = null;
    setSelectedDate(next);
    setSelectionVisible(false);
    setVisibleMonth(targetMonth);
    setQuickPopup(null);
    settledMonth.current = targetMonth;
    setMonthAnchor(targetMonth);
  }, [activeMonthCoordinator, targetMonth, timeZone]);
  useEffect(() => {
    if (preferences.viewMode !== "MONTH") {
      setPlannerMode(false);
      setStampTool(null);
    }
  }, [preferences.viewMode]);
  useEffect(() => {
    if (isFocused) return;
    setPlannerMode(false);
    setStampTool(null);
    setPlannerError(null);
  }, [isFocused]);

  const { stamp: saveStampAction, displayEntries } = useQuickStampAction({
    entries,
    removeEntry,
    upsertShift,
    onBusyChange: setPlannerBusy,
    onError: (message) => setPlannerError(message || null),
  });

  const entryIndex = useMeasuredCalendarEntries(
    displayEntries,
    dataMonths,
    preferences.showAppointments,
    preferences.showShifts,
  );
  const { entriesByDate } = entryIndex;
  const quickActions = useMemo(() => buildQuickEntryActions(templates), [templates]);
  const quickPlannerActions = useMemo(() => quickEntryServiceActions(quickActions), [quickActions]);
  const visibleHolidayResolution = CalendarHolidays.useCalendarHolidayResolution(
    visibleMonth,
    profile,
    ruleResolver,
    preferences.showHolidays,
  );
  const quickPopupHolidayName = useMemo(() => {
    if (profile === null || quickPopup === null) return undefined;
    return CalendarHolidays.calendarDayLabelForDate(quickPopup.date, profile, ruleResolver);
  }, [profile, quickPopup, ruleResolver]);

  const stampDate = useCallback(
    async (date: string) => {
      if (stampTool === null) return;
      await saveStampAction(stampTool, date);
    },
    [saveStampAction, stampTool],
  );

  const selectDate = useCallback(
    (date: string, anchor: CalendarAnchorRect) => {
      if (!calendarReady || error) return;
      const action = calendarDayPressAction(plannerMode, stampTool !== null);
      if (action === "STAMP") {
        setSelectedDate(date);
        setSelectionVisible(true);
        void stampDate(date);
        return;
      }
      if (action === "AWAIT_TOOL") {
        setSelectedDate(date);
        setSelectionVisible(true);
        AccessibilityInfo.announceForAccessibility(
          "Wähle unten zuerst eine Vorlage für den Schnelleintrag aus.",
        );
        return;
      }
      setSelectedDate(date);
      setSelectionVisible(true);
      setQuickPopup({ date, anchor, revision: ++popupRevision.current });
    },
    [calendarReady, error, plannerMode, stampDate, stampTool],
  );

  const scrollToMonth = useCallback((month: string): boolean => {
    setVisibleMonth(month);
    return true;
  }, []);

  useLayoutEffect(() => {
    const synchronizeMonth = () => {
      const activeMonth = activeMonthCoordinator.getMonth();
      if (activeMonth === settledMonth.current) return;

      setVisibleMonth(activeMonth);
      setQuickPopup(null);
      settledMonth.current = activeMonth;
      setSelectedDate((date) => clampDateToMonth(date, activeMonth));
      setSelectionVisible(false);
      const recenter = shouldRecenterMonthWindow(months, activeMonth);
      if (recenter) {
        setMonthAnchor(activeMonth);
      } else if (preferences.viewMode === "MONTH") {
        scrollToMonth(activeMonth);
      }
    };
    synchronizeMonth();
    // Prepare the native pager while hidden; calendar gestures remain its sole
    // month authority while focused.
    return activeMonthCoordinator.subscribeMonths(() => {
      if (!isFocused) synchronizeMonth();
    });
  }, [activeMonthCoordinator, isFocused, months, preferences.viewMode, scrollToMonth]);

  useFocusEffect(
    useCallback(() => {
      const pending = pendingSelectedDate.current;
      if (pending !== null) {
        pendingSelectedDate.current = null;
        setSelectedDate(pending);
        setSelectionVisible(true);
      }
      if (!consumeShiftSelectionPopupRestore()) setQuickPopup(null);
    }, []),
  );

  const resetTodayUi = useCallback(() => {
    calendarPerformance.begin("request-today");
    monthSelectionPending.current = true;
    setQuickPopup(null);
    setPlannerMode(false);
    setStampTool(null);
    setPlannerError(null);
  }, []);

  const { finishTodayScrollAtMonth, todayScrollActive, animatedTodayRevision } =
    useCalendarTodayScroll({
      activeMonthCoordinator,
      pagerReady: monthPositioned,
      pagerRevision: pagerResetRevision,
      isFocused,
      months,
      reduceMotion: useReducedMotion(),
      resetTransientUi: resetTodayUi,
      setHeaderDirection,
      setHeaderTransition,
      setMonthAnchor,
      setPagerResetRevision,
      setSelectedDate,
      setSelectionVisible,
      setViewMode,
      setVisibleMonth,
      settledMonthRef: settledMonth,
      timeZone,
      viewMode: preferences.viewMode,
      visibleMonth: controller.displayMonth,
    });

  const openMonth = useCallback(
    (month: string) => {
      calendarPerformance.begin("request-month", month);
      if (!tryBeginTransition()) return;
      monthSelectionPending.current = true;
      setQuickPopup(null);
      setSelectedDate((date) => clampDateToMonth(date, month));
      setSelectionVisible(false);
      setHeaderDirection(month >= visibleMonth ? "NEXT" : "PREVIOUS");
      setHeaderTransition("CROSSFADE");
      setVisibleMonth(month);
      activeMonthCoordinator.setMonth(month);
      settledMonth.current = month;
      const recenter = shouldRecenterMonthWindow(months, month);
      if (recenter) setMonthAnchor(month);
      // Invalidate an older gesture; the three native page slots are retained.
      if (month !== visibleMonth) setPagerResetRevision((revision) => revision + 1);
      preferences.setViewMode("MONTH");
    },
    [activeMonthCoordinator, months, preferences, tryBeginTransition, visibleMonth],
  );

  const openYear = useCallback(() => {
    calendarPerformance.begin("request-year", visibleMonth);
    if (!tryBeginTransition()) return;
    if (controller.displayMonth !== visibleMonth) {
      setVisibleMonth(controller.displayMonth);
      activeMonthCoordinator.setMonth(controller.displayMonth);
      settledMonth.current = controller.displayMonth;
      setPagerResetRevision((revision) => revision + 1);
    }
    setQuickPopup(null);
    setSelectionVisible(false);
    setPlannerMode(false);
    setStampTool(null);
    setHeaderTransition("CROSSFADE");
    preferences.setViewMode("YEAR");
  }, [
    activeMonthCoordinator,
    controller.displayMonth,
    preferences,
    tryBeginTransition,
    visibleMonth,
  ]);

  const openCalendarDisplay = useCallback(() => {
    setQuickPopup(null);
    setPlannerMode(false);
    setStampTool(null);
    const notice = !calendarReady
      ? "loading"
      : visibleHolidayResolution.status !== "AVAILABLE"
        ? "holidays"
        : undefined;
    router.push(calendarDesignRoute("calendar", notice));
    selectionFeedback();
  }, [calendarReady, visibleHolidayResolution.status]);

  const measurePager = useCallback(
    (event: LayoutChangeEvent) => {
      // Native iOS paging uses the exact viewport height, including subpixels.
      const nextHeight = event.nativeEvent.layout.height;
      calendarPerformance.record("pager-layout", { height: nextHeight });
      if (nextHeight > 0 && nextHeight !== pageHeight) setPageHeight(nextHeight);
    },
    [pageHeight],
  );

  const clearPopup = useCallback(() => setQuickPopup(null), []);
  const { finishPaging } = useCalendarPaging({
    months,
    pageHeight,
    visibleMonth,
    viewMode: preferences.viewMode,
    isTransitionInFlight,
    monthSelectionPending,
    settledMonthRef: settledMonth,
    activeMonthCoordinator,
    finishTodayScrollAtMonth,
    clearPopup,
    setHeaderDirection,
    setHeaderTransition,
    setVisibleMonth,
    setSelectedDate,
    setSelectionVisible,
    setMonthAnchor,
  });

  const beginPlanning = useCallback(() => {
    setQuickPopup(null);
    setSelectionVisible(false);
    setPlannerError(null);
    setPlannerMode(true);
    setStampTool(null);
    AccessibilityInfo.announceForAccessibility(
      "Planungsmodus geöffnet. Wähle unten eine Vorlage aus.",
    );
  }, []);

  const closePlanning = useCallback(() => {
    setPlannerMode(false);
    setStampTool(null);
    setPlannerError(null);
    AccessibilityInfo.announceForAccessibility("Planungsmodus beendet.");
  }, []);

  const openQuickEditor = useCallback((action: QuickEntryAction, date: string) => {
    pendingSelectedDate.current = date;
    setQuickPopup(null);
    setPlannerMode(false);
    setStampTool(null);
    if (action.kind === "CUSTOM_SHIFT") {
      router.push(quickAddRoute(date));
      return;
    }
    const target = quickEntryEditorTarget(action, date);
    if (target === null) return;
    router.push(dayEditorRoute(target.date, target.mode));
  }, []);

  const selectPlannerAction = useCallback(
    (action: QuickEntryAction) => {
      if (isQuickEntryStampAction(action)) {
        const deselect = stampTool?.key === action.key;
        setStampTool(deselect ? null : action);
        AccessibilityInfo.announceForAccessibility(
          deselect
            ? `${action.label} abgewählt. Wähle unten eine Vorlage aus.`
            : stampToolSelectedAnnouncement(action.label),
        );
        selectionFeedback();
        return;
      }
      openQuickEditor(action, selectedDate);
    },
    [openQuickEditor, selectedDate, stampTool],
  );

  const openShiftPicker = useOpenShiftSelection({ setPlannerMode, setStampTool });
  const openEntry = useCallback((entry: CalendarEntry) => {
    pendingSelectedDate.current = entry.date;
    setQuickPopup(null);
    router.push(dayEditorRoute(entry.date, entry.kind, entry.id));
  }, []);
  const openSharedEntry = useCallback((row: SharedCalendarDayEntry, date: string) => {
    pendingSelectedDate.current = date;
    setQuickPopup(null);
    router.push(sharedDayEditorRoute(date, row.calendarId, row.entry.id));
  }, []);
  const selectPopupAction = useCallback(
    (action: QuickEntryAction, date: string) => {
      if (isQuickEntryStampAction(action)) {
        void saveStampAction(action, date);
        return;
      }
      openQuickEditor(action, date);
    },
    [openQuickEditor, saveStampAction],
  );

  const calendarBottomReserve = process.env.EXPO_OS === "ios" ? 55 : 0;
  const moveYear = useCallback(
    (amount: number) => {
      calendarPerformance.begin("request-year-step", addMonths(visibleMonth, amount * 12));
      if (isTransitionInFlight()) return;
      const nextMonth = addMonths(visibleMonth, amount * 12);
      setQuickPopup(null);
      setHeaderDirection(amount >= 0 ? "NEXT" : "PREVIOUS");
      setHeaderTransition("SPATIAL");
      setVisibleMonth(nextMonth);
      setMonthAnchor(nextMonth);
      activeMonthCoordinator.setMonth(nextMonth);
      settledMonth.current = nextMonth;
      setSelectedDate((date) => clampDateToMonth(date, nextMonth));
      setSelectionVisible(false);
    },
    [activeMonthCoordinator, isTransitionInFlight, visibleMonth],
  );
  const renderMonth = useCalendarMonthRenderer({
    entriesByDate,
    sharedEntriesByDate,
    display: preferences,
    profile,
    onSelectDate: selectDate,
    pageHeight,
    ruleResolver,
    selectedDate: isFocused
      ? (quickPopup?.date ?? (plannerMode && selectionVisible ? selectedDate : null))
      : null,
    selectedDayOpacity: dayHighlightOpacity,
    showHolidays: preferences.showHolidays,
    stampMode: plannerMode,
    stampTransitionProgress: plannerTransition,
    stampToolLabel: stampTool?.label ?? null,
    testMonths,
    isFocused,
    visibleMonth,
  });

  if (ready && error) return <LoadFailureView message={error} onRetry={() => void reload()} />;
  if (profile === null) return <LoadingView />;

  return (
    <View testID="calendar-screen" style={{ flex: 1, backgroundColor: palette.calendarBackground }}>
      <CalendarMonthBackground progress={controller.progress} />
      <View pointerEvents="box-none" style={{ zIndex: 1 }} onLayout={measureHeader}>
        <CalendarHeader
          pageTitle
          synchronized
          notice={
            !calendarReady
              ? "Kalenderdaten werden geladen …"
              : visibleHolidayResolution.status !== "AVAILABLE"
                ? "Feiertagsregeln für diesen Zeitraum noch nicht verfügbar."
                : undefined
          }
          direction={headerDirection}
          month={controller.displayMonth}
          onMoveYear={moveYear}
          onOpenSharing={() => router.push("/calendar-sharing")}
          onOpenDisplay={openCalendarDisplay}
          onOpenYear={openYear}
          plannerActive={plannerMode}
          plannerTransition={plannerTransition}
          referenceMonth={currentMonth(timeZone)}
          transition={headerTransition}
          viewMode={controller.mode}
        />
        <SharedCalendarFilters
          ownVisible={preferences.showShifts}
          onOwnVisible={preferences.setShowShifts}
        />
        {plannerError ? (
          <View
            style={{
              paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
              paddingBottom: SPACING.sm,
            }}
          >
            <InlineNotice message={plannerError} tone="error" />
          </View>
        ) : null}
        {preferences.error ? (
          <View
            style={{
              gap: SPACING.sm,
              paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
              paddingBottom: SPACING.sm,
            }}
          >
            <InlineNotice message={preferences.error} tone="error" />
            <PrimaryButton disabled={preferences.saving} onPress={preferences.retry}>
              Speichern erneut versuchen
            </PrimaryButton>
          </View>
        ) : null}
      </View>
      <SharedCalendarScene
        headerOverlap={headerOverlap}
        showBackground={false}
        controller={controller}
        entriesByDate={entriesByDate}
        referenceMonth={currentMonth(profile?.timeZone ?? "Europe/Berlin")}
        pastelColors={preferences.pastelColors}
        month={visibleMonth}
        viewMode={preferences.viewMode}
        active={isFocused}
        bottomReserve={calendarBottomReserve}
        onSelectMonth={openMonth}
      >
        <View
          style={{ flex: 1 }}
          pointerEvents={todayScrollActive ? "none" : "auto"}
          testID="calendar-month-scene"
        >
          <Animated.View
            onLayout={measurePager}
            testID="calendar-month-pager-shell"
            style={{ flex: 1 }}
          >
            {pageHeight > 0 ? (
              <CalendarStablePager
                onVisibleMonth={controller.previewMonth}
                month={visibleMonth}
                months={months}
                height={pageHeight}
                revision={pagerResetRevision}
                enabled={preferences.viewMode === "MONTH"}
                animatedRevision={animatedTodayRevision}
                transitioning={controller.busy}
                onPositioned={setPositionedTarget}
                onSettled={finishPaging}
                onBeginDrag={() => {
                  calendarPerformance.begin("scroll-begin", visibleMonth);
                  if (!isTransitionInFlight()) monthSelectionPending.current = false;
                }}
                renderMonth={renderMonth}
              />
            ) : null}
          </Animated.View>
        </View>
      </SharedCalendarScene>
      <CalendarQuickOverlay modal={quickPopup !== null && isFocused}>
        {quickPopup ? (
          <QuickEntryPopup
            key={quickPopup.revision}
            active={isFocused}
            windowOverlay={false}
            actions={quickActions}
            anchor={quickPopup.anchor}
            busy={plannerBusy}
            date={quickPopup.date}
            timeZone={timeZone}
            entries={entriesByDate.get(quickPopup.date) ?? []}
            sharedEntries={sharedEntriesByDate.get(quickPopup.date) ?? []}
            onOpenSharedEntry={openSharedEntry}
            holidayName={quickPopupHolidayName}
            onClose={closeQuickPopup}
            highlightOpacity={dayHighlightOpacity}
            onOpenEntry={openEntry}
            onDeleteEntry={removeEntry}
            onOpenShiftPicker={openShiftPicker}
            onSelectAction={selectPopupAction}
          />
        ) : null}
        {preferences.viewMode !== "MONTH" ? null : (
          <QuickPlannerDock
            active={isFocused}
            actions={quickPlannerActions}
            activeKey={stampTool?.key ?? null}
            busy={plannerBusy}
            onOpen={beginPlanning}
            onClose={closePlanning}
            onSelectAction={selectPlannerAction}
            open={plannerMode}
            transitionProgress={plannerTransition}
            windowOverlay={false}
          />
        )}
      </CalendarQuickOverlay>
    </View>
  );
}
