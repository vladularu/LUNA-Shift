import { fireEvent, render, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { Text } from "react-native";
import type { MonthlyComplianceResult } from "@/domain/types";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import type { MonthlyAnalysisCalculation } from "./monthly-analysis";
import { MonthOverview } from "./month-overview";
import type { AnalysisCardId } from "@/domain/analysis-view";
import type { ReactNode } from "react";

const mockPush = jest.fn();
let mockWorkplaceCount = 0;
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock("@/features/workplace/check-summary", () => ({
  WorkplaceCheckSummary: ({ children }: { children: (count: number) => ReactNode }) =>
    children(mockWorkplaceCount),
}));
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
  it("opens only the selected active area or all monthly hints", async () => {
    const shift = forecastShift({ date: "2026-11-06" });
    const data = { ...emptyData, monthShifts: [shift] };
    const compliance: MonthlyComplianceResult = {
      ...emptyChecks,
      issues: [
        {
          id: "rest",
          kind: "LEGAL",
          rule: "ARBZG_5_REST",
          severity: "warning",
          title: "Kurze Ruhezeit",
          description: "Test",
          date: shift.date,
          relatedShiftIds: [shift.id],
        },
      ],
    };
    mockWorkplaceCount = 3;
    try {
      const screen = await render(view(data, compliance));
      expect(screen.queryByText("Hinweise & Empfehlungen")).toBeNull();
      expect(screen.queryByText("Keine Auffälligkeiten")).toBeNull();
      for (const [name, area] of [
        ["Gesetz & Tarif: 1 Warnung", "legal"],
        ["Betriebsregeln: 3 Hinweise", "workplace"],
        ["Dienstplan-Check, Alle 4 Hinweise", undefined],
      ] as const) {
        await fireEvent.press(screen.getByRole("button", { name }));
        expect(mockPush).toHaveBeenLastCalledWith({
          pathname: "/compliance-details",
          params: area ? { month, area } : { month },
        });
      }
      mockWorkplaceCount = 0;
      await screen.rerender(view(data, emptyChecks));
      expect(screen.getAllByText("Keine Auffälligkeiten")).toHaveLength(1);
      expect(screen.queryByText("Gesetz & Tarif")).toBeNull();
      expect(screen.queryByText("Betriebsregeln")).toBeNull();
      await screen.rerender(
        view(data, {
          ...emptyChecks,
          issues: [
            {
              ...compliance.issues[0],
              id: "missing-data",
              rule: "ARBZG_DATA_ALL_EMPLOYMENT",
              severity: "info",
            },
          ],
        }),
      );
      expect(
        screen.getByRole("button", { name: "Dienstplan-Check, Prüfung eingeschränkt" }),
      ).toBeVisible();
      expect(screen.queryByText("Keine Auffälligkeiten")).toBeNull();
    } finally {
      mockWorkplaceCount = 0;
    }
  });
  it("counts three visible weekend periods and one duty sequence as four planning hints", async () => {
    const night = ["10-23", "10-31", "11-01", "11-27", "11-28", "11-29"].map((date) =>
      forecastShift({
        id: date,
        date: `2026-${date}`,
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:30",
      }),
    );
    const late = ["11-14", "11-15", "11-21", "11-22", "11-24", "11-25", "11-26"].map((date) =>
      forecastShift({
        id: date,
        date: `2026-${date}`,
        type: "LATE",
        startTime: "13:18",
        endTime: "21:30",
      }),
    );
    const shifts = [...night, ...late];
    const calculated = calculateMonthlyCompliance(month, shifts, "Europe/Berlin", {
      allEmploymentWorkRecorded: true,
    });
    const issues = calculated.issues.filter(
      ({ rule }) => rule === "PLANNING_7_DAYS" || rule === "PLANNING_WEEKEND_RECOVERY",
    );
    expect(issues).toHaveLength(2);
    const compliance = { ...emptyChecks, issues };
    const data = {
      ...emptyData,
      monthShifts: shifts.filter(({ date }) => date.startsWith(month)),
      complianceShifts: { ok: true as const, value: shifts },
    };
    const screen = await render(view(data, compliance));
    expect(screen.getByLabelText("Hinweise & Empfehlungen: 4 Hinweise")).toBeVisible();
    expect(screen.getByRole("button", { name: "Dienstplan-Check, Alle 4 Hinweise" })).toBeVisible();
    await fireEvent.press(
      screen.getByRole("button", { name: "Hinweise & Empfehlungen: 4 Hinweise" }),
    );
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/compliance-details",
      params: { month, area: "planning" },
    });
    await screen.rerender(view(data, compliance, null, false));
    expect(screen.queryByLabelText(/^Hinweise & Empfehlungen:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Dienstplan-Check, Alle 4 Hinweise" })).toBeNull();
  });

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
