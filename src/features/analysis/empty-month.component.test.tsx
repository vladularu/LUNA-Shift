import { render, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { Text } from "react-native";
import type { MonthlyComplianceResult } from "@/domain/types";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import type { MonthlyAnalysisCalculation } from "./monthly-analysis";
import { MonthOverview } from "./month-overview";
import type { AnalysisCardId } from "@/domain/analysis-view";
import type { ReactNode } from "react";
jest.mock("./analysis-net-pay-row", () => ({ AnalysisNetPayRow: () => null }));

jest.mock("./dashboard-cards", () => {
  const actual = jest.requireActual<typeof import("./dashboard-cards")>("./dashboard-cards");
  return {
    ...actual,
    AnalysisDashboard: ({ cards }: { cards: Record<AnalysisCardId, ReactNode> }) => (
      <>
        {cards.CHECK}
        {cards.PAY}
        {cards.NET}
      </>
    ),
  };
});
const month = "2026-11";
const emptyData = {
  monthShifts: [],
  complianceShifts: { ok: true, value: [] },
  summary: { ok: true, value: { actualMinutes: 0, targetMinutes: 9600, balanceMinutes: -9600 } },
  shiftTypeAnalysis: { totalMinutes: 0 },
  pay: {
    ok: true,
    value: {
      available: true,
      personalBaseAmount: 3200,
      timePremiumAmount: 0,
      overtimeAmount: 0,
      allowanceAmount: 100,
      tvoedAllowanceAmount: 0,
      careAllowanceAmount: 0,
      estimatedGrossAmount: 3300,
    },
  },
} as unknown as MonthlyAnalysisCalculation;
const emptyChecks: MonthlyComplianceResult = {
  month,
  issues: [],
  affectedDates: [],
  criticalCount: 0,
  warningCount: 0,
  infoCount: 0,
};
const view = (
  data = emptyData,
  compliance: MonthlyComplianceResult | null = emptyChecks,
  error: string | null = null,
  showPlanning = true,
) => (
  <MonthOverview
    month={month}
    data={data}
    profile={forecastProfile}
    compliance={compliance}
    checkError={error}
    showPlanning={showPlanning}
    annualPayments={[{ revision: 1, payoutMonth: month, grossCents: 50000, netBasis: null }]}
    netPay={<Text>Basis-Netto vorhanden</Text>}
  />
);
describe("empty month presentation", () => {
  it.each<[boolean, 0 | 2]>([
    [true, 0],
    [false, 0],
    [true, 2],
    [false, 2],
  ])(
    "keeps an empty month neutral without weekend statistics (planning %s, open %s)",
    async (showPlanning, unknownCount) => {
      const checks: MonthlyComplianceResult = {
        ...emptyChecks,
        weekendAssessment: {
          policyVersion: "2026-11-09-four-weeks",
          month,
          weekends: [],
          windows: [],
          totalCount: 5,
          occupiedCount: 0,
          freeCount: 5 - unknownCount,
          unknownCount,
        },
      };
      const screen = await render(view(emptyData, checks, null, showPlanning));
      expect(screen.getByText("Keine Dienste eingetragen")).toBeVisible();
      expect(screen.queryByLabelText("Gesetz & Tarif: Keine Auffälligkeiten")).toBeNull();
      expect(screen.queryByLabelText(/^Belegte Wochenenden:/)).toBeNull();
      expect(screen.queryByLabelText(/^Vollständig freie Wochenenden:/)).toBeNull();
      expect(screen.queryByLabelText(/^Offene Wochenenden:/)).toBeNull();
      expect(screen.queryByRole("button", { name: /Wochenendübersicht/ })).toBeNull();
    },
  );

  it("shows a neutral empty state without waiting or a positive check seal", async () => {
    const screen = await render(view(emptyData, null));
    expect(screen.getByText("Keine Dienste eingetragen")).toBeTruthy();
    expect(screen.queryByText("Wird geprüft …")).toBeNull();
    expect(screen.queryByLabelText("Gesetz & Tarif: Keine Auffälligkeiten")).toBeNull();
  });
  it("shows fixed pay and annual payment in the original salary rows", async () => {
    const screen = await render(view());
    expect(screen.getByLabelText(/Brutto geschätzt:.*3.800,00/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Gehalt,/ })).toBeTruthy();
    expect(screen.getByLabelText(/Grundgehalt:.*3.200,00/)).toBeTruthy();
    expect(screen.getByLabelText(/Weitere Zulagen:.*100,00/)).toBeTruthy();
    expect(screen.getByLabelText(/Jahressonderzahlung:.*500,00/)).toBeTruthy();
    const salary = screen.getByTestId("analysis-card-body-Gehalt");
    const net = screen.getByTestId("analysis-card-body-Netto");
    expect(within(salary).queryByText("Basis-Netto vorhanden")).toBeNull();
    expect(within(net).getByText("Basis-Netto vorhanden")).toBeTruthy();
  });
  it("keeps cross-month findings and catalog warnings visible even without target-month shifts", async () => {
    const checks: MonthlyComplianceResult = {
      ...emptyChecks,
      warningCount: 1,
      issues: [
        {
          id: "coverage",
          severity: "warning",
          kind: "LEGAL",
          rule: "HOLIDAY_CATALOG_COVERAGE",
          title: "Katalog offen",
          description: "Prüfgrundlage fehlt",
          date: month + "-01",
          relatedShiftIds: [],
        },
      ],
    };
    const screen = await render(view(emptyData, checks));
    expect(screen.queryByText("Keine Dienste eingetragen")).toBeNull();
    expect(screen.getByLabelText("Gesetz & Tarif: 1 Warnung")).toBeTruthy();
    const data = {
      ...emptyData,
      complianceShifts: { ok: true as const, value: [forecastShift({ date: "2026-10-31" })] },
    };
    await screen.rerender(
      view(data, { ...checks, issues: [{ ...checks.issues[0], rule: "ARBZG_11_SUNDAY_REST" }] }),
    );
    expect(screen.getByLabelText("Gesetz & Tarif: 1 Warnung")).toBeTruthy();
  });
  it("resumes checking when a shift is added and keeps errors above the empty state", async () => {
    const screen = await render(view());
    const data = { ...emptyData, monthShifts: [forecastShift({ date: month + "-01" })] };
    await screen.rerender(view(data, null));
    expect(screen.queryByText("Keine Dienste eingetragen")).toBeNull();
    expect(screen.getAllByText("Wird geprüft …").length).toBeGreaterThan(0);
    await screen.rerender(view(emptyData, null, "Prüfung fehlgeschlagen"));
    expect(screen.getByText("Nicht verfügbar")).toBeTruthy();
  });
});
