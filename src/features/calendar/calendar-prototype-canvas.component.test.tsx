import { fireEvent, render, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { useSharedValue } from "react-native-reanimated";
import { StyleSheet } from "react-native";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { PrototypeMonthContent, PrototypeYear } from "./calendar-prototype-canvas";
import { calendarPrototypeLayout } from "./calendar-prototype-layout";
import type { CalendarEntry, ShiftEntry } from "@/domain/types";
import { CALENDAR_METRICS } from "@/theme/tokens";

function Year({
  year = "2026",
  entries = [],
  onSelect = () => {},
}: {
  year?: string;
  entries?: CalendarEntry[];
  onSelect?: (month: string) => void;
}) {
  const progress = useSharedValue(0);
  return (
    <PrototypeYear
      layouts={Array.from({ length: 12 }, (_, i) =>
        calendarPrototypeLayout(`${year}-${String(i + 1).padStart(2, "0")}`, 430, 640),
      )}
      selectedMonth={`${year}-01`}
      referenceMonth="2026-09"
      progress={progress}
      onSelect={onSelect}
      entriesByDate={new Map([["2026-01-08", entries]])}
    />
  );
}
function Month({
  month = "2026-01",
  height = 640,
  entriesByDate = new Map(),
  holidays = new Map(),
  specialDays = new Map(),
}: {
  month?: string;
  height?: number;
  entriesByDate?: ReadonlyMap<string, readonly CalendarEntry[]>;
  holidays?: ReadonlyMap<string, { name: string }>;
  specialDays?: ReadonlyMap<string, { label: string }>;
}) {
  const progress = useSharedValue(1);
  return (
    <PrototypeMonthContent
      layout={calendarPrototypeLayout(month, 430, height)}
      progress={progress}
      entriesByDate={entriesByDate}
      holidays={holidays}
      specialDays={specialDays}
      visible
      display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: false }}
      timeZone="Europe/Berlin"
    />
  );
}
describe("calendar orientation", () => {
  it("restores up to two live shift color marks, including the selected month", async () => {
    const entry = {
      kind: "SHIFT",
      id: "a",
      date: "2026-01-08",
      color: "#59CA50",
      deletedAt: null,
    } as CalendarEntry;
    const entries = [entry, { ...entry, id: "b", color: "#FFA338" }, { ...entry, id: "c" }];
    const screen = await render(<Year entries={entries} />);
    const marks = screen.getByTestId("calendar-mini-shifts-2026-01-08", {
      includeHiddenElements: true,
    });
    expect(marks.children).toHaveLength(2);
    expect(marks.children[0]).toHaveStyle({ backgroundColor: "#59CA50" });
    expect(marks.children[1]).toHaveStyle({ backgroundColor: "#FFA338" });
    await screen.rerender(
      <Year
        entries={[
          { ...entry, deletedAt: "2026-09-10" },
          { ...entry, kind: "APPOINTMENT" } as CalendarEntry,
        ]}
      />,
    );
    expect(
      screen.queryByTestId("calendar-mini-shifts-2026-01-08", { includeHiddenElements: true }),
    ).toBeNull();
  });
  it.each([false, true])("highlights only the real current month (dark=%s)", async (dark) => {
    const spy = jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue(dark ? "dark" : "light");
    try {
      const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
      const screen = await render(<Year />);
      expect(screen.getByText("September", { includeHiddenElements: true })).toHaveStyle({
        color: palette.calendarYearAccent,
      });
      expect(screen.getByText("Januar", { includeHiddenElements: true })).toHaveStyle({
        color: palette.text,
      });
      await screen.rerender(<Year year="2027" />);
      expect(screen.getByText("September", { includeHiddenElements: true })).toHaveStyle({
        color: palette.text,
      });
    } finally {
      spy.mockRestore();
    }
  });
  it("shows faded boundary dates without claiming holiday coverage or adding editing targets", async () => {
    const screen = await render(<Month />);
    expect(screen.getByTestId("calendar-adjacent-2025-12-31")).toHaveStyle({ opacity: 0.5 });
    expect(screen.getByTestId("calendar-adjacent-2026-02-01")).toHaveTextContent("1");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("centers previous and next month numbers in the same 30 pixel date box as current dates", async () => {
    const screen = await render(<Month />);
    for (const date of ["2025-12-31", "2026-02-01"]) {
      expect(screen.getByTestId("calendar-adjacent-date-box-" + date)).toHaveStyle({
        width: 30,
        height: 30,
        alignItems: "center",
        justifyContent: "center",
      });
      expect(screen.getByTestId("calendar-adjacent-" + date)).toHaveStyle({
        fontSize: CALENDAR_METRICS.dayNumberFontSize,
        fontWeight: "500",
        opacity: 0.5,
      });
    }
  });
});

const holidayName = "Tag der Deutschen Einheit";
const holidayShift: ShiftEntry = {
  kind: "SHIFT",
  id: "holiday-shift",
  date: "2026-10-03",
  templateId: null,
  title: "Spät",
  type: "LATE",
  startTime: "13:18",
  endTime: "21:30",
  breakMinutes: 30,
  color: "#F15B6E",
  symbol: "sun",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

describe("adjacent month shifts", () => {
  it("shows previous and next month services at 30% opacity without adding edit targets", async () => {
    const previous = { ...holidayShift, id: "previous", date: "2025-12-31" };
    const next = { ...holidayShift, id: "next", date: "2026-02-01" };
    const screen = await render(
      <Month
        entriesByDate={
          new Map([
            [previous.date, [previous]],
            [next.date, [next]],
          ])
        }
      />,
    );
    for (const date of [previous.date, next.date]) {
      const layer = screen.getByTestId(`calendar-adjacent-entry-layer-${date}`);
      expect(layer).toHaveStyle({ opacity: 0.3 });
      expect(within(layer).getByText("Spät")).toBeTruthy();
    }
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("compact services and appointments", () => {
  it.each([500, 640])("fits one service and two appointment rows at height=%s", async (height) => {
    const date = "2026-03-13";
    const service = { ...holidayShift, date };
    const first = {
      ...service,
      kind: "APPOINTMENT" as const,
      allDay: false,
      id: "a1",
      title: "Ohne Titel",
      recurrence: null,
    };
    const second = { ...first, id: "a2", title: "Arzttermin" };
    const screen = await render(
      <Month
        month="2026-03"
        height={height}
        entriesByDate={new Map([[date, [service, first, second]]])}
      />,
    );
    const layer = within(screen.getByTestId("calendar-combined-entries-" + date));
    expect(layer.getByText("Ohne Titel")).toBeTruthy();
    expect(layer.getByText("Arzttermin")).toBeTruthy();
    const slots = layer
      .getAllByTestId(/calendar-entry-slot-/)
      .map((slot) => StyleSheet.flatten(slot.props.style));
    expect(slots).toHaveLength(3);
    expect(slots[0].height).toBe(slots[1].height + slots[2].height);
    expect(slots[2].marginTop).toBe(0);
    expect(screen.queryByTestId("calendar-overflow-" + date)).toBeNull();
  });

  it("separates services and puts only hidden service colors beneath the date", async () => {
    const date = holidayShift.date;
    const entries = [
      holidayShift,
      { ...holidayShift, id: "two", color: "#4477AA" },
      { ...holidayShift, id: "three", color: "#EEAA44" },
      { ...holidayShift, id: "four", color: "#8855CC" },
    ];
    const screen = await render(
      <Month month="2026-10" entriesByDate={new Map([[date, entries]])} />,
    );
    expect(screen.getByTestId(`calendar-entry-slot-${date}-1`)).toHaveStyle({ marginTop: 4 });
    expect(screen.getByTestId(`calendar-overflow-dot-${date}-0`)).toHaveStyle({
      backgroundColor: entries[2].color,
    });
    expect(screen.getByTestId(`calendar-overflow-dot-${date}-1`)).toHaveStyle({
      backgroundColor: entries[3].color,
    });
    const dots = StyleSheet.flatten(screen.getByTestId("calendar-overflow-" + date).props.style);
    const layer = StyleSheet.flatten(
      screen.getByTestId("calendar-combined-entries-" + date).props.style,
    );
    expect(dots.top + dots.height).toBeLessThan(layer.marginTop);
    expect(screen.queryByText("+2")).toBeNull();
    expect(screen.queryByTestId("calendar-overflow-more-" + date)).toBeNull();
  });
});

describe("holiday entry alignment", () => {
  it.each([false, true])("keeps the first shift above the holiday in dark=%s", async (dark) => {
    const scheme = jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue(dark ? "dark" : "light");
    try {
      const screen = await render(
        <Month
          month="2026-10"
          entriesByDate={
            new Map([
              [holidayShift.date, [holidayShift]],
              [
                "2026-10-02",
                [{ ...holidayShift, id: "neighbor", date: "2026-10-02", title: "Nachbar" }],
              ],
            ])
          }
          holidays={new Map([[holidayShift.date, { name: holidayName }]])}
        />,
      );
      const content = screen.getByText(holidayName).parent!;
      expect(
        within(content)
          .getAllByText(/^(Spät|13:18|Tag der Deutschen Einheit)$/)
          .map((node) => node.props.children),
      ).toEqual(["Spät", "13:18", holidayName]);
      expect(content).toHaveStyle({ marginTop: 31 });
      expect(screen.getByTestId("calendar-combined-entries-2026-10-02")).toHaveStyle({
        marginTop: 31,
      });
      const titleHeight = StyleSheet.flatten(screen.getByText("Spät").props.style).height;
      expect(titleHeight).toBeGreaterThanOrEqual(11);
      expect(titleHeight).toBeLessThanOrEqual(CALENDAR_METRICS.entryRowHeight);
      expect(screen.getByText(holidayName)).toHaveStyle({
        height: CALENDAR_METRICS.entryRowHeight,
        color: (dark ? DARK_PALETTE : LIGHT_PALETTE).textMuted,
      });
    } finally {
      scheme.mockRestore();
    }
  });

  it("keeps a holiday without entries visible and removes it when holidays are hidden", async () => {
    const screen = await render(
      <Month month="2026-10" holidays={new Map([[holidayShift.date, { name: holidayName }]])} />,
    );
    expect(screen.getByText(holidayName)).toBeTruthy();
    expect(screen.queryByText("Spät")).toBeNull();
    await screen.rerender(<Month month="2026-10" />);
    expect(screen.queryByText(holidayName)).toBeNull();
  });

  it.each([540, 760])(
    "keeps two own services visible and bounds holiday overflow at height=%s",
    async (height) => {
      const date = "2026-08-08",
        entries = Array.from({ length: 20 }, (_, i) => ({ ...holidayShift, date, id: String(i) }));
      const screen = await render(
        <Month
          month="2026-08"
          height={height}
          entriesByDate={new Map([[date, entries]])}
          holidays={new Map([[date, { name: "Testfeiertag" }]])}
        />,
      );
      const day = screen.getByTestId("calendar-combined-day-" + date),
        content = within(day);
      expect(content.getAllByText("Spät")).toHaveLength(2);
      expect(content.getAllByText("13:18")).toHaveLength(2);
      expect(content.getByTestId("calendar-overflow-" + date)).toHaveProp(
        "accessibilityLabel",
        "18 weitere Einträge",
      );
      expect(content.getAllByTestId(/calendar-overflow-dot-/)).toHaveLength(5);
      expect(content.getByTestId("calendar-overflow-more-" + date)).toBeTruthy();
      expect(day.props.accessibilityLabel).toContain("Testfeiertag");
      const slots = content.getAllByTestId(/calendar-entry-slot-/);
      const heightUsed =
        StyleSheet.flatten(content.getByTestId("calendar-combined-entries-" + date).props.style)
          .marginTop +
        slots.reduce((sum, slot) => {
          const style = StyleSheet.flatten(slot.props.style);
          return sum + style.height + style.marginTop;
        }, 0);
      expect(heightUsed).toBeLessThanOrEqual(
        calendarPrototypeLayout("2026-08", 430, height).weekHeight,
      );
      if (height === 760) expect(content.getByText("Testfeiertag")).toBeTruthy();
    },
  );
});

it("keeps the twelve month areas and selected date nodes when moving years forward and back", async () => {
  const onSelect = jest.fn();
  const screen = await render(<Year onSelect={onSelect} />);
  const months = Array.from({ length: 12 }, (_, i) =>
    screen.getByTestId("calendar-year-month-" + (i + 1), { includeHiddenElements: true }),
  );
  const january = screen.getByTestId("calendar-year-date-2026-01-01", {
    includeHiddenElements: true,
  });
  const february = screen.getByTestId("calendar-year-date-2026-02-28", {
    includeHiddenElements: true,
  });
  for (const year of ["2027", "2028", "2026"]) {
    await screen.rerender(<Year year={year} onSelect={onSelect} />);
    months.forEach((node, i) =>
      expect(
        screen.getByTestId("calendar-year-month-" + (i + 1), { includeHiddenElements: true }),
      ).toBe(node),
    );
    expect(
      screen.getByTestId("calendar-year-date-" + year + "-01-01", { includeHiddenElements: true }),
    ).toBe(january);
    expect(
      screen.getByTestId("calendar-year-date-" + year + "-02-28", { includeHiddenElements: true }),
    ).toBe(february);
    expect(
      screen.getByTestId("calendar-year-dates-" + year + "-01", { includeHiddenElements: true }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Januar " + year + " öffnen" }));
    expect(onSelect).toHaveBeenLastCalledWith(year + "-01");
  }
});

describe("tariff special-day labels", () => {
  it("distinguishes special days from statutory holidays in the same month", async () => {
    const screen = await render(
      <Month
        month="2026-12"
        specialDays={new Map([["2026-12-24", { label: "Heiligabend (tariflicher Sondertag)" }]])}
        holidays={new Map([["2026-12-25", { name: "1. Weihnachtstag" }]])}
      />,
    );
    expect(screen.getByText("◇ Heiligabend")).toBeVisible();
    expect(
      screen.getByTestId("calendar-combined-day-2026-12-24").props.accessibilityLabel,
    ).toContain("tariflicher Sondertag");
    expect(screen.getByText("1. Weihnachtstag")).toBeVisible();
    expect(screen.queryByText("◇ 1. Weihnachtstag")).toBeNull();
  });
  it("retains the full special-day label for a crowded cell", async () => {
    const date = "2026-12-24";
    const entries = Array.from({ length: 20 }, (_, i) => ({
      ...holidayShift,
      date,
      id: String(i),
    }));
    const screen = await render(
      <Month
        month="2026-12"
        height={540}
        entriesByDate={new Map([[date, entries]])}
        specialDays={new Map([[date, { label: "Heiligabend (tariflicher Sondertag)" }]])}
      />,
    );
    expect(screen.getByTestId("calendar-combined-day-" + date).props.accessibilityLabel).toContain(
      "Heiligabend (tariflicher Sondertag)",
    );
    expect(screen.getByTestId("calendar-overflow-" + date)).toHaveProp(
      "accessibilityLabel",
      "18 weitere Einträge",
    );
  });
});
