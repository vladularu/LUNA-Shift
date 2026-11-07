import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { StyleSheet } from "react-native";
import { AnnualNetPayCard } from "./annual-net-pay-view";
import { summarizeAnnualNetPay } from "./annual-net-pay";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

describe("annual net loading layout", () => {
  it("reserves the same note space while loading and after the common two notes arrive", async () => {
    const screen = await render(<AnnualNetPayCard year={2026} />);
    const loadingStyle = StyleSheet.flatten(screen.getByTestId("annual-net-notes").props.style);
    expect(loadingStyle.minHeight).toBeGreaterThan(0);
    expect(screen.getByText("Wird berechnet …")).toBeTruthy();
    expect(screen.getByTestId("analysis-card-body-Netto").props.accessibilityState.busy).toBe(true);
    const notes = ["Zusatzversorgung nicht berücksichtigt", "Jahressonderzahlung enthalten"];
    const report = summarizeAnnualNetPay(2026, [
      { month: "2026-01", netCents: 200000, status: null, preliminary: false, notes },
    ]);
    await screen.rerender(
      <AnnualNetPayCard year={2026} data={{ report, loading: false, error: null }} />,
    );
    expect(StyleSheet.flatten(screen.getByTestId("annual-net-notes").props.style)).toEqual(
      loadingStyle,
    );
    for (const note of notes) expect(screen.getByText(note)).toBeTruthy();
    expect(screen.queryByText("Wird berechnet …")).toBeNull();
    expect(screen.getByTestId("analysis-card-body-Netto").props.accessibilityState.busy).toBe(
      false,
    );
  });
  it("allows long and additional notes to grow without hiding financial qualifications", async () => {
    const notes = [
      "2027 vorläufig · Abzüge nach Stand 2026",
      "Jahreswechsel geschätzt · Auszahlung zum Monatsende, Jahresbrutto hochgerechnet.",
      "Zusatzversorgung nicht berücksichtigt",
    ];
    const report = summarizeAnnualNetPay(2027, [
      { month: "2027-01", netCents: 200000, status: null, preliminary: true, notes },
    ]);
    const screen = await render(
      <AnnualNetPayCard year={2027} data={{ report, loading: false, error: null }} />,
    );
    const style = StyleSheet.flatten(screen.getByTestId("annual-net-notes").props.style);
    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBeUndefined();
    expect(style.overflow).not.toBe("hidden");
    for (const note of notes) {
      const text = screen.getByText(note);
      expect(text.props.numberOfLines).toBeUndefined();
    }
  });
});
