import { render, renderHook, within } from "@testing-library/react-native";
import { expect, it } from "@jest/globals";
import { View } from "react-native";
import { getAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { ShiftEntry } from "@/domain/types";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import { calendarPrototypeLayout } from "./calendar-prototype-layout";
import { PrototypeMonthContent, PrototypeDates } from "./calendar-prototype-canvas";

it("renders both actual services in the same short six-week day cell", async () => {
  const own: ShiftEntry = {
    kind: "SHIFT",
    id: "own",
    date: "2026-03-13",
    title: "Spät",
    type: "LATE",
    templateId: null,
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
  const content = (rows: readonly SharedCalendarDayEntry[]) => (
    <View>
      <PrototypeMonthContent
        layout={layout}
        progress={result.current}
        entriesByDate={new Map([[own.date, [own]]])}
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
  const day = screen.getByTestId("calendar-combined-day-2026-03-13"),
    slot = screen.getByTestId("calendar-entry-slot-2026-03-13-0");
  const slotHeight = slot.props.style.height,
    titleHeight = screen.getByText("Spät").props.style;
  const marker = screen.getByTestId("calendar-date-marker-2026-03-13", {
    includeHiddenElements: true,
  });
  const pose = getAnimatedStyle(marker);
  for (const rows of [[], [shared], []]) {
    await screen.rerender(content(rows));
    expect(screen.getByTestId("calendar-combined-day-2026-03-13")).toBe(day);
    expect(screen.getByTestId("calendar-entry-slot-2026-03-13-0")).toBe(slot);
    expect(slot.props.style.height).toBe(slotHeight);
    expect(screen.getByText("Spät").props.style).toEqual(titleHeight);
    expect(
      getAnimatedStyle(
        screen.getByTestId("calendar-date-marker-2026-03-13", { includeHiddenElements: true }),
      ),
    ).toEqual(pose);
  }
});
