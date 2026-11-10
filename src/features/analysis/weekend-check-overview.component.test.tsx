import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, within } from "@testing-library/react-native";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { AffectedCheckShifts, ComplianceIssueContent } from "./compliance-issue-content";

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);

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
    "matches the photographed primary period without Friday starts or older-window duties (grouped %s)",
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
        <ComplianceIssueContent
          issue={issue}
          relatedIssues={grouped ? [series] : []}
          shifts={shifts}
          timeZone="Europe/Berlin"
          compact
        />,
      );
      await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
      const overview = within(screen.getByTestId("weekend-duty-overview"));
      expect(overview.getByText("02.11.–29.11.2026")).toBeVisible();
      expect(overview.getAllByTestId(/^check-shift-/).map((entry) => entry.props.testID)).toEqual([
        "check-shift-2026-11-14",
        "check-shift-2026-11-15",
        "check-shift-2026-11-21",
        "check-shift-2026-11-22",
        "check-shift-2026-11-28",
        "check-shift-2026-11-29",
      ]);
      expect(overview.queryByText("Fr")).toBeNull();
      expect(overview.queryByTestId("check-shift-2026-10-31")).toBeNull();
      expect(overview.queryByTestId("check-shift-2026-11-01")).toBeNull();
      expect(overview.queryByTestId("check-shift-2026-11-27")).toBeNull();
      expect(screen.getByText("02.11.2026 bis 29.11.2026")).toBeVisible();
      expect(screen.queryByText("23.10.–29.11.2026")).toBeNull();
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
