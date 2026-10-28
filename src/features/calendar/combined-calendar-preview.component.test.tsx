import { render, renderHook, within } from "@testing-library/react-native";
import { expect, it, jest } from "@jest/globals";
import { View, StyleSheet } from "react-native";
import { usePalette } from "@/theme/palette";
import { sharedCalendarChipPalette } from "@/theme/color-contrast";
import { CALENDAR_METRICS } from "@/theme/tokens";
import { getAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { ShiftEntry } from "@/domain/types";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import { calendarPrototypeLayout } from "./calendar-prototype-layout";
import { PrototypeMonthContent, PrototypeDates } from "./calendar-prototype-canvas";
import { quickStampEntering, quickStampExiting } from "./quick-stamp-motion";

let mockReducedMotion = false;
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...jest.requireActual<typeof import("react-native-reanimated")>("react-native-reanimated"),
  useReducedMotion: () => mockReducedMotion,
}));

it("renders both actual services in the same short six-week day cell", async () => {
  const own: ShiftEntry = {
    kind: "SHIFT",
    id: "own",
    date: "2026-03-13",
    title: "Spät",
    type: "LATE",
    templateId: "late",
    allDay: false,
    startTime: "13:18",
    endTime: "21:30",
    breakMinutes: 30,
    color: "#E55165",
    symbol: "sun",
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-03-01T12:00:00Z",
    updatedAt: "2026-03-01T12:00:00Z",
    deletedAt: null,
  };
  const shared: SharedCalendarDayEntry = {
    calendarId: "selena",
    calendarName: "Selena",
    calendarColor: "#527D92",
    fetchedAt: "2026-03-13T12:00:00Z",
    when: "21:00–07:30",
    entry: {
      id: "foreign",
      title: "Nacht",
      color: "#6B67BE",
      symbol: "moon",
      startsAt: "2026-03-13T20:00:00Z",
      endsAt: "2026-03-14T06:30:00Z",
      timeZone: "Europe/Berlin",
      allDay: false,
    },
  };
  const { result } = await renderHook(() => useSharedValue(1));
  const layout = calendarPrototypeLayout("2026-03", 390, 500);
  const content = (
    rows: readonly SharedCalendarDayEntry[],
    ownEntry = own,
    animateChanges = false,
  ) => (
    <View>
      <PrototypeMonthContent
        animateChanges={animateChanges}
        layout={layout}
        progress={result.current}
        entriesByDate={new Map([[own.date, [ownEntry]]])}
        sharedEntriesByDate={new Map([[own.date, rows]])}
        holidays={new Map()}
        display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: false }}
        timeZone="Europe/Berlin"
        visible
      />
      <PrototypeDates layout={layout} progress={result.current} currentDate="2026-03-13" />
    </View>
  );
  const screen = await render(content([shared]));
  const cell = within(screen.getByTestId("calendar-combined-entries-2026-03-13"));
  expect(cell.getByText("Spät")).toBeTruthy();
  expect(cell.getByText("13:18")).toBeTruthy();
  expect(cell.getByText("Nacht")).toBeTruthy();
  expect(cell.getByText("21:00")).toBeTruthy();
  expect(screen.queryByTestId("shared-calendar-day-2026-03-13")).toBeNull();
  const { result: palette } = await renderHook(() => usePalette());
  const sharedStyle = StyleSheet.flatten(
    screen.getByTestId("shared-calendar-entry-selena-foreign").props.style,
  );
  expect(sharedStyle.borderLeftWidth).toBe(CALENDAR_METRICS.sharedCalendarStripeWidth);
  expect(sharedStyle.borderLeftColor).toBe(shared.calendarColor);
  expect(screen.getByText("21:00")).toHaveStyle({
    color: sharedCalendarChipPalette(shared.entry.color, palette.current.dark).onDetail,
  });
  const day = screen.getByTestId("calendar-combined-day-2026-03-13"),
    slot = screen.getByTestId("calendar-entry-slot-2026-03-13-0");
  const slotHeight = StyleSheet.flatten(slot.props.style).height,
    titleHeight = screen.getByText("Spät").props.style;
  const marker = screen.getByTestId("calendar-date-marker-2026-03-13", {
    includeHiddenElements: true,
  });
  const pose = getAnimatedStyle(marker);
  for (const rows of [[], [shared], []]) {
    await screen.rerender(content(rows));
    expect(screen.getByTestId("calendar-combined-day-2026-03-13")).toBe(day);
    expect(screen.getByTestId("calendar-entry-slot-2026-03-13-0")).toBe(slot);
    expect(StyleSheet.flatten(slot.props.style).height).toBe(slotHeight);
    expect(screen.getByText("Spät").props.style).toEqual(titleHeight);
    expect(
      getAnimatedStyle(
        screen.getByTestId("calendar-date-marker-2026-03-13", { includeHiddenElements: true }),
      ),
    ).toEqual(pose);
  }
  expect(slot.props.entering).toBeUndefined();
  await screen.rerender(content([], own, true));
  expect(screen.getByTestId("calendar-entry-slot-2026-03-13-0")).toBe(slot);
  expect(slot.props.entering).toBe(quickStampEntering);
  expect(slot.props.exiting).toBe(quickStampExiting);
  await screen.rerender(content([], { ...own, id: "persisted-after-optimistic-save" }, true));
  expect(screen.getByTestId("calendar-entry-slot-2026-03-13-0")).toBe(slot);
  mockReducedMotion = true;
  try {
    await screen.rerender(content([], own, true));
    expect(slot.props.entering.build()({}).initialValues.transform).toBeUndefined();
    expect(slot.props.exiting.build()({}).initialValues.transform).toBeUndefined();
  } finally {
    mockReducedMotion = false;
  }
});

it("keeps weekend numbers red including adjacent months and preserves selection colors", async () => {
  const { result } = await renderHook(() => ({
    progress: useSharedValue(1),
    palette: usePalette(),
  }));
  const layout = calendarPrototypeLayout("2026-10", 390, 500);
  const screen = await render(
    <View>
      <PrototypeMonthContent
        layout={layout}
        progress={result.current.progress}
        entriesByDate={new Map()}
        holidays={new Map()}
        display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: false }}
        timeZone="Europe/Berlin"
        visible
      />
      <PrototypeDates
        layout={layout}
        progress={result.current.progress}
        currentDate="2026-10-13"
        selectedDate="2026-10-04"
      />
    </View>,
  );
  const p = result.current.palette;
  const number = (date: string) =>
    within(
      screen.getByTestId("calendar-date-marker-" + date, { includeHiddenElements: true }),
    ).getByTestId("calendar-base-label-calendar-date-marker-" + date, {
      includeHiddenElements: true,
    });
  expect(number("2026-10-03")).toHaveStyle({ color: p.danger });
  expect(
    screen.getByTestId("calendar-active-label-calendar-date-marker-2026-10-04", {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({ color: p.onCalendarToday });
  expect(number("2026-10-13")).toHaveStyle({ color: p.onCalendarToday });
  expect(number("2026-10-05")).toHaveStyle({ color: p.text });
  expect(screen.getByTestId("calendar-adjacent-2026-11-07")).toHaveStyle({ color: p.danger });
  for (const label of within(screen.getByTestId("calendar-month-weekdays")).getAllByText("S"))
    expect(label).toHaveStyle({ color: p.danger });
});

it.each([1, 0.5, 0])(
  "fades the selected circle with the popup opacity %s while keeping today marked",
  async (opacity) => {
    const { result } = await renderHook(() => ({
      progress: useSharedValue(1),
      selectedDayOpacity: useSharedValue(opacity),
      palette: usePalette(),
    }));
    const screen = await render(
      <PrototypeDates
        layout={calendarPrototypeLayout("2026-10", 390, 500)}
        progress={result.current.progress}
        currentDate="2026-10-13"
        selectedDate="2026-10-04"
        selectedDayOpacity={result.current.selectedDayOpacity}
      />,
    );
    const hidden = { includeHiddenElements: true };
    expect(
      getAnimatedStyle(
        screen.getByTestId("calendar-selection-calendar-date-marker-2026-10-04", hidden),
      ).opacity,
    ).toBe(opacity);
    expect(
      screen.getByTestId("calendar-highlight-calendar-date-marker-2026-10-13", hidden),
    ).toHaveStyle({ opacity: 1 });
    expect(
      screen.getByTestId("calendar-base-label-calendar-date-marker-2026-10-04", hidden),
    ).toHaveStyle({ color: result.current.palette.danger, fontWeight: "500" });
    expect(
      screen.getByTestId("calendar-active-label-calendar-date-marker-2026-10-04", hidden),
    ).toHaveStyle({ color: result.current.palette.onCalendarToday, fontWeight: "700" });
  },
);

it("uses the same smaller marker for today and the open day without moving either date", async () => {
  const { result } = await renderHook(() => ({
    progress: useSharedValue(1),
    palette: usePalette(),
  }));
  const layout = calendarPrototypeLayout("2026-10", 390, 500);
  const content = (selectedDate: string | null) => (
    <PrototypeDates
      layout={layout}
      progress={result.current.progress}
      currentDate="2026-10-13"
      selectedDate={selectedDate}
    />
  );
  const screen = await render(content("2026-10-08"));
  const hidden = { includeHiddenElements: true };
  const todayFill = screen.getByTestId(
    "calendar-highlight-calendar-date-marker-2026-10-13",
    hidden,
  );
  const openFill = screen.getByTestId("calendar-highlight-calendar-date-marker-2026-10-08", hidden);
  const marker = screen.getByTestId("calendar-date-marker-2026-10-08", hidden);
  const pose = getAnimatedStyle(marker);
  expect(todayFill).toHaveStyle({
    width: 24,
    height: 24,
    backgroundColor: result.current.palette.calendarToday,
  });
  expect(openFill).toHaveStyle({
    width: 24,
    height: 24,
    backgroundColor: result.current.palette.calendarToday,
  });
  await screen.rerender(content(null));
  expect(screen.getByTestId("calendar-date-marker-2026-10-08", hidden)).toBe(marker);
  expect(getAnimatedStyle(marker)).toEqual(pose);
  expect(
    screen.queryByTestId("calendar-selection-calendar-date-marker-2026-10-08", hidden),
  ).toBeNull();
  expect(
    screen.getByTestId("calendar-highlight-calendar-date-marker-2026-10-08", hidden),
  ).toHaveStyle({ backgroundColor: "transparent" });
  expect(todayFill).toHaveStyle({ backgroundColor: result.current.palette.calendarToday });
});

it.each([1, 0])(
  "keeps the normal glyph mounted and unchanged at popup opacity %s",
  async (opacity) => {
    const { result } = await renderHook(() => ({
      progress: useSharedValue(1),
      opacity: useSharedValue(opacity),
      palette: usePalette(),
    }));
    const layout = calendarPrototypeLayout("2026-10", 390, 500);
    const content = (selectedDate: string | null) => (
      <PrototypeDates
        layout={layout}
        progress={result.current.progress}
        currentDate="2026-10-13"
        selectedDate={selectedDate}
        selectedDayOpacity={result.current.opacity}
      />
    );
    const screen = await render(content(null));
    const hidden = { includeHiddenElements: true };
    const id = "calendar-base-label-calendar-date-marker-2026-10-04";
    const number = screen.getByTestId(id, hidden);
    const normalStyle = number.props.style;
    const marker = screen.getByTestId("calendar-date-marker-2026-10-04", hidden);
    const pose = getAnimatedStyle(marker);
    await screen.rerender(content("2026-10-04"));
    expect(screen.getByTestId(id, hidden)).toBe(number);
    expect(number.props.style).toEqual(normalStyle);
    expect(
      getAnimatedStyle(
        screen.getByTestId("calendar-selection-calendar-date-marker-2026-10-04", hidden),
      ).opacity,
    ).toBe(opacity);
    expect(number).toHaveStyle({ fontWeight: "500", color: result.current.palette.danger });
    await screen.rerender(content(null));
    expect(screen.getByTestId(id, hidden)).toBe(number);
    expect(number.props.style).toEqual(normalStyle);
    expect(
      screen.queryByTestId("calendar-selection-calendar-date-marker-2026-10-04", hidden),
    ).toBeNull();
    expect(screen.getByTestId("calendar-date-marker-2026-10-04", hidden)).toBe(marker);
    expect(getAnimatedStyle(marker)).toEqual(pose);
  },
);

it("keeps today bold and marked when its day tile closes", async () => {
  const { result } = await renderHook(() => ({
    progress: useSharedValue(1),
    opacity: useSharedValue(0),
    palette: usePalette(),
  }));
  const screen = await render(
    <PrototypeDates
      layout={calendarPrototypeLayout("2026-10", 390, 500)}
      progress={result.current.progress}
      currentDate="2026-10-13"
      selectedDate="2026-10-13"
      selectedDayOpacity={result.current.opacity}
    />,
  );
  const hidden = { includeHiddenElements: true };
  expect(
    screen.getByTestId("calendar-base-label-calendar-date-marker-2026-10-13", hidden),
  ).toHaveStyle({ fontWeight: "700", color: result.current.palette.onCalendarToday });
  expect(
    screen.getByTestId("calendar-highlight-calendar-date-marker-2026-10-13", hidden),
  ).toHaveStyle({ opacity: 1, backgroundColor: result.current.palette.calendarToday });
  expect(
    screen.queryByTestId("calendar-selection-calendar-date-marker-2026-10-13", hidden),
  ).toBeNull();
});
