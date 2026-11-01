import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import * as Native from "react-native";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES } from "@/domain/salary-payment";
import type { NetPayResult } from "@/domain/net-pay";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { salaryPaymentInput } from "./salary-payment-input";
import { NetPayDeductionDetails } from "./net-pay-salary-summary";
import { netPayEuro } from "./net-pay-format";

type AvailablePay = Extract<NetPayResult, { status: "available" }>;

function payroll(): AvailablePay {
  const entries = [forecastShift()];
  const projection = salaryPaymentInput(
    "2026-07",
    forecastProfile,
    {
      entries,
      tariffDecisions: [],
      resolver: bundledRuleResolver,
      workPatternSettings: { workplaceCoverage: "UNKNOWN", assignment: "UNKNOWN", updatedAt: null },
    },
    DEFAULT_SALARY_PAYMENT_PREFERENCES,
    "PAYOUT",
  );
  const initial = automatedSettings("2026-06");
  const settings = {
    ...initial,
    automation: {
      ...initial.automation!,
      pensionScheme: "VBL_WEST" as const,
      additionalNetDeductionCents: 1500,
    },
  };
  const forecast = calculateAutomaticNetPayForecast(
    { month: "2026-07", profile: forecastProfile, settings, shifts: entries, pay: projection.pay },
    bundledRuleResolver,
  );
  if (forecast.result.status !== "available") throw new Error("Real deduction fixture unavailable");
  return forecast.result.pay;
}

describe("separate employee deductions page", () => {
  it("preserves the positive hero, photo row order, personal deductions and calculation bases", async () => {
    const pay = payroll();
    const screen = await render(
      <NetPayDeductionDetails pay={pay} month="2026-07" pensionOmitted={false} />,
    );
    expect(
      screen.getByLabelText(
        `Abzüge insgesamt: ${netPayEuro(pay.amounts.grossCents - pay.netCents)}, Juli 2026`,
      ),
    ).toBeTruthy();
    const rows = [
      ["Lohnsteuer", pay.tax.wageTaxCents],
      ["Krankenversicherung", pay.socialInsurance.healthCents],
      ["Pflegeversicherung", pay.socialInsurance.careCents],
      ["Rentenversicherung", pay.socialInsurance.pensionCents],
      ["Arbeitslosenversicherung", pay.socialInsurance.unemploymentCents],
      ["Zusatzversorgung", pay.pension!.employeeCents],
      ["Weitere Netto-Abzüge", pay.additionalNetDeductionCents!],
    ] as const;
    const output = JSON.stringify(screen.toJSON());
    for (const [label, cents] of rows) {
      expect(screen.getByLabelText(`${label}: ${netPayEuro(cents)}`)).toBeTruthy();
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}:`) })).toBeNull();
    }
    for (let index = 1; index < rows.length; index++)
      expect(output.indexOf(rows[index][0])).toBeGreaterThan(output.indexOf(rows[index - 1][0]));
    expect(rows.reduce((total, [, cents]) => total + cents, 0)).toBe(
      pay.amounts.grossCents - pay.netCents,
    );
    expect(screen.getByRole("header", { name: "Steuern und Sozialversicherung" })).toBeTruthy();
    expect(
      screen.getByLabelText(`Steuerbrutto: ${netPayEuro(pay.amounts.taxableGrossCents)}`),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Brutto für Sozialversicherung: ${netPayEuro(pay.amounts.socialInsuranceGrossCents)}`,
      ),
    ).toBeTruthy();
    expect(output.indexOf("Berechnungsgrundlagen")).toBeGreaterThan(
      output.indexOf("Weitere Netto-Abzüge"),
    );
  });
  it("omits zero solidarity and church tax rows", async () => {
    const screen = await render(
      <NetPayDeductionDetails pay={payroll()} month="2026-07" pensionOmitted={false} />,
    );
    expect(screen.queryByText("Solidaritätszuschlag")).toBeNull();
    expect(screen.queryByText("Kirchensteuer")).toBeNull();
  });
  it("shows positive solidarity and church taxes after the five core deductions", async () => {
    const original = payroll();
    const pay = {
      ...original,
      tax: {
        ...original.tax,
        solidarityCents: 750,
        churchTaxCents: 2500,
        totalCents: original.tax.totalCents + 3250,
      },
      netCents: original.netCents - 3250,
    };
    const screen = await render(
      <NetPayDeductionDetails pay={pay} month="2026-07" pensionOmitted={false} />,
    );
    expect(screen.getByLabelText(`Solidaritätszuschlag: ${netPayEuro(750)}`)).toBeTruthy();
    expect(screen.getByLabelText(`Kirchensteuer: ${netPayEuro(2500)}`)).toBeTruthy();
    const output = JSON.stringify(screen.toJSON());
    expect(output.indexOf("Solidaritätszuschlag")).toBeGreaterThan(
      output.indexOf("Arbeitslosenversicherung"),
    );
    expect(output.indexOf("Kirchensteuer")).toBeGreaterThan(output.indexOf("Solidaritätszuschlag"));
    expect(output.indexOf("Zusatzversorgung")).toBeGreaterThan(output.indexOf("Kirchensteuer"));
  });
  it("keeps included supplementary pension when only further pension amounts remain open", async () => {
    const pay = payroll();
    const screen = await render(
      <NetPayDeductionDetails pay={pay} month="2026-07" pensionOmitted />,
    );
    expect(
      screen.getByLabelText(`Zusatzversorgung: ${netPayEuro(pay.pension!.employeeCents)}`),
    ).toBeTruthy();
    expect(screen.getByText(/Zusatzversorgung teilweise berücksichtigt/)).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Abzüge insgesamt: ${netPayEuro(pay.amounts.grossCents - pay.netCents)}, Juli 2026`,
      ),
    ).toBeTruthy();
  });
  it("preserves the 2027 provisional basis notice and its exact computational net", async () => {
    const original = payroll();
    const pay: AvailablePay = {
      ...original,
      month: "2027-01",
      calculationBasis: {
        payrollYear: 2027,
        rulesYear: 2026,
        status: "PREVIOUS_YEAR_ESTIMATE",
        revision: "test-previous-year",
      },
    };
    const screen = await render(
      <NetPayDeductionDetails pay={pay} month="2027-01" pensionOmitted={false} />,
    );
    expect(screen.getByText("2027 vorläufig · Abzüge nach Stand 2026")).toBeTruthy();
    expect(
      screen.getByLabelText(`Netto rechnerisch (vorläufig): ${netPayEuro(pay.netCents)}`),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Abzüge insgesamt: ${netPayEuro(pay.amounts.grossCents - pay.netCents)}, Januar 2027`,
      ),
    ).toBeTruthy();
  });
  it("retains complete positive money at narrow widths and large type", async () => {
    const dimensions = jest
      .spyOn(Native, "useWindowDimensions")
      .mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 1.8 });
    try {
      const pay = payroll();
      const screen = await render(
        <NetPayDeductionDetails pay={pay} month="2026-07" pensionOmitted={false} />,
      );
      expect(
        screen.getByLabelText(
          `Krankenversicherung: ${netPayEuro(pay.socialInsurance.healthCents)}`,
        ),
      ).toBeTruthy();
      expect(
        screen.getByLabelText(
          `Abzüge insgesamt: ${netPayEuro(pay.amounts.grossCents - pay.netCents)}, Juli 2026`,
        ),
      ).toBeTruthy();
    } finally {
      dimensions.mockRestore();
    }
  });
});
