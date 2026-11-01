import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { buildMonthlyShiftTypeAnalysis } from "./analysis-metrics";
import { ShiftAnalysisCard } from "./shift-analysis-card";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/ui/design-system", () => {
  const actual = jest.requireActual<typeof import("@/ui/design-system")>("@/ui/design-system");
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ...actual,
    ColorBadge: ({ label, color }: { label: string; color: string }) =>
      React.createElement(Text, { testID: "saved-icon-" + label, style: { color } }, label),
  };
});

describe("named shift table", () => {
  it("shows both metrics and original icons, without expandable rows and with payout instead of a zero credit", async () => {
    const first = forecastShift({
      id: "one",
      date: "2026-07-08",
      title: "Mein Bereitschaftsdienst",
      type: "CUSTOM",
      symbol: "moon",
      color: "#339966",
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 30,
    });
    const second = {
      ...first,
      id: "two",
      date: "2026-07-09",
      title: "Mein geteilter Dienst",
      symbol: "sunny",
      color: "#663399",
    };
    const screen = await render(
      <ShiftAnalysisCard
        analysis={buildMonthlyShiftTypeAnalysis("2026-07", [first, second], forecastProfile)}
        timeCredits={[
          {
            shiftId: "one",
            date: first.date,
            title: first.title,
            recordedMinutes: 450,
            creditedMinutes: 0,
            settlement: "PAY",
            notes: [],
          },
        ]}
      />,
    );
    const row = screen.getByLabelText(
      "Mein Bereitschaftsdienst, Anzahl 1, Stunden 7:30 h, Auszahlung",
    );
    expect(screen.getByLabelText("Mein geteilter Dienst, Anzahl 1, Stunden 7:30 h")).toBeTruthy();
    expect(screen.getByLabelText("Gesamt, Anzahl 2, Stunden 15:00 h")).toBeTruthy();
    expect(screen.queryByText("0:00 h")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Schichten: Anzahl" })).toBeNull();
    expect(screen.getByTestId("saved-icon-moon")).toHaveStyle({ color: "#339966" });
    expect(screen.getByTestId("saved-icon-sunny")).toHaveStyle({ color: "#663399" });
    expect(row.props.onPress).toBeUndefined();
    expect(row.props.accessibilityState).toBeUndefined();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(router.push).not.toHaveBeenCalled();
  });
});
