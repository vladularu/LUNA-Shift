import { act, fireEvent, render, renderHook, within } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { AppState } from "react-native";
import { getAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { CalendarBackgroundContext } from "@/features/settings/calendar-background-context";
import type { CalendarEntry, CalendarViewMode, UserProfile } from "@/domain/types";
import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { work } from "@/engine/remuneration-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { SharedCalendarMonth, SharedCalendarScene } from "./calendar-shared-scene";

import {
  CALENDAR_IMAGE_STRENGTH_OPTIONS,
  DEFAULT_CALENDAR_IMAGE_STRENGTH,
  type CalendarImageStrength,
} from "@/theme/calendar-image";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette";

const profile = {
  federalState: "HE",
  holidayRegion: "NONE",
  timeZone: "Europe/Berlin",
} as UserProfile;
const display = { labelMode: "FULL" as const, showShiftTimes: true, showShiftDuration: false };
const onSelectDate = jest.fn();
const onSelectMonth = jest.fn();
const onStart = jest.fn();
const onComplete = jest.fn();
const appointment: CalendarEntry = {
  kind: "APPOINTMENT",
  id: "live",
  date: "2026-01-08",
  title: "Termin alt",
  allDay: true,
  startTime: null,
  endTime: null,
  color: "#334455",
  note: null,
  revision: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};
function Tree({
  mode = "MONTH",
  entries = [],
  active = true,
  stampMode = false,
  stampTransitionProgress,
  month = "2026-01",
  userProfile = profile,
  showHolidays = true,
  dayDisplay = display,
  selectedDate = "2026-01-08",
}: {
  mode?: CalendarViewMode;
  entries?: CalendarEntry[];
  active?: boolean;
  stampMode?: boolean;
  stampTransitionProgress?: SharedValue<number>;
  month?: string;
  userProfile?: UserProfile;
  showHolidays?: boolean;
  dayDisplay?: typeof display;
  selectedDate?: string;
}) {
  return (
    <SharedCalendarScene
      month={month}
      viewMode={mode}
      active={active}
      bottomReserve={55}
      onSelectMonth={onSelectMonth}
      onTransitionStart={onStart}
      onTransitionComplete={onComplete}
    >
      <SharedCalendarMonth
        month={month}
        pageHeight={700}
        entriesByDate={new Map([["2026-01-08", entries]])}
        display={dayDisplay}
        profile={userProfile}
        ruleResolver={bundledRuleResolver}
        showHolidays={showHolidays}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        accessibilityVisible={active}
        testData={false}
        stampMode={stampMode}
        stampTransitionProgress={stampTransitionProgress}
      />
    </SharedCalendarScene>
  );
}
function BackgroundTree({
  uri,
  mode = "MONTH",
  strength = DEFAULT_CALENDAR_IMAGE_STRENGTH,
}: {
  uri: string | null;
  mode?: CalendarViewMode;
  strength?: CalendarImageStrength;
}) {
  return (
    <CalendarBackgroundContext
      value={{
        uri,
        strength,
        setStrength: async () => {},
        ready: true,
        busy: false,
        error: null,
        supported: true,
        choose: async () => {},
        remove: async () => {},
        canUndoRemoval: false,
        undoRemove: async () => {},
        reset: async () => true,
        retry: () => {},
      }}
    >
      <Tree mode={mode} />
    </CalendarBackgroundContext>
  );
}

describe("shared live calendar scene", () => {
  it("retains the selected-date glyph while hidden beneath an editor without a focus handoff", async () => {
    const hidden = { includeHiddenElements: true };
    const screen = await render(<Tree />);
    const marker = screen.getByTestId("calendar-date-marker-2026-01-08", hidden);
    expect(
      screen.getByTestId("calendar-highlight-calendar-date-marker-2026-01-08", hidden),
    ).toHaveStyle({ backgroundColor: LIGHT_PALETTE.calendarToday });
    await screen.rerender(<Tree active={false} />);
    expect(screen.getByTestId("calendar-date-marker-2026-01-08", hidden)).toBe(marker);
    expect(
      screen.getByTestId("calendar-highlight-calendar-date-marker-2026-01-08", hidden),
    ).toHaveStyle({ backgroundColor: LIGHT_PALETTE.calendarToday });
    await screen.rerender(<Tree />);
    expect(screen.getByTestId("calendar-date-marker-2026-01-08", hidden)).toBe(marker);
    expect(
      screen.getByTestId("calendar-highlight-calendar-date-marker-2026-01-08", hidden),
    ).toHaveStyle({ backgroundColor: LIGHT_PALETTE.calendarToday });
  });

  it("tracks the planner clock through opening, reversal and closing without remounting outlines", async () => {
    const clock = await renderHook(() => useSharedValue(0));
    const progress = clock.result.current;
    const screen = await render(
      <Tree entries={[appointment]} stampMode stampTransitionProgress={progress} />,
    );
    const outline = screen.getByTestId("quick-stamp-outline-2026-01-09");
    expect(screen.queryByTestId("quick-stamp-outline-2026-01-08")).toBeNull();
    for (const value of [0.25, 0.75, 0.5, 1, 0.5, 0]) {
      await act(() => {
        progress.value = value;
      });
      expect(getAnimatedStyle(outline)).toMatchObject({
        opacity: value,
      });
      expect(screen.getByTestId("quick-stamp-outline-2026-01-09")).toBe(outline);
    }
  });

  it("uses compact entry-height placeholders and keeps the entire day tappable", async () => {
    const screen = await render(<Tree stampMode />);
    await fireEvent(screen.getByTestId("calendar-shared-scene"), "layout", {
      nativeEvent: { layout: { width: 430, height: 700 } },
    });
    const day = screen.getByTestId("calendar-day-2026-01-09");
    const slot = screen.getByTestId("quick-stamp-outline-2026-01-09");
    expect(slot).toHaveStyle({ top: 31, height: 32, left: 1, right: 1, borderWidth: 1 });
    expect(day).toHaveStyle({ width: 430 / 7, height: (645 - 32) / 6 });
    await fireEvent.press(day, {
      nativeEvent: { pageX: 100, pageY: 200, locationX: 10, locationY: 80 },
    });
    expect(onSelectDate).toHaveBeenCalledWith("2026-01-09", {
      x: 90,
      y: 120,
      width: 430 / 7,
      height: (645 - 32) / 6,
    });
    await screen.rerender(<Tree stampMode entries={[appointment]} />);
    expect(screen.queryByTestId("quick-stamp-outline-2026-01-08")).toBeNull();
  });

  it("keeps placeholders to a single entry line when times and durations are hidden", async () => {
    const screen = await render(
      <Tree stampMode dayDisplay={{ ...display, showShiftTimes: false }} />,
    );
    expect(screen.getByTestId("quick-stamp-outline-2026-01-09")).toHaveStyle({
      top: 31,
      height: 17,
    });
  });

  it("keeps selected day accessible but removes its full-cell outline", async () => {
    const screen = await render(<Tree />);
    expect(screen.getByTestId("calendar-day-2026-01-08")).not.toHaveStyle({ borderWidth: 2 });
    expect(screen.getByTestId("calendar-day-2026-01-08").props.accessibilityState).toEqual({
      selected: true,
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.useRealTimers();
  });
  it("keeps the month mounted across year transitions and cancels on background", async () => {
    jest.useFakeTimers();
    const listener = jest.spyOn(AppState, "addEventListener");
    const screen = await render(<Tree />);
    await act(async () => listener.mock.calls[0][1]("active"));
    await fireEvent(screen.getByTestId("calendar-shared-scene"), "layout", {
      nativeEvent: { layout: { width: 430, height: 700 } },
    });
    const month = screen.getByTestId("shared-month-2026-01");
    await screen.rerender(<Tree mode="YEAR" />);
    await act(async () => jest.advanceTimersByTime(479));
    expect(screen.getByTestId("shared-month-2026-01", { includeHiddenElements: true })).toBe(month);
    expect(screen.getByTestId("calendar-year-overview-shell").props.pointerEvents).toBe("none");
    await fireEvent.press(screen.getByRole("button", { name: "September 2026 öffnen" }));
    expect(onSelectMonth).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(screen.getByTestId("calendar-year-overview-shell").props.pointerEvents).toBe("auto");
    await fireEvent.press(screen.getByRole("button", { name: "September 2026 öffnen" }));
    expect(onSelectMonth).toHaveBeenCalledWith("2026-09");
    await screen.rerender(<Tree />);
    await act(async () => listener.mock.calls[0][1]("background"));
    expect(onComplete).toHaveBeenCalled();
    expect(screen.getByTestId("shared-month-2026-01")).toBe(month);
    expect(
      screen.getByTestId("calendar-year-overview-shell", { includeHiddenElements: true }),
    ).not.toBeVisible();
  });
  it("opens the tapped date with its anchor without a measurement callback", async () => {
    const screen = await render(<Tree entries={[appointment]} />);
    await fireEvent(screen.getByTestId("calendar-shared-scene"), "layout", {
      nativeEvent: { layout: { width: 420, height: 700 } },
    });
    await fireEvent.press(screen.getByTestId("calendar-day-2026-01-08"), {
      nativeEvent: { pageX: 220, pageY: 350, locationX: 10, locationY: 20 },
    });
    expect(onSelectDate).toHaveBeenCalledWith("2026-01-08", {
      x: 210,
      y: 330,
      width: 60,
      height: (700 - 55 - 32) / 6,
    });
    expect(screen.getByTestId("calendar-day-2026-01-08").props.accessibilityState.selected).toBe(
      true,
    );
  });
  it("shows edits and deletion on the same mounted month without a reload", async () => {
    const screen = await render(<Tree entries={[appointment]} />);
    await fireEvent(screen.getByTestId("calendar-shared-scene"), "layout", {
      nativeEvent: { layout: { width: 420, height: 700 } },
    });
    const month = screen.getByTestId("shared-month-2026-01");
    expect(screen.getByText("Termin alt", { includeHiddenElements: true })).toBeTruthy();
    await screen.rerender(
      <Tree entries={[{ ...appointment, title: "Termin neu", revision: 2 }]} />,
    );
    expect(screen.queryByText("Termin alt", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText("Termin neu", { includeHiddenElements: true })).toBeTruthy();
    await screen.rerender(<Tree entries={[]} />);
    expect(screen.queryByText("Termin neu", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId("shared-month-2026-01")).toBe(month);
  });
  it("shows a saved photo in the real calendar and updates it without remounting the month", async () => {
    const hidden = { includeHiddenElements: true };
    const screen = await render(<BackgroundTree uri={null} />);
    const month = screen.getByTestId("shared-month-2026-01");
    const marker = screen.getByTestId("calendar-date-marker-2026-01-08", hidden);
    expect(screen.queryByTestId("calendar-custom-background", hidden)).toBeNull();
    await screen.rerender(<BackgroundTree uri="file:///documents/calendar-first.jpg" />);
    await fireEvent(screen.getByTestId("calendar-shared-scene"), "layout", {
      nativeEvent: { layout: { width: 420, height: 700 } },
    });
    await fireEvent.press(screen.getByTestId("calendar-day-2026-01-08"), {
      nativeEvent: { pageX: 220, pageY: 350, locationX: 10, locationY: 20 },
    });
    expect(onSelectDate).toHaveBeenCalledWith("2026-01-08", {
      x: 210,
      y: 330,
      width: 60,
      height: (700 - 55 - 32) / 6,
    });
    expect(screen.getByTestId("calendar-custom-background", hidden)).toBeTruthy();
    expect(screen.getByTestId("calendar-custom-background-image", hidden).props.source).toEqual({
      uri: "file:///documents/calendar-first.jpg",
    });
    expect(screen.getByTestId("calendar-month-custom-background", hidden).props.pointerEvents).toBe(
      "none",
    );
    await screen.rerender(<BackgroundTree uri="file:///documents/calendar-second.jpg" />);
    expect(screen.getByTestId("calendar-custom-background-image", hidden).props.source).toEqual({
      uri: "file:///documents/calendar-second.jpg",
    });
    await screen.rerender(<BackgroundTree uri={null} />);
    expect(screen.queryByTestId("calendar-custom-background", hidden)).toBeNull();
    expect(screen.getByTestId("shared-month-2026-01")).toBe(month);
    expect(screen.getByTestId("calendar-date-marker-2026-01-08", hidden)).toBe(marker);
  });
  it("applies every saved strength to the live month without remounting its photo or date glyphs", async () => {
    const hidden = { includeHiddenElements: true };
    const uri = "file:///documents/calendar-first.jpg";
    const screen = await render(<BackgroundTree uri={uri} />);
    const photo = screen.getByTestId("calendar-custom-background-image", hidden);
    const marker = screen.getByTestId("calendar-date-marker-2026-01-08", hidden);
    for (const option of CALENDAR_IMAGE_STRENGTH_OPTIONS) {
      await screen.rerender(<BackgroundTree uri={uri} strength={option.value} />);
      expect(screen.getByTestId("calendar-custom-background-overlay", hidden)).toHaveStyle({
        opacity: option.overlayOpacity,
      });
      const weekday = within(screen.getByTestId("calendar-month-weekdays", hidden)).getAllByText(
        "M",
        hidden,
      )[0];
      expect(weekday).toHaveStyle({
        color: option.value === "subtle" ? LIGHT_PALETTE.textSecondary : LIGHT_PALETTE.text,
      });
      expect(screen.getByTestId("calendar-custom-background-image", hidden)).toBe(photo);
      expect(screen.getByTestId("calendar-date-marker-2026-01-08", hidden)).toBe(marker);
    }
  });
  it("fades the photo out in the year view and retains it when returning to the month", async () => {
    jest.useFakeTimers();
    const hidden = { includeHiddenElements: true };
    const uri = "file:///documents/calendar-first.jpg";
    const screen = await render(<BackgroundTree uri={uri} />);
    const photo = screen.getByTestId("calendar-custom-background", hidden);
    expect(
      getAnimatedStyle(screen.getByTestId("calendar-month-custom-background", hidden)),
    ).toMatchObject({
      opacity: 1,
    });
    await screen.rerender(<BackgroundTree uri={uri} mode="YEAR" />);
    await act(async () => jest.advanceTimersByTime(500));
    expect(
      getAnimatedStyle(screen.getByTestId("calendar-month-custom-background", hidden)),
    ).toMatchObject({
      opacity: 0,
    });
    expect(screen.getByTestId("calendar-year-overview-shell", hidden)).toHaveStyle({ opacity: 1 });
    await screen.rerender(<BackgroundTree uri={uri} />);
    await act(async () => jest.advanceTimersByTime(500));
    expect(
      getAnimatedStyle(screen.getByTestId("calendar-month-custom-background", hidden)),
    ).toMatchObject({
      opacity: 1,
    });
    expect(screen.getByTestId("calendar-custom-background", hidden)).toBe(photo);
  });
});

it.each([false, true])(
  "keeps compact placeholders readable in both themes (dark=%s)",
  async (dark) => {
    jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue(dark ? "dark" : "light");
    const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
    const screen = await render(<Tree stampMode />);
    expect(screen.getByTestId("quick-stamp-outline-2026-01-08")).toHaveStyle({
      borderWidth: 1,
      borderColor: palette.textMuted,
      backgroundColor: palette.surface + "40",
    });
    expect(screen.getByTestId("calendar-day-2026-01-08")).toHaveProp("accessibilityState", {
      selected: true,
    });
    expect(screen.getByTestId("quick-stamp-outline-2026-01-09")).toHaveStyle({
      borderWidth: 1,
      borderColor: palette.textMuted,
      backgroundColor: palette.surface + "40",
    });
    await screen.rerender(<Tree stampMode selectedDate="2026-01-09" />);
    for (const date of ["2026-01-08", "2026-01-09"]) {
      expect(screen.getByTestId(`quick-stamp-outline-${date}`)).toHaveStyle({
        borderWidth: 1,
        backgroundColor: palette.surface + "40",
      });
    }
  },
);

it("uses the automatic target profile in the live shared month and hides both label types together", async () => {
  const userProfile = createWorkingTimeCalculationProfile(
    { ...work, federalState: "HE", sundayHolidayWorkEligible: true },
    null,
    [],
  );
  const screen = await render(<Tree month="2026-12" userProfile={userProfile} />);
  await fireEvent(screen.getByTestId("calendar-shared-scene"), "layout", {
    nativeEvent: { layout: { width: 430, height: 700 } },
  });
  expect(screen.getByText("◇ Heiligabend", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId("calendar-day-2026-12-24").props.accessibilityLabel).toContain(
    "tariflicher Sondertag",
  );
  expect(screen.getByTestId("calendar-day-2026-12-25").props.accessibilityLabel).toContain(
    "1. Weihnachtstag",
  );
  await screen.rerender(<Tree month="2026-12" userProfile={userProfile} showHolidays={false} />);
  expect(screen.queryByText("◇ Heiligabend", { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId("calendar-day-2026-12-24").props.accessibilityLabel).not.toContain(
    "tariflicher Sondertag",
  );
});
