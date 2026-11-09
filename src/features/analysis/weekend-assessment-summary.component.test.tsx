import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { Temporal } from "@js-temporal/polyfill";
import { StyleSheet } from "react-native";
import {
  PLANNING_WEEKEND_POLICY,
  planningWeekendWindowEnds,
  type PlanningWeekend,
  type PlanningWeekendAssessment,
} from "@/domain/planning-weekend-policy";
import * as Palette from "@/theme/palette";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import {
  WeekendAssessmentSummary,
  WeekendAssessmentWindows,
  weekendAssessmentOpen,
} from "./weekend-assessment-summary";
import { calculateMonthlyCompliance } from "@/engine/compliance";

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);
let mockWidth = 390,
  mockFontScale = 1;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 3, fontScale: mockFontScale }),
}));

function assessment(unknown = false): PlanningWeekendAssessment {
  const weekend = (sunday: string): PlanningWeekend => ({
    saturday: Temporal.PlainDate.from(sunday).subtract({ days: 1 }).toString(),
    sunday,
    status:
      unknown && sunday === "2026-11-29" ? "UNKNOWN" : sunday >= "2026-11-15" ? "OCCUPIED" : "FREE",
    relatedShiftIds: sunday >= "2026-11-15" ? [sunday] : [],
    reasons:
      unknown && sunday === "2026-11-29"
        ? ["OUTSIDE_COVERAGE"]
        : sunday >= "2026-11-15"
          ? ["WORK_RECORDED"]
          : [],
  });
  const counts = (items: readonly PlanningWeekend[]) => ({
    freeCount: items.filter((item) => item.status === "FREE").length,
    occupiedCount: items.filter((item) => item.status === "OCCUPIED").length,
    unknownCount: items.filter((item) => item.status === "UNKNOWN").length,
  });
  const ends = planningWeekendWindowEnds("2026-11"),
    weekends = ends.map(weekend);
  return {
    policyVersion: PLANNING_WEEKEND_POLICY.version,
    month: "2026-11",
    weekends,
    totalCount: weekends.length,
    ...counts(weekends),
    windows: ends.map((until) => {
      const day = Temporal.PlainDate.from(until),
        items = [3, 2, 1, 0].map((weeks) => weekend(day.subtract({ weeks }).toString()));
      return {
        from: day.subtract({ days: 27 }).toString(),
        until,
        weekends: items,
        assessmentComplete: items.every((item) => item.status !== "UNKNOWN"),
        ...counts(items),
      };
    }),
  };
}

describe("weekend detail helpers without permanent main-screen statistics", () => {
  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "preserves the neutral reusable summary and accessible large-font counts",
    async (palette) => {
      const spy = jest.spyOn(Palette, "usePalette").mockReturnValue(palette);
      mockWidth = 320;
      mockFontScale = 3.1;
      try {
        const screen = await render(
          <WeekendAssessmentSummary assessment={assessment(true)} details />,
        );
        expect(screen.getByLabelText("Belegte Wochenenden: 2")).toBeVisible();
        expect(screen.getByLabelText("Vollständig freie Wochenenden: 2")).toBeVisible();
        expect(screen.getByLabelText("Offene Wochenenden: 1")).toBeVisible();
        expect(screen.getByTestId("weekend-assessment-counts")).toHaveStyle({
          flexDirection: "column",
        });
        const style = StyleSheet.flatten(
          screen.getByTestId("weekend-assessment-summary").props.style,
        );
        expect(style.borderColor).toBeUndefined();
        expect(style.backgroundColor).toBeUndefined();
        const button = screen.getByRole("button", {
          name: "Wochenendübersicht ansehen",
          expanded: false,
        });
        expect(button).toHaveStyle({ minHeight: 44 });
        await fireEvent.press(button);
        expect(screen.getByText("28.11.2026 / 29.11.2026")).toBeVisible();
      } finally {
        spy.mockRestore();
        mockWidth = 390;
        mockFontScale = 1;
      }
    },
  );
  it("does not invent summary data for a legacy result", async () => {
    const screen = await render(<WeekendAssessmentSummary />);
    expect(screen.queryByTestId("weekend-assessment-summary")).toBeNull();
    expect(weekendAssessmentOpen()).toBe(false);
  });
  it("retains unresolved-duty copy for the reusable helper", async () => {
    const entry = forecastShift({ date: "2026-11-15", startTime: null });
    const result = calculateMonthlyCompliance("2026-11", [entry], "Europe/Berlin");
    const screen = await render(
      <WeekendAssessmentSummary assessment={result.weekendAssessment} details />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Wochenendübersicht ansehen" }));
    expect(
      screen.getByText(
        "Dienstzeiten oder Dienstdaten sind noch offen; das kann auch Bereitschaften betreffen.",
      ),
    ).toBeVisible();
  });
  it("keeps incomplete-window status even with no UNKNOWN monthly weekend", () => {
    const data = assessment(),
      incomplete = {
        ...data,
        windows: data.windows.map((window) => ({ ...window, assessmentComplete: false })),
      };
    expect(incomplete.unknownCount).toBe(0);
    expect(weekendAssessmentOpen(incomplete)).toBe(true);
  });
  it("shows only actually affected complete windows in recommendation details", async () => {
    const screen = await render(
      <WeekendAssessmentWindows assessment={assessment()} affectedOnly />,
    );
    expect(screen.getByText("02.11.2026 bis 29.11.2026")).toBeVisible();
    expect(screen.queryByText("26.10.2026 bis 22.11.2026")).toBeNull();
    expect(screen.queryByText("05.10.2026 bis 01.11.2026")).toBeNull();
    expect(screen.queryByText(/offen/)).toBeNull();
    expect(screen.queryByText(/Vier-Wochen-Zeiträume/)).toBeNull();
    expect(screen.queryByText(/Kalendermonat sind unterschiedliche/)).toBeNull();
  });
  it("keeps other affected windows collapsed behind the representative period", async () => {
    const duties = ["2026-09-19", "2026-09-26", "2026-10-03"].map((date) =>
      forecastShift({ id: date, date, type: "DAY", startTime: "08:00", endTime: "16:00" }),
    );
    const data = calculateMonthlyCompliance("2026-10", duties, "Europe/Berlin", {
      allEmploymentWorkRecorded: true,
    }).weekendAssessment!;
    const screen = await render(<WeekendAssessmentWindows assessment={data} affectedOnly />);
    expect(screen.getByText("14.09.2026 bis 11.10.2026")).toHaveStyle({ fontSize: 16 });
    expect(screen.queryByText("07.09.2026 bis 04.10.2026")).toBeNull();
    const other = screen.getByRole("button", {
      name: "Weitere betroffene Zeiträume (1)",
      expanded: false,
    });
    await fireEvent.press(other);
    expect(screen.getByText("07.09.2026 bis 04.10.2026")).toBeVisible();
    expect(screen.queryByText("28.09.2026 bis 25.10.2026")).toBeNull();
  });
  it.each([true, false])(
    "hides unknown or incomplete adverse-looking windows (%s)",
    async (unknown) => {
      const data = assessment(unknown),
        input = unknown
          ? data
          : {
              ...data,
              windows: data.windows.map((window) => ({ ...window, assessmentComplete: false })),
            };
      const screen = await render(<WeekendAssessmentWindows assessment={input} affectedOnly />);
      expect(screen.queryByText("Vier-Wochen-Zeiträume")).toBeNull();
      expect(screen.queryByText(/von 4 Wochenenden/)).toBeNull();
    },
  );
});
