import { fireEvent, render, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ComponentProps } from "react";
import * as Native from "react-native";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  setSalaryPaymentPeriod,
} from "@/domain/salary-payment";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { addAnnualSalaryPayment } from "@/engine/net-pay-annual-payment";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { salaryPaymentInput } from "./salary-payment-input";
import { SalaryPayrollContent, SalaryPayrollStatement } from "./salary-payroll-content";
import { NetPayDeductionDetails } from "./net-pay-salary-summary";
import { netPayEuro } from "./net-pay-format";
import { useNetPayProfile } from "./use-net-pay-profile";
import { useAutomaticNetPay } from "./use-automatic-net-pay";
import { SalaryPayrollSettings } from "./salary-payroll-settings";
import { newSpecialDuty } from "@/domain/special-duty";

const mockSettingsView = jest.fn<(props: ComponentProps<typeof SalaryPayrollSettings>) => void>();
jest.mock("./salary-payroll-settings", () => ({
  SalaryPayrollSettings: (props: ComponentProps<typeof SalaryPayrollSettings>) => {
    mockSettingsView(props);
    const NativeModule = jest.requireActual<typeof import("react-native")>("react-native");
    return (
      <NativeModule.View testID="salary-payroll-settings-test">
        <NativeModule.Pressable
          accessibilityRole="button"
          accessibilityLabel="Auszahlungswechsel speichern"
          onPress={() => props.onChanged?.()}
        />
      </NativeModule.View>
    );
  },
}));
jest.mock("./use-net-pay-profile", () => ({ useNetPayProfile: jest.fn() }));
jest.mock("./use-automatic-net-pay", () => ({ useAutomaticNetPay: jest.fn() }));
jest.mock("./use-annual-salary-forecast", () => ({
  useAnnualSalaryForecast: () => ({ payments: [], proposal: null, automatic: false }),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftTestData: () => ({ testMonths: [] }),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
const context = {
  entries: [forecastShift()],
  tariffDecisions: [],
  workPatternSettings: {
    workplaceCoverage: "UNKNOWN" as const,
    assignment: "UNKNOWN" as const,
    updatedAt: null,
  },
  resolver: bundledRuleResolver,
};
function fixture(settings = automatedSettings("2026-06")) {
  const projection = salaryPaymentInput(
    "2026-07",
    forecastProfile,
    context,
    DEFAULT_SALARY_PAYMENT_PREFERENCES,
    "PAYOUT",
  );
  const forecast = calculateAutomaticNetPayForecast(
    {
      month: "2026-07",
      settings,
      profile: forecastProfile,
      shifts: context.entries,
      pay: projection.pay,
    },
    bundledRuleResolver,
  );
  if (forecast.result.status !== "available") throw new Error("Real payroll fixture unavailable");
  return {
    month: "2026-07",
    profile: forecastProfile,
    projection,
    pay: projection.pay,
    net: forecast.result.pay,
    annualGrossCents: 0,
    additionalGrossCents: 0,
    onReviewAllowance: jest.fn<(months: readonly string[]) => void>(),
  };
}

async function openDeductions(
  screen: Awaited<ReturnType<typeof render>>,
  pay: ComponentProps<typeof NetPayDeductionDetails>["pay"],
) {
  await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
  const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/salary-details",
    params: { month: "2026-07", section: "deductions" },
  });
  await screen.rerender(
    <NetPayDeductionDetails pay={pay} month="2026-07" pensionOmitted={false} />,
  );
}

describe("classical payroll presentation", () => {
  it("retains known gross and the review action without showing a stale full net", async () => {
    const props = fixture();
    const entry = forecastShift({
      id: "open-standby",
      specialDuty: newSpecialDuty("STANDBY", "21:00", "07:00", "Europe/Berlin"),
    });
    const projection = salaryPaymentInput(
      props.month,
      props.profile,
      { ...context, entries: [entry] },
      DEFAULT_SALARY_PAYMENT_PREFERENCES,
      "PAYOUT",
    );
    expect(projection.pay.knownGrossAmount).toBeGreaterThan(0);
    const screen = await render(
      <SalaryPayrollStatement {...props} pay={projection.pay} projection={projection} />,
    );
    expect(screen.getAllByText("Bekanntes Brutto").length).toBeGreaterThan(0);
    expect(screen.getByText("Grundentgelt")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bereitschaft · 1 Dienst prüfen" })).toBeTruthy();
    await screen.rerender(
      <SalaryPayrollStatement {...props} pay={projection.pay} projection={projection} view="net" />,
    );
    expect(
      screen.queryByLabelText(`Netto geschätzt: ${netPayEuro(props.net.netCents)}`),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Bereitschaft · 1 Dienst prüfen" })).toBeTruthy();
  });
  it("keeps the genuine statement and opens the previous separate deduction view", async () => {
    const props = fixture();
    const screen = await render(<SalaryPayrollStatement {...props} />);
    const paper = within(screen.getByTestId("salary-payroll-statement"));
    expect(
      paper.getByLabelText(`Gesamtbrutto: ${netPayEuro(props.net.amounts.grossCents)}`),
    ).toBeTruthy();
    expect(paper.queryByLabelText(/^Netto geschätzt:/)).toBeNull();
    expect(paper.queryByRole("button", { name: /^Abzüge:/ })).toBeNull();
    await screen.rerender(<SalaryPayrollStatement {...props} view="net" />);
    const netPaper = within(screen.getByTestId("salary-payroll-statement"));
    expect(
      netPaper.getByLabelText(`Netto geschätzt: ${netPayEuro(props.net.netCents)}`),
    ).toBeTruthy();
    expect(paper.queryByRole("button", { name: /^Gesamtbrutto:/ })).toBeNull();
    expect(paper.queryByRole("button", { name: /^Grundentgelt:/ })).toBeNull();
    expect(paper.queryByText("Lohnsteuer")).toBeNull();
    const deductions = netPaper.getByRole("button", { name: /^Abzüge:/ });
    expect(deductions.props.accessibilityLabel).toContain(
      netPayEuro(-(props.net.amounts.grossCents - props.net.netCents)),
    );
    await openDeductions(screen, props.net);
    for (const label of [
      "Lohnsteuer",
      "Rentenversicherung",
      "Arbeitslosenversicherung",
      "Krankenversicherung",
      "Pflegeversicherung",
    ])
      expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("Abzüge insgesamt")).toBeTruthy();
    expect(screen.getByText("Berechnungsgrundlagen")).toBeTruthy();
    expect(screen.queryByText("Solidaritätszuschlag")).toBeNull();
    expect(screen.queryByText("Kirchensteuer")).toBeNull();
  });
  it("includes only positive church and solidarity taxes in the separate deductions", async () => {
    const props = fixture();
    const net = {
      ...props.net,
      tax: { ...props.net.tax, solidarityCents: 750, churchTaxCents: 2500 },
      netCents: props.net.netCents - 3250,
    };
    const screen = await render(<SalaryPayrollStatement view="net" {...props} net={net} />);
    await openDeductions(screen, net);
    expect(screen.getByLabelText(`Solidaritätszuschlag: ${netPayEuro(750)}`)).toBeTruthy();
    expect(screen.getByLabelText(`Kirchensteuer: ${netPayEuro(2500)}`)).toBeTruthy();
  });
  it("keeps missing net and blocked payroll distinct from zero employee deductions", async () => {
    const props = fixture();
    const screen = await render(
      <SalaryPayrollStatement view="net" {...props} net={null} blocked />,
    );
    const paper = within(screen.getByTestId("salary-payroll-statement"));
    expect(paper.getByLabelText("Abzüge: Nicht verfügbar")).toBeTruthy();
    expect(paper.getByLabelText("Netto geschätzt: Nicht verfügbar")).toBeTruthy();
    expect(paper.queryByRole("button", { name: /^Abzüge:/ })).toBeNull();
    expect(paper.queryByText("Lohnsteuer")).toBeNull();
    expect(paper.queryByText("Zulage prüfen")).toBeNull();
  });
  it("uses the claim month's allowance label and exposes exactly one appropriate review", async () => {
    const preferences = setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
      effectiveMonth: "2026-01",
      delays: {
        PREMIUMS: 1,
        MONTHLY_ALLOWANCE: 1,
        HOURLY_ALLOWANCE: 1,
        OVERTIME: 1,
        SPECIAL_DUTY: 1,
      },
    });
    const projection = salaryPaymentInput(
      "2026-07",
      forecastProfile,
      {
        ...context,
        entries: [forecastShift({ id: "claim-june", date: "2026-06-07" }), forecastShift()],
        tariffDecisions: [
          {
            month: "2026-06",
            allowanceStatus: "ALTERNATING_MONTHLY",
            revision: 1,
            confirmedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
      preferences,
      "PAYOUT",
    );
    const review = jest.fn<(months: readonly string[]) => void>();
    const screen = await render(
      <SalaryPayrollStatement
        {...fixture()}
        pay={projection.pay}
        projection={projection}
        net={null}
        onReviewAllowance={review}
      />,
    );
    expect(screen.getByText("Zulagen aus Juni 2026")).toBeTruthy();
    expect(screen.getByText("Ständige Wechselschichtzulage")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Zulage prüfen/ })).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: /^Zulage prüfen/ }));
    expect(review).toHaveBeenCalledWith(["2026-06"]);
    expect(screen.queryByRole("button", { name: /^Ständige Wechselschichtzulage:/ })).toBeNull();
  });
  it("keeps full money readable at 320 points and large system text", async () => {
    const dimensions = jest
      .spyOn(Native, "useWindowDimensions")
      .mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 1.8 });
    try {
      const props = fixture();
      const screen = await render(<SalaryPayrollStatement {...props} />);
      expect(screen.getByTestId("salary-payroll-totals")).toHaveStyle({ flexDirection: "column" });
      expect(
        within(screen.getByTestId("salary-payroll-totals")).getByLabelText(
          `Gesamtbrutto: ${netPayEuro(props.net.amounts.grossCents)}`,
        ),
      ).toBeTruthy();
    } finally {
      dimensions.mockRestore();
    }
  });
  it("does not activate a dormant manual amount over an active tariff basis", async () => {
    const props = fixture();
    const profile = {
      ...forecastProfile,
      tariff: null,
      nursingTrainingTariff: {
        trainingYear: 1 as const,
        sector: "BT_K" as const,
        tariffRegion: "OTHER" as const,
      },
      manualMonthlyGrossCents: 300000,
    };
    const screen = await render(<SalaryPayrollStatement {...props} profile={profile} />);
    expect(screen.getByText("Ausbildungsentgelt")).toBeTruthy();
    expect(screen.queryByText("Monatsbrutto")).toBeNull();
  });
  it("formats a zero employee deduction without a negative zero", async () => {
    const props = fixture();
    const net = {
      ...props.net,
      tax: {
        ...props.net.tax,
        wageTaxCents: 0,
        totalCents: props.net.tax.totalCents - props.net.tax.wageTaxCents,
      },
      netCents: props.net.netCents + props.net.tax.wageTaxCents,
    };
    const screen = await render(<SalaryPayrollStatement view="net" {...props} net={net} />);
    await openDeductions(screen, net);
    expect(screen.getByLabelText(`Lohnsteuer: ${netPayEuro(0)}`)).toBeTruthy();
    expect(screen.queryByLabelText(`Lohnsteuer: ${netPayEuro(-0)}`)).toBeNull();
  });
  it("does not add an included annual payment twice", async () => {
    const settings = automatedSettings("2026-06");
    const props = fixture(settings);
    const annual = addAnnualSalaryPayment(props.net, settings.profile, [
      {
        revision: 1,
        payoutMonth: "2026-07",
        grossCents: 50000,
        netBasis: { kind: "CONSTANT_PAY" },
      },
    ]);
    expect(annual.annualPayment?.netIncluded).toBe(true);
    const screen = await render(
      <SalaryPayrollStatement
        {...props}
        net={annual.pay}
        annualPayment={annual.annualPayment}
        annualGrossCents={50000}
      />,
    );
    const paper = within(screen.getByTestId("salary-payroll-statement"));
    expect(
      paper.getByLabelText(`Gesamtbrutto: ${netPayEuro(annual.pay.amounts.grossCents)}`),
    ).toBeTruthy();
    expect(paper.getByLabelText(`Jahressonderzahlung: ${netPayEuro(50000)}`)).toBeTruthy();
  });
  it("keeps an excluded annual payment separate from the running net basis", async () => {
    const settings = automatedSettings("2026-06");
    const props = fixture(settings);
    const annual = addAnnualSalaryPayment(props.net, settings.profile, [
      { revision: 1, payoutMonth: "2026-07", grossCents: 50000, netBasis: null },
    ]);
    expect(annual.annualPayment?.netIncluded).toBe(false);
    const screen = await render(
      <SalaryPayrollStatement
        view="net"
        {...props}
        net={annual.pay}
        annualPayment={annual.annualPayment}
        annualGrossCents={50000}
      />,
    );
    const paper = within(screen.getByTestId("salary-payroll-statement"));
    expect(
      paper.getByLabelText(
        `Brutto für Netto-Prognose: ${netPayEuro(props.net.amounts.grossCents)}`,
      ),
    ).toBeTruthy();
    expect(
      paper.getByLabelText(`Netto ohne Jahressonderzahlung: ${netPayEuro(props.net.netCents)}`),
    ).toBeTruthy();
    expect(paper.getByText(/die Netto-Berechnung dafür ist noch offen/)).toBeTruthy();
  });
  it("preserves regular supplementary pension even when annual pension remains omitted", async () => {
    const settings = automatedSettings("2026-06");
    const props = fixture({
      ...settings,
      automation: { ...settings.automation!, pensionScheme: "VBL_WEST" },
    });
    expect(props.net.pension!.employeeCents).toBeGreaterThan(0);
    const screen = await render(
      <SalaryPayrollStatement
        view="net"
        {...props}
        annualPayment={{
          grossCents: 50000,
          totalGrossCents: props.net.amounts.grossCents + 50000,
          netIncluded: false,
          pensionOmitted: true,
          note: "Sonderzahlung noch offen",
        }}
      />,
    );
    expect(
      screen.getByText("Zusatzversorgung auf die Jahressonderzahlung nicht berücksichtigt."),
    ).toBeTruthy();
    await openDeductions(screen, props.net);
    expect(
      screen.getByLabelText(`Zusatzversorgung: ${netPayEuro(props.net.pension!.employeeCents)}`),
    ).toBeTruthy();
  });
});

describe("payroll content wiring", () => {
  const reload = jest.fn<() => void>();
  beforeEach(() => {
    mockSettingsView.mockClear();
    reload.mockClear();
    const settings = automatedSettings("2026-06");
    const saved = {
      settings,
      revision: 1,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    };
    jest.mocked(useNetPayProfile).mockReturnValue({
      month: "2026-07",
      status: "ready",
      saved,
      timeline: [saved],
      annualPayments: [],
      error: null,
      busy: false,
      reload,
      save: jest.fn<ReturnType<typeof useNetPayProfile>["save"]>(),
      resetAnnualPayments: jest.fn<() => Promise<void>>(),
    });
    const props = fixture(settings);
    const forecast = calculateAutomaticNetPayForecast(
      {
        month: "2026-07",
        settings,
        profile: forecastProfile,
        shifts: context.entries,
        pay: props.pay,
      },
      bundledRuleResolver,
    );
    jest.mocked(useAutomaticNetPay).mockReturnValue(forecast);
  });
  it("places the old settings card above the statement and keeps payout choice separate", async () => {
    const props = fixture();
    const screen = await render(
      <SalaryPayrollContent
        month={props.month}
        profile={props.profile}
        pay={props.pay}
        projection={props.projection}
        blocked={false}
      />,
    );
    expect(screen.queryByTestId("net-pay-settings-entry")).toBeNull();
    expect(mockSettingsView.mock.calls.at(-1)?.[0].timingOnly).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Auszahlungswechsel speichern" }));
    expect(reload).toHaveBeenCalledTimes(1);
    await screen.rerender(
      <SalaryPayrollContent
        view="net"
        month={props.month}
        profile={props.profile}
        pay={props.pay}
        projection={props.projection}
        blocked={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Auszahlungswechsel speichern" })).toBeNull();
    const output = JSON.stringify(screen.toJSON());
    expect(output.indexOf("net-pay-settings-entry")).toBeGreaterThan(-1);
    expect(output.indexOf("net-pay-settings-entry")).toBeLessThan(
      output.indexOf("salary-payroll-totals"),
    );
    await fireEvent.press(screen.getByTestId("net-pay-settings-entry"));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/net-pay-settings",
      params: { month: props.month },
    });

    const loaded = jest.mocked(useNetPayProfile).mock.results.at(-1)?.value as ReturnType<
      typeof useNetPayProfile
    >;
    expect(jest.mocked(useAutomaticNetPay).mock.calls.at(-1)?.[4]).toEqual(loaded.timeline);
  });
  it("shows salary without tax setup and keeps net setup on its own view", async () => {
    // The fixture supplies a ready profile; remove only the saved tax setup.
    const ready = useNetPayProfile("2026-07", true);
    jest.mocked(useNetPayProfile).mockReturnValue({ ...ready, saved: null, timeline: [] });
    const props = fixture();
    const content = {
      month: props.month,
      profile: props.profile,
      pay: props.pay,
      projection: props.projection,
      blocked: false,
    };
    const screen = await render(<SalaryPayrollContent {...content} />);
    expect(screen.getByRole("header", { name: "Zusammensetzung" })).toBeTruthy();
    expect(screen.queryByText(/Ergänze deine Netto-Angaben/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Netto-Einstellungen/ })).toBeNull();
    await screen.rerender(<SalaryPayrollContent {...content} view="net" />);
    expect(
      screen.getByText("Ergänze deine Netto-Angaben über die Einstellungskarte."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Netto-Einstellungen/ })).toBeTruthy();
    expect(screen.queryByText("Zusammensetzung")).toBeNull();
  });
  it("marks salary incomplete if shared additional pay could not be loaded", async () => {
    const ready = useNetPayProfile("2026-07", true);
    jest
      .mocked(useNetPayProfile)
      .mockReturnValue({ ...ready, status: "error", saved: null, error: "Load failed" });
    const props = fixture();
    const screen = await render(
      <SalaryPayrollContent
        month={props.month}
        profile={props.profile}
        pay={props.pay}
        projection={props.projection}
        blocked={false}
      />,
    );
    expect(
      screen.getByText(
        "Weitere Bezüge konnten nicht geladen werden. Die Gehaltsübersicht ist unvollständig.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Erneut laden" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Netto-Berechnung")).toBeNull();
  });
  it("opens the existing settings screen for the required source month", async () => {
    jest.mocked(useAutomaticNetPay).mockReturnValue({
      sourceMonth: "2026-06",
      recovery: { kind: "net-settings", month: "2026-05" },
      result: {
        status: "unavailable",
        stage: "net-pay",
        reason: "Netto-Angaben für Mai fehlen.",
      },
    });
    const props = fixture();
    const screen = await render(
      <SalaryPayrollContent
        view="net"
        month={props.month}
        profile={props.profile}
        pay={props.pay}
        projection={props.projection}
        blocked={false}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Angaben ergänzen" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/net-pay-settings",
      params: { month: "2026-05" },
    });
  });
});
