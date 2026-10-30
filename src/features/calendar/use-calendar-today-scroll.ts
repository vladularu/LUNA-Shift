import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { today } from "@/engine/calendar";
import { calendarTodayTarget } from "./calendar-layout";
import { shouldAnimateTodayScroll } from "./month-window";
import {
  useCalendarTodayRequestRevision,
  type ActiveMonthCoordinator,
} from "@/navigation/active-month";
import { selectionFeedback } from "@/ui/haptics";

interface TodayScrollState {
  readonly requestRevision: number;
  readonly pagerRevision: number;
  readonly targetDate: string;
  readonly targetMonth: string;
}
interface CalendarTodayScrollOptions {
  readonly activeMonthCoordinator: ActiveMonthCoordinator;
  readonly pagerReady: boolean;
  readonly pagerRevision: number;
  readonly isFocused: boolean;
  readonly months: readonly string[];
  readonly reduceMotion: boolean | null;
  readonly resetTransientUi: () => void;
  readonly setHeaderDirection: Dispatch<SetStateAction<"NEXT" | "PREVIOUS">>;
  readonly setHeaderTransition: Dispatch<SetStateAction<"SPATIAL" | "CROSSFADE">>;
  readonly setMonthAnchor: Dispatch<SetStateAction<string>>;
  readonly setPagerResetRevision: Dispatch<SetStateAction<number>>;
  readonly setSelectedDate: Dispatch<SetStateAction<string>>;
  readonly setSelectionVisible: Dispatch<SetStateAction<boolean>>;
  readonly setViewMode: (viewMode: "MONTH") => void;
  readonly setVisibleMonth: Dispatch<SetStateAction<string>>;
  readonly settledMonthRef: { current: string };
  readonly timeZone: string;
  readonly viewMode: "MONTH" | "YEAR";
  readonly visibleMonth: string;
}

/** Native page positioning owns completion; no second scroll clock races its events. */
export function useCalendarTodayScroll(options: CalendarTodayScrollOptions) {
  const {
    activeMonthCoordinator,
    pagerReady,
    pagerRevision,
    isFocused,
    months,
    reduceMotion,
    resetTransientUi,
    setHeaderDirection,
    setHeaderTransition,
    setMonthAnchor,
    setPagerResetRevision,
    setSelectedDate,
    setSelectionVisible,
    setViewMode,
    setVisibleMonth,
    settledMonthRef,
    timeZone,
    viewMode,
    visibleMonth,
  } = options;
  const todayRequestRevision = useCalendarTodayRequestRevision();
  const [todayScroll, setTodayScroll] = useState<TodayScrollState | null>(null);
  const completeTodayScroll = useCallback(
    (scroll: TodayScrollState) => {
      setSelectedDate(scroll.targetDate);
      setSelectionVisible(true);
      setVisibleMonth(scroll.targetMonth);
      activeMonthCoordinator.setMonth(scroll.targetMonth);
      settledMonthRef.current = scroll.targetMonth;
      setTodayScroll(null);
      activeMonthCoordinator.completeTodayRequest(scroll.requestRevision);
      selectionFeedback();
    },
    [
      activeMonthCoordinator,
      setSelectedDate,
      setSelectionVisible,
      setVisibleMonth,
      settledMonthRef,
    ],
  );

  useEffect(() => {
    if (
      !isFocused ||
      todayScroll?.requestRevision === todayRequestRevision ||
      !activeMonthCoordinator.hasPendingTodayRequest(todayRequestRevision)
    )
      return;
    const target = calendarTodayTarget(today(timeZone));
    const animate =
      viewMode === "MONTH" &&
      reduceMotion === false &&
      pagerReady &&
      months.includes(target.visibleMonth) &&
      shouldAnimateTodayScroll(visibleMonth, target.visibleMonth);
    const scroll = {
      requestRevision: todayRequestRevision,
      pagerRevision: pagerRevision + 1,
      targetDate: target.selectedDate,
      targetMonth: target.visibleMonth,
    };
    resetTransientUi();
    setHeaderTransition(viewMode === "MONTH" ? "SPATIAL" : "CROSSFADE");
    setHeaderDirection(target.visibleMonth > visibleMonth ? "NEXT" : "PREVIOUS");
    setViewMode("MONTH");
    setPagerResetRevision(scroll.pagerRevision);
    if (!animate) {
      if (target.visibleMonth !== visibleMonth) setMonthAnchor(target.visibleMonth);
      completeTodayScroll(scroll);
      return;
    }
    setSelectedDate(target.selectedDate);
    setSelectionVisible(false);
    setVisibleMonth(target.visibleMonth);
    activeMonthCoordinator.setMonth(target.visibleMonth);
    settledMonthRef.current = target.visibleMonth;
    setTodayScroll(scroll);
  }, [
    activeMonthCoordinator,
    completeTodayScroll,
    isFocused,
    months,
    pagerReady,
    pagerRevision,
    reduceMotion,
    resetTransientUi,
    setHeaderDirection,
    setHeaderTransition,
    setMonthAnchor,
    setPagerResetRevision,
    setSelectedDate,
    setSelectionVisible,
    setViewMode,
    setVisibleMonth,
    settledMonthRef,
    timeZone,
    todayRequestRevision,
    todayScroll,
    viewMode,
    visibleMonth,
  ]);

  useEffect(() => {
    if (!todayScroll) return;
    if (
      viewMode !== "MONTH" ||
      pagerRevision !== todayScroll.pagerRevision ||
      visibleMonth !== todayScroll.targetMonth
    ) {
      activeMonthCoordinator.completeTodayRequest(todayScroll.requestRevision);
      setTodayScroll(null);
    } else if (isFocused && pagerReady) {
      completeTodayScroll(todayScroll);
    }
  }, [
    activeMonthCoordinator,
    completeTodayScroll,
    isFocused,
    pagerReady,
    pagerRevision,
    todayScroll,
    viewMode,
    visibleMonth,
  ]);

  const finishTodayScrollAtMonth = useCallback(
    (month: string): boolean => {
      if (!todayScroll) return false;
      if (month === todayScroll.targetMonth) completeTodayScroll(todayScroll);
      return true;
    },
    [completeTodayScroll, todayScroll],
  );
  return {
    finishTodayScrollAtMonth,
    todayScrollActive: todayScroll !== null,
    animatedTodayRevision:
      isFocused && reduceMotion === false ? todayScroll?.pagerRevision : undefined,
  } as const;
}
