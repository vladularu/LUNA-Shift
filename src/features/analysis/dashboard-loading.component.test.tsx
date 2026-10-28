import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { StyleSheet } from "react-native";
import { PayListCard, CheckListCard } from "./dashboard-cards";
import { AnalysisValueRow } from "./analysis-list-card";

const amounts = {
  base: 4075.58,
  premiums: 399.87,
  overtime: 88.61,
  allowances: 416.82,
  gross: 4980.88,
};
const onPress = jest.fn();
function Pay({
  loading,
  annual = false,
  present = false,
}: {
  loading: boolean;
  annual?: boolean;
  present?: boolean;
}) {
  return (
    <PayListCard
      reserveLoadingSpace
      {...amounts}
      onPress={onPress}
      loading={loading}
      caption="Unverbindliche Schätzung"
      annualPaymentExpected={annual}
      annualPaymentPresent={present}
      annualPayments={present ? 4084.53 : 0}
      netRow={
        <AnalysisValueRow
          reserveDisclosure
          label="Voraussichtliches Netto"
          value={loading ? "—" : "3.628,47 €"}
        />
      }
    />
  );
}
type Screen = Awaited<ReturnType<typeof render>>;
const labels = (screen: Screen) =>
  screen
    .getAllByLabelText(/.+: .+/)
    .map((row) => String(row.props.accessibilityLabel).split(": ")[0]);
const height = (screen: Screen, busy: boolean) => {
  const body = screen.getByTestId("analysis-card-body-Gehalt");
  expect(body.props.accessibilityState.busy).toBe(busy);
  return StyleSheet.flatten(body.props.style)?.minHeight;
};

describe("stable analysis card loading rows", () => {
  it("keeps the complete salary row structure while gross and net finish", async () => {
    const screen = await render(<Pay loading />);
    const before = labels(screen),
      reserved = height(screen, true);
    expect(before).toContain("Grundgehalt");
    expect(before).toContain("Überstundenvergütung");
    expect(before).not.toContain("Status");
    expect(screen.getByLabelText("Brutto geschätzt: Wird berechnet …")).toBeTruthy();
    await screen.rerender(<Pay loading={false} />);
    expect(labels(screen)).toEqual(before);
    expect(height(screen, false)).toBe(reserved);
    expect(screen.getByLabelText(/Brutto geschätzt:.*4.980,88/)).toBeTruthy();
  });
  it("reserves the regular annual-payment row without fabricating an amount", async () => {
    const screen = await render(<Pay loading annual />);
    const before = labels(screen),
      reserved = height(screen, true);
    expect(screen.getByLabelText("Jahressonderzahlung: —")).toBeTruthy();
    await screen.rerender(<Pay loading={false} annual present />);
    expect(labels(screen)).toEqual(before);
    expect(height(screen, false)).toBe(reserved);
    expect(screen.getByLabelText(/Jahressonderzahlung:.*4.084,53/)).toBeTruthy();
    await screen.rerender(<Pay loading={false} annual />);
    expect(screen.getByLabelText("Jahressonderzahlung: Nicht hinterlegt")).toBeTruthy();
    expect(labels(screen)).toEqual(before);
  });
  it("keeps legal and planning result rows while checks finish", async () => {
    const counts = { criticalCount: 0, warningCount: 0, infoCount: 0 };
    const screen = await render(
      <CheckListCard
        reserveLoadingSpace
        onPress={onPress}
        counts={counts}
        showPlanning
        loading
        status="Wird geprüft …"
      />,
    );
    const before = labels(screen);
    expect(before).toEqual(["Gesetzliche Prüfung", "Planungshinweise"]);
    await screen.rerender(
      <CheckListCard
        reserveLoadingSpace
        onPress={onPress}
        counts={counts}
        showPlanning
        categories={{ legal: counts, planning: counts }}
      />,
    );
    expect(labels(screen)).toEqual(before);
    expect(screen.getByLabelText("Gesetzliche Prüfung: Keine Auffälligkeiten")).toBeTruthy();
  });
});
