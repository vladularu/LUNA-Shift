import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { describe, expect, it, jest } from "@jest/globals";
import { Text } from "react-native";
import type { ReactNode } from "react";
import type { AnalysisCardId } from "@/domain/analysis-view";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  SALARY_PAYMENT_GROUPS,
  setSalaryPaymentPeriod,
  type SalaryPaymentDelays,
} from "@/domain/salary-payment";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { salaryPaymentInput } from "@/features/salary/salary-payment-input";
import { calculateMonthlyAnalysis } from "./monthly-analysis";
import { MonthOverview } from "./month-overview";
import { formatEuro } from "./salary-summary-card";
jest.mock("./analysis-net-pay-row", () => ({ AnalysisNetPayRow: () => null }));
jest.mock("expo-router", () => ({ router: { push: () => {} } }));

jest.mock("./dashboard-cards", () => ({
  ...jest.requireActual<typeof import("./dashboard-cards")>("./dashboard-cards"),
  AnalysisDashboard: ({ cards }: { cards: Record<AnalysisCardId, ReactNode> }) => (
    <>
      {cards.WORK}
      {cards.PREMIUM}
      {cards.PAY}
    </>
  ),
}));

const month = "2026-10";
const context = {
  entries: ["2026-08-03", "2026-09-06", "2026-10-06"].map((date) =>
    forecastShift({ id: date, date }),
  ),
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  resolver: bundledRuleResolver,
};
const data = calculateMonthlyAnalysis(
  month,
  context.entries,
  forecastProfile,
  [],
  context.workPatternSettings,
  context.resolver,
);
const preferences = (lag: 0 | 1 | 2) =>
  setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
    effectiveMonth: "2026-01",
    delays: Object.fromEntries(
      SALARY_PAYMENT_GROUPS.map((group) => [group, lag]),
    ) as SalaryPaymentDelays,
  });
function view(lag: 0 | 1 | 2, entries = context.entries) {
  const projection = salaryPaymentInput(
    month,
    forecastProfile,
    { ...context, entries },
    preferences(lag),
    "PAYOUT",
  );
  return {
    projection,
    node: (
      <MonthOverview
        month={month}
        data={data}
        profile={forecastProfile}
        compliance={null}
        checkError={null}
        showPlanning
        projection={projection}
        netPay={<Text>Netto aus passender Prognose</Text>}
      />
    ),
  };
}

describe("separate earned and payout salary cards", () => {
  it.each([0, 1, 2] as const)(
    "keeps readiness cash visible in the earned month at lag %i",
    async (lag) => {
      const shift = forecastShift({
        id: "earned-standby",
        date: "2026-10-06",
        title: "Bereitschaft",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        specialDuty: {
          ...newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin"),
          version: 2,
          standbyLevel: "II",
          settlement: "PAY",
          standbyAgreement: {
            ...newStandbyAgreement("TVOED_K"),
            rule: "STANDARD",
            sequence: 1,
            payGroup: "KR_VI",
          },
        },
      });
      const entries = [shift];
      const earned = calculateMonthlyAnalysis(
        month,
        entries,
        forecastProfile,
        [],
        context.workPatternSettings,
        context.resolver,
      );
      if (!earned.pay.ok || !earned.pay.value.available)
        throw new Error("Readiness fixture unavailable");
      const amount = earned.pay.value.specialDutyAmount!;
      expect(amount).toBeGreaterThan(0);
      const projection = salaryPaymentInput(
        month,
        forecastProfile,
        { ...context, entries },
        preferences(lag),
        "PAYOUT",
      );
      const screen = await render(
        <MonthOverview
          month={month}
          data={earned}
          profile={forecastProfile}
          compliance={null}
          checkError={null}
          showPlanning
          projection={projection}
        />,
      );
      expect(
        screen.getByLabelText(`Bereitschaftsvergütung · brutto: ${formatEuro(amount)}`),
      ).toBeTruthy();
      expect(screen.getByText("Für Dienste im Oktober 2026")).toBeTruthy();
    },
  );
  it("keeps earned amounts and work in October while payout follows September", async () => {
    jest.spyOn(router, "push").mockImplementation(() => {});
    const original = view(0);
    const shifted = view(1);
    expect(shifted.projection.pay.timePremiumAmount).not.toBe(
      original.projection.pay.timePremiumAmount,
    );
    const screen = await render(original.node);
    const originalWork = screen.getByLabelText(/^Ist:/).props.accessibilityLabel;
    expect(screen.queryByText(/Zulagen aus/)).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    await screen.rerender(shifted.node);
    expect(
      screen.getByLabelText(
        `Zeitzuschläge · brutto: ${formatEuro(original.projection.pay.timePremiumAmount)}`,
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Zulagen aus September 2026")).toHaveLength(1);
    expect(screen.queryByText("Für Oktober 2026")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByLabelText(/^Ist:/).props.accessibilityLabel).toBe(originalWork);
    expect(screen.getByText("Netto aus passender Prognose")).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Brutto geschätzt: ${formatEuro(shifted.projection.pay.estimatedGrossAmount)}`,
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Zuschläge erarbeitet,/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/premium-details",
      params: { month },
    });
    expect(
      screen.getByLabelText(
        `Grundgehalt: ${formatEuro(shifted.projection.pay.personalBaseAmount)}`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Zeitzuschläge: ${formatEuro(shifted.projection.pay.timePremiumAmount)}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Weitere Zulagen")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Gehalt,/ }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/salary", params: { month } });
  });
  it("uses the second previous source month and leaves incomplete sources visibly open", async () => {
    const complete = view(2);
    const screen = await render(complete.node);
    expect(screen.getByText("Zulagen aus August 2026")).toBeTruthy();
    const incomplete = view(
      2,
      context.entries.filter((entry) => !entry.date.startsWith("2026-08")),
    );
    expect(incomplete.projection.available).toBe(false);
    await screen.rerender(incomplete.node);
    expect(screen.getByRole("button", { name: "Gehalt, Nicht verfügbar" })).toBeTruthy();
    expect(
      screen.queryByLabelText(
        `Brutto geschätzt: ${formatEuro(complete.projection.pay.estimatedGrossAmount)}`,
      ),
    ).toBeNull();
    expect(screen.getByText("Zulagen für August 2026 noch offen")).toBeTruthy();
  });
  it("does not briefly show an earned-month total while the payout projection is pending", async () => {
    const screen = await render(view(0).node);
    expect(screen.getByText("Brutto geschätzt")).toBeTruthy();
    await screen.rerender(
      <MonthOverview
        month={month}
        data={data}
        profile={forecastProfile}
        compliance={null}
        checkError={null}
        showPlanning
        projectionPending
        netPay={<Text>Netto wird berechnet</Text>}
      />,
    );
    expect(screen.queryByText("Brutto geschätzt")).toBeNull();
    expect(screen.getByRole("button", { name: "Gehalt, Wird berechnet …" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Zuschläge erarbeitet,/ })).toBeTruthy();
  });

  it.each([1, 2] as const)(
    "restores the old salary rows with lag %i sources while fixed recurring and annual pay stay current",
    async (lag) => {
      const { projection } = view(lag);
      const recurring = 10_000;
      const annual = 50_000;
      const screen = await render(
        <MonthOverview
          month={month}
          data={data}
          profile={forecastProfile}
          compliance={null}
          checkError={null}
          showPlanning
          projection={projection}
          additionalRecurringGrossCents={recurring}
          annualPayments={[
            { revision: 1, payoutMonth: "2026-09", grossCents: 100_000, netBasis: null },
            { revision: 1, payoutMonth: month, grossCents: annual, netBasis: null },
          ]}
          netPay={<Text>Passendes Netto</Text>}
        />,
      );
      const pay = projection.pay;
      expect(screen.getByRole("button", { name: /^Gehalt,/ })).toBeTruthy();
      expect(
        screen.getByLabelText(`Grundgehalt: ${formatEuro(pay.personalBaseAmount)}`),
      ).toBeTruthy();
      expect(
        screen.getByLabelText(`Zeitzuschläge: ${formatEuro(pay.timePremiumAmount)}`),
      ).toBeTruthy();
      expect(
        screen.getByLabelText(
          `Weitere Zulagen: ${formatEuro(pay.allowanceAmount + pay.tvoedAllowanceAmount + pay.careAllowanceAmount + (pay.specialDutyAmount ?? 0) + recurring / 100)}`,
        ),
      ).toBeTruthy();
      expect(
        screen.getByLabelText(`Jahressonderzahlung: ${formatEuro(annual / 100)}`),
      ).toBeTruthy();
      expect(
        screen.getByLabelText(
          `Brutto geschätzt: ${formatEuro(pay.estimatedGrossAmount! + (recurring + annual) / 100)}`,
        ),
      ).toBeTruthy();
      expect(screen.getByText("Passendes Netto")).toBeTruthy();
      expect(
        screen.getByLabelText(
          `Zeitzuschläge · brutto: ${formatEuro(data.pay.ok ? data.pay.value.timePremiumAmount : null)}`,
        ),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Gehalt & Netto,/ })).toBeNull();
    },
  );
});
