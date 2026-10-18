import { describe, expect, it } from "vitest";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { calculateMonthlyNetPay } from "./net-pay";
import { addAnnualSalaryPayment } from "./net-pay-annual-payment";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile } from "./net-pay-tvoed-forecast-test-fixtures";
import type { UserProfile } from "@/domain/types";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import { calculateAutomaticNetPayForecast } from "./net-pay-automatic-forecast";
import { bundledRuleResolver } from "@/rules/rule-resolver";

const profile = settings().profile;
function regular(month = "2026-11", grossCents = 400_000) {
  const result = calculateMonthlyNetPay({
    month,
    profile,
    specialCases: [],
    amounts: {
      grossCents,
      taxableGrossCents: grossCents,
      socialInsuranceGrossCents: grossCents,
      regularMonthlySocialInsuranceGrossCents: grossCents,
    },
  });
  if (result.status !== "available") throw new Error(result.reason);
  return result;
}
const bonus: AnnualSalaryPayment = {
  revision: 1,
  payoutMonth: "2026-11",
  grossCents: 360_000,
  netBasis: { kind: "CONSTANT_PAY" },
};

describe("separate annual-payment payroll", () => {
  const ordinary = { ...forecastProfile, tariff: null };
  const models: readonly [string, UserProfile][] = [
    ["TVöD-P", forecastProfile],
    [
      "TVöD-E",
      {
        ...ordinary,
        vkaETariff: { payGroup: "E7", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
      },
    ],
    [
      "TV-L/KR",
      { ...ordinary, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } },
    ],
    [
      "TV-H/KR",
      { ...ordinary, tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 } },
    ],
    ["TV-UK", { ...ordinary, tvUkNursingTariff: { payGroup: "PUK7", payLevel: 4 } }],
    [
      "TVAöD",
      {
        ...ordinary,
        nursingTrainingTariff: { trainingYear: 2, sector: "BT_K", tariffRegion: "OTHER" },
      },
    ],
    ["TVA-L", { ...ordinary, tvalPflegeTariff: { trainingYear: 2, universityRegion: "WEST" } }],
    ["Eigene Vergütung", { ...ordinary, manualMonthlyGrossCents: 400_000 }],
  ];
  it.each(models)("connects the confirmed payment to %s gross and net", (_, workProfile) => {
    const initial = automatedSettings("2026-11");
    const pay = calculateMonthlyPayEstimate("2026-11", [], workProfile, null);
    const result = calculateAutomaticNetPayForecast(
      {
        month: "2026-11",
        profile: workProfile,
        pay,
        shifts: [],
        settings: { ...initial, automation: { ...initial.automation!, annualPayments: [bonus] } },
      },
      bundledRuleResolver,
    );
    if (result.result.status !== "available") throw new Error(result.result.reason);
    expect(result.result.pay.amounts.grossCents).toBe(
      Math.round(pay.estimatedGrossAmount! * 100) + bonus.grossCents,
    );
    expect(result.annualPayment?.netIncluded).toBe(true);
  });
  it("adds gross once and uses annual, rather than monthly, SV room", () => {
    const base = regular();
    const value = addAnnualSalaryPayment(base, profile, [bonus]);
    expect(value.annualPayment?.netIncluded).toBe(true);
    expect(value.pay.amounts.grossCents).toBe(760_000);
    expect(value.pay.socialInsurance.totalCents - base.socialInsurance.totalCents).toBe(78_300);
    expect(value.pay.tax.wageTaxCents).toBeGreaterThan(base.tax.wageTaxCents);
    const naive = regular("2026-11", 760_000);
    expect(value.pay.tax.wageTaxCents).not.toBe(naive.tax.wageTaxCents);
    expect(base.amounts.grossCents).toBe(400_000);
  });
  it("respects the distinct GKV and RV annual ceilings", () => {
    const base = regular("2026-11", 840_000);
    const value = addAnnualSalaryPayment(base, profile, [{ ...bonus, grossCents: 1_000_000 }]);
    expect(value.pay.socialInsurance.healthCents).toBe(base.socialInsurance.healthCents);
    expect(value.pay.socialInsurance.pensionCents - base.socialInsurance.pensionCents).toBe(5_115);
    expect(
      value.pay.socialInsurance.unemploymentCents - base.socialInsurance.unemploymentCents,
    ).toBe(715);
  });
  it("does not repeat November's payment in December or the next year", () => {
    for (const month of ["2026-10", "2026-12", "2027-11"]) {
      if (month.startsWith("2027")) {
        expect(
          addAnnualSalaryPayment({ ...regular(), month }, profile, [bonus]).annualPayment,
        ).toBeUndefined();
      } else
        expect(
          addAnnualSalaryPayment(regular(month), profile, [bonus]).annualPayment,
        ).toBeUndefined();
    }
  });
  it("keeps ordinary net visible when annual facts are missing", () => {
    const base = regular();
    const value = addAnnualSalaryPayment(base, profile, [{ ...bonus, netBasis: null }]);
    expect(value.pay).toBe(base);
    expect(value.annualPayment).toMatchObject({ netIncluded: false, totalGrossCents: 760_000 });
  });
  it("does not apply a monthly cap to a confirmed payroll-history basis", () => {
    const base = regular();
    const value = addAnnualSalaryPayment(base, profile, [
      {
        ...bonus,
        netBasis: {
          kind: "PAYROLL",
          annualTaxableGrossCents: 4_800_000,
          socialInsuranceDays: 330,
          healthAssessedCents: 6_383_750,
          pensionAssessedCents: 9_295_000,
        },
      },
    ]);
    expect(value.pay.socialInsurance.healthBasisCents - base.socialInsurance.healthBasisCents).toBe(
      10_000,
    );
    expect(value.pay.socialInsurance.pensionBasisCents).toBe(
      base.socialInsurance.pensionBasisCents,
    );
  });
  it("reserves annual room used by an earlier payment", () => {
    const base = regular("2026-11", 550_000);
    const value = addAnnualSalaryPayment(base, profile, [
      { ...bonus, payoutMonth: "2026-05", grossCents: 200_000 },
      bonus,
    ]);
    expect(value.pay.socialInsurance.healthBasisCents - base.socialInsurance.healthBasisCents).toBe(
      187_500,
    );
  });
  it("leaves a potential March-clause case explicitly open", () => {
    const base = regular("2026-01");
    const value = addAnnualSalaryPayment(base, profile, [{ ...bonus, payoutMonth: "2026-01" }]);
    expect(value.pay).toBe(base);
    expect(value.annualPayment?.note).toContain("Märzklausel");
  });
  it("retains configured pension deductions and discloses missing bonus-pension effects", () => {
    const base = {
      ...regular(),
      pension: {
        scheme: "VBL_WEST" as const,
        contributionBasisCents: 400_000,
        employeeCents: 7_240,
        taxableAdjustmentCents: 0,
        socialInsuranceAdjustmentCents: 0,
      },
    };
    const value = addAnnualSalaryPayment(base, profile, [bonus]);
    expect(value.pay.pension).toBe(base.pension);
    expect(value.annualPayment?.pensionOmitted).toBe(true);
  });
  it("treats an explicit zero as no payment", () => {
    const base = regular();
    expect(addAnnualSalaryPayment(base, profile, [{ ...bonus, grossCents: 0 }])).toEqual({
      pay: base,
    });
  });
});
