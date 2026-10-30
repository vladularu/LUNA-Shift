import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useMemo, useRef, useState } from "react";
import { useCalendarTodayScroll } from "./use-calendar-today-scroll";
import { createMonthWindow } from "./month-window";
import { createActiveMonthCoordinator } from "@/navigation/active-month";

let mockRequestRevision = 1;
jest.mock("@/navigation/active-month", () => ({
  ...jest.requireActual<typeof import("@/navigation/active-month")>("@/navigation/active-month"),
  useCalendarTodayRequestRevision: () => mockRequestRevision,
}));
jest.mock("@/engine/calendar", () => ({
  ...jest.requireActual<typeof import("@/engine/calendar")>("@/engine/calendar"),
  today: () => "2027-01-15",
}));

beforeEach(() => {
  mockRequestRevision = 1;
});
const initialProps = {
  positionedRevision: 0,
  focused: true,
  ready: true,
  reduced: false,
  mode: "MONTH" as "MONTH" | "YEAR",
};
function setup(initialMonth = "2026-12") {
  const coordinator = createActiveMonthCoordinator(initialMonth);
  coordinator.requestToday();
  const resetTransientUi = jest.fn();
  function useHarness(props: typeof initialProps) {
    const [month, setVisibleMonth] = useState(initialMonth);
    const [anchor, setMonthAnchor] = useState(initialMonth);
    const [selected, setSelectedDate] = useState("");
    const [selection, setSelectionVisible] = useState(false);
    const [, setHeaderDirection] = useState<"NEXT" | "PREVIOUS">("NEXT");
    const [, setHeaderTransition] = useState<"SPATIAL" | "CROSSFADE">("SPATIAL");
    const [pagerRevision, setPagerResetRevision] = useState(0);
    const settledMonthRef = useRef(initialMonth);
    const months = useMemo(() => createMonthWindow(anchor, 24, 36), [anchor]);
    const scroll = useCalendarTodayScroll({
      activeMonthCoordinator: coordinator,
      pagerReady: props.ready && pagerRevision === props.positionedRevision,
      pagerRevision,
      isFocused: props.focused,
      months,
      reduceMotion: props.reduced,
      resetTransientUi,
      setHeaderDirection,
      setHeaderTransition,
      setMonthAnchor,
      setPagerResetRevision,
      setSelectedDate,
      setSelectionVisible,
      setViewMode: () => {},
      setVisibleMonth,
      settledMonthRef,
      timeZone: "Europe/Berlin",
      viewMode: props.mode,
      visibleMonth: month,
    });
    return { ...scroll, month, selected, selection, pagerRevision, setVisibleMonth };
  }
  return { coordinator, hook: useHarness, resetTransientUi };
}

describe("Today native return", () => {
  it("lets a new external month replace the pending Today destination", async () => {
    const { hook, coordinator } = setup();
    const screen = await renderHook(hook, { initialProps });
    await act(async () => screen.result.current.setVisibleMonth("2027-06"));
    expect(screen.result.current).toMatchObject({ month: "2027-06", todayScrollActive: false });
    expect(coordinator.hasPendingTodayRequest(1)).toBe(false);
    await screen.rerender({ ...initialProps, positionedRevision: 1 });
    expect(screen.result.current.month).toBe("2027-06");
  });
  it.each(["2026-11", "2026-12", "2027-02", "2027-03"])(
    "animates from %s and completes only after native positioning",
    async (month) => {
      const { hook, coordinator } = setup(month);
      const screen = await renderHook(hook, { initialProps });
      expect(screen.result.current).toMatchObject({
        month: "2027-01",
        todayScrollActive: true,
        animatedTodayRevision: 1,
        selection: false,
      });
      expect(coordinator.hasPendingTodayRequest(1)).toBe(true);
      await screen.rerender({ ...initialProps, positionedRevision: 1 });
      expect(screen.result.current).toMatchObject({
        month: "2027-01",
        selected: "2027-01-15",
        selection: true,
        todayScrollActive: false,
      });
      expect(coordinator.hasPendingTodayRequest(1)).toBe(false);
    },
  );
  it.each(["2026-10", "2027-04", "2024-01", "2030-01", "2027-01"])(
    "jumps immediately from %s",
    async (month) => {
      const { hook, coordinator } = setup(month);
      const screen = await renderHook(hook, { initialProps });
      expect(screen.result.current).toMatchObject({
        month: "2027-01",
        todayScrollActive: false,
        animatedTodayRevision: undefined,
        selection: true,
      });
      expect(coordinator.hasPendingTodayRequest(1)).toBe(false);
    },
  );
  it.each([{ reduced: true }, { mode: "YEAR" as const }, { ready: false }])(
    "uses a direct jump with %o",
    async (override) => {
      const { hook } = setup();
      const screen = await renderHook(hook, { initialProps: { ...initialProps, ...override } });
      expect(screen.result.current.todayScrollActive).toBe(false);
      expect(screen.result.current.month).toBe("2027-01");
    },
  );
  it("a repeated Today request cancels the older animation and completes only the latest request", async () => {
    const { hook, coordinator } = setup();
    const screen = await renderHook(hook, { initialProps });
    mockRequestRevision = coordinator.requestToday();
    await screen.rerender(initialProps);
    expect(screen.result.current).toMatchObject({ pagerRevision: 2, todayScrollActive: false });
    expect(coordinator.hasPendingTodayRequest(2)).toBe(false);
  });
  it("does not animate hidden tabs and completes positioning after refocus", async () => {
    const { hook, coordinator } = setup();
    const screen = await renderHook(hook, { initialProps });
    await screen.rerender({ ...initialProps, focused: false, positionedRevision: 1 });
    expect(screen.result.current.animatedTodayRevision).toBeUndefined();
    expect(coordinator.hasPendingTodayRequest(1)).toBe(true);
    await screen.rerender({ ...initialProps, positionedRevision: 1 });
    expect(coordinator.hasPendingTodayRequest(1)).toBe(false);
  });
  it("does not finish an interrupted animation over the user's year navigation", async () => {
    const { hook, coordinator } = setup();
    const screen = await renderHook(hook, { initialProps });
    await screen.rerender({ ...initialProps, mode: "YEAR" });
    expect(screen.result.current.todayScrollActive).toBe(false);
    expect(coordinator.hasPendingTodayRequest(1)).toBe(false);
  });
});
