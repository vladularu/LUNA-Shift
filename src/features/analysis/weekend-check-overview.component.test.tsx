import { describe, expect, it, jest } from "@jest/globals";
import { render } from "./check-issue-route.test";
import { fireEvent, within } from "@testing-library/react-native";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { AffectedCheckShifts } from "./compliance-issue-content";
import { ComplianceDayList } from "./compliance-day-list";

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);
jest.mock("@/ui/icon", () => {
  const actual = jest.requireActual<typeof import("@/ui/icon")>("@/ui/icon");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ...actual,
    __esModule: true,
    default: Object.assign(
      ({ name }: { name: keyof typeof actual.DESIGN_ICON_MAP }) => <View testID={`icon-${name}`} />,
      { glyphMap: actual.DESIGN_ICON_MAP },
    ),
  };
});

const period = { from: "2026-11-02", until: "2026-11-29" };
const night = (date: string) =>
  forecastShift({
    id: date,
    date,
    title: "Nacht",
    type: "NIGHT",
    startTime: "21:00",
    endTime: "07:30",
  });
const late = (date: string) =>
  forecastShift({
    id: date,
    date,
    title: "Spät",
    type: "LATE",
    startTime: "13:18",
    endTime: "21:30",
  });

describe("weekend check duty selection", () => {
  it.each([false, true])(
    "opens each window with its own free weekends and real shift starts (grouped %s)",
    async (grouped) => {
      const shifts = Object.freeze([
        night("2026-11-29"),
        night("2026-10-23"),
        late("2026-11-15"),
        night("2026-11-27"),
        night("2026-10-31"),
        late("2026-11-21"),
        night("2026-11-01"),
        late("2026-11-14"),
        night("2026-11-28"),
        late("2026-11-22"),
        late("2026-11-24"),
        late("2026-11-25"),
        late("2026-11-26"),
      ]);
      const result = calculateMonthlyCompliance("2026-11", shifts, "Europe/Berlin", {
        allEmploymentWorkRecorded: true,
      });
      const issue = result.issues.find((entry) => entry.rule === "PLANNING_WEEKEND_RECOVERY")!;
      const series = result.issues.find((entry) => entry.rule === "PLANNING_7_DAYS")!;
      expect(issue).toBeDefined();
      expect(series).toBeDefined();
      expect(issue.relatedShiftIds).toEqual(expect.arrayContaining(["2026-10-23", "2026-11-27"]));
      const before = JSON.stringify({ shifts, result });
      const screen = await render(
        <ComplianceDayList
          compliance={{ ...result, issues: grouped ? [issue, series] : [issue] }}
          shifts={shifts}
          timeZone="Europe/Berlin"
          showPlanning
        />,
      );
      const periods = within(screen.getByTestId("check-inbox-planning")).getAllByRole("button", {
        name: "Details ansehen: 1 freies Wochenende in 4 Wochen",
      });
      expect(periods.length).toBeGreaterThan(1);
      expect(periods.at(-1)?.props.accessibilityValue.text).toBe("02.11.–29.11.2026");
      expect(within(periods.at(-1)!).getByTestId("icon-calendar-outline")).toBeVisible();
      if (grouped) {
        const sequence = screen.getByRole("button", { name: /^Details ansehen: \d+ Diensttage/ });
        expect(within(sequence).getByTestId("icon-list-outline")).toBeVisible();
      }
      await fireEvent.press(periods.at(-1)!);
      expect(
        within(screen.getByTestId("check-reference-heading")).getByTestId("icon-calendar-outline"),
      ).toBeVisible();
      const overview = within(screen.getByTestId("weekend-duty-overview"));
      expect(screen.getAllByText("2.–29. November 2026")).toHaveLength(1);
      expect(overview.getByText("7.–8. November 2026 · Frei")).toBeVisible();
      expect(overview.getAllByTestId(/^check-weekend-/)).toHaveLength(4);
      expect(overview.getAllByTestId(/^check-shift-/).map((entry) => entry.props.testID)).toEqual([
        "check-shift-2026-11-14",
        "check-shift-2026-11-15",
        "check-shift-2026-11-21",
        "check-shift-2026-11-22",
        "check-shift-2026-11-27",
        "check-shift-2026-11-28",
        "check-shift-2026-11-29",
      ]);
      expect(overview.queryByText("Fr")).toBeNull();
      expect(overview.queryByTestId("check-shift-2026-10-31")).toBeNull();
      expect(overview.queryByTestId("check-shift-2026-11-01")).toBeNull();
      expect(overview.getByTestId("check-duty-symbol-2026-11-27-2026-11-27")).toBeVisible();
      expect(screen.queryByText("02.11.2026 bis 29.11.2026")).toBeNull();
      expect(screen.queryByRole("button", { name: /Weitere betroffene Zeiträume/ })).toBeNull();
      expect(JSON.stringify({ shifts, result })).toBe(before);
    },
  );

  it("does not insert weekdays between weekend duty starts", async () => {
    const shifts = [
      night("2026-11-06"),
      night("2026-11-07"),
      night("2026-11-08"),
      late("2026-11-14"),
      late("2026-11-15"),
    ];
    const screen = await render(<AffectedCheckShifts shifts={shifts} weekendPeriod={period} />);
    expect(
      screen.getAllByTestId(/^check-affected-shifts-2026-/).map((entry) => entry.props.testID),
    ).toEqual([
      "check-affected-shifts-2026-11-07",
      "check-affected-shifts-2026-11-08",
      "check-affected-shifts-2026-11-14",
      "check-affected-shifts-2026-11-15",
    ]);
    expect(screen.queryByText("Fr")).toBeNull();
    expect(screen.queryByText("Mo")).toBeNull();
    expect(screen.queryByTestId("check-shift-2026-11-06")).toBeNull();
  });

  it("keeps the selected period without inventing a Saturday start for a Friday night", async () => {
    const screen = await render(
      <AffectedCheckShifts shifts={[night("2026-11-27")]} weekendPeriod={period} />,
    );
    expect(screen.getByText("02.11.–29.11.2026")).toBeVisible();
    expect(screen.queryByTestId(/^check-shift-/)).toBeNull();
    expect(screen.queryByText(/frei/)).toBeNull();
  });
});
