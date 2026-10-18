import { describe, expect, it } from "vitest";
import { validateAnnualSalaryPayments } from "./annual-salary-payment";
import {
  annualPayoutMonths,
  SALARY_ANNUAL_SCHEDULES,
  salaryAnnualFamily,
} from "./salary-annual-schedule";
import { automatedSettings } from "./net-pay-automation-test-fixtures";
import { resolveNetPaySettings, validateMonthlyNetPaySettings } from "./net-pay-profile";
import { forecastProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";

const payment = {
  revision: 1,
  payoutMonth: "2026-11",
  grossCents: 360_000,
  netBasis: { kind: "CONSTANT_PAY" as const },
};
describe("confirmed annual salary payments", () => {
  it("covers every researched family and the AVR-DD year boundary", () => {
    for (const family of Object.keys(
      SALARY_ANNUAL_SCHEDULES,
    ) as (keyof typeof SALARY_ANNUAL_SCHEDULES)[]) {
      expect(annualPayoutMonths(family, 2026)).toEqual(
        family === "OWN" ? [] : family === "AVR_DD" ? ["2026-11", "2027-06"] : ["2026-11"],
      );
    }
    expect(salaryAnnualFamily(forecastProfile)).toBe("TVOED_P");
    expect(
      salaryAnnualFamily({ ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400_000 }),
    ).toBe("OWN");
  });
  it("retains old settings and roundtrips confirmed data", () => {
    const initial = automatedSettings();
    expect(validateMonthlyNetPaySettings(initial)).toEqual(initial);
    const withBonus = {
      ...initial,
      automation: { ...initial.automation!, annualPayments: [payment] },
    };
    expect(validateMonthlyNetPaySettings(JSON.parse(JSON.stringify(withBonus)))).toEqual(withBonus);
  });
  it.each([
    [{ ...payment, payoutMonth: "2026-13" }],
    [{ ...payment, grossCents: -1 }],
    [{ ...payment, grossCents: 1.5 }],
    [payment, payment],
    [{ ...payment, netBasis: { kind: "CONSTANT_PAY", extra: true } }],
    [
      {
        ...payment,
        netBasis: {
          kind: "PAYROLL",
          annualTaxableGrossCents: 0,
          healthAssessedCents: 0,
          pensionAssessedCents: 0,
          socialInsuranceDays: 331,
        },
      },
    ],
  ])("rejects invalid or ambiguous inputs", (...items) => {
    expect(() => validateAnnualSalaryPayments(items)).toThrow();
  });
  it("keeps cash-month data independent of later tax-profile changes and honors cancellation", () => {
    const row = (month: string, updatedAt: string, amount?: number, paymentRevision = 1) => ({
      settings: {
        ...automatedSettings(month),
        automation: {
          ...automatedSettings(month).automation!,
          ...(amount === undefined
            ? {}
            : { annualPayments: [{ ...payment, revision: paymentRevision, grossCents: amount }] }),
        },
      },
      revision: 1,
      createdAt: updatedAt,
      updatedAt,
    });
    const october = row("2026-10", "2026-10-18T10:00:00Z", 360_000);
    const november = row("2026-11", "2026-10-17T10:00:00Z");
    expect(
      resolveNetPaySettings("2026-11", [november, october])?.settings.automation
        ?.annualPayments?.[0].grossCents,
    ).toBe(360_000);
    const cancellation = row("2026-12", "2026-10-18T11:00:00Z", 0, 2);
    expect(
      resolveNetPaySettings("2026-11", [october, november, cancellation])?.settings.automation
        ?.annualPayments?.[0].grossCents,
    ).toBe(0);
  });
});
