import { describe, expect, it } from "vitest";

import type { SfnNetPayInput } from "@/domain/net-pay-sfn";
import { bundledRuleResolver } from "@/rules/rule-resolver";

import { calculateMonthlyNetPayWithSfn } from "./net-pay-with-sfn";

function input(): SfnNetPayInput {
  const start = "2026-07-09T20:00+02:00";
  const end = "2026-07-09T21:00+02:00";
  return {
    payroll: {
      month: "2026-07",
      completeGross: true,
      grossCents: 500_500,
      regularMonthlySocialInsuranceGrossCents: 500_000,
      basicHourlyPayCents: 2_000,
      workplace: { federalState: "NW", holidayRegion: "NONE" },
      workEvidence: "PLANNED",
      shifts: [
        {
          id: "s1",
          start,
          end,
          unpaidBreaks: [],
          payments: [
            {
              id: "p1",
              kind: "NIGHT",
              amountCents: 500,
              additionalToBasicPay: true,
              periods: [{ start, end }],
            },
          ],
        },
      ],
    },
    profile: {
      birthDate: "1990-01-15",
      taxClass: 1,
      factorPermille: null,
      churchTaxRatePercent: 0,
      childAllowanceHalfUnits: 0,
      isParent: false,
      childrenUnder25: 0,
      worksInSaxony: false,
      healthAdditionalRateBps: 290,
      monthlyTaxAllowanceCents: 0,
    },
    specialCases: [],
  };
}

describe("SFN classification passed to the independently referenced BMF core", () => {
  it("adds a fully free five-euro night payment to the referenced 5,000-euro example", () => {
    const result = calculateMonthlyNetPayWithSfn(input(), bundledRuleResolver);
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);
    expect(result.pay.amounts).toEqual({
      grossCents: 500_500,
      taxableGrossCents: 500_000,
      socialInsuranceGrossCents: 500_000,
      regularMonthlySocialInsuranceGrossCents: 500_000,
    });
    expect(result.pay.tax.wageTaxCents).toBe(78_241); // Existing official BMF fixture at taxable gross 500,000.
    expect(result.pay.socialInsurance.totalCents).toBe(108_750); // Published employee-rate calculation.
    expect(result.pay.netCents).toBe(313_509);
    expect(result.classification.workEvidence).toBe("PLANNED");
  });

  it("preserves SV liability above the 25-euro hourly limit", () => {
    const value = input();
    const s = value.payroll.shifts[0];
    const result = calculateMonthlyNetPayWithSfn(
      {
        ...value,
        payroll: {
          ...value.payroll,
          grossCents: 501_000,
          basicHourlyPayCents: 4_000,
          shifts: [{ ...s, payments: [{ ...s.payments[0], amountCents: 1_000 }] }],
        },
      },
      bundledRuleResolver,
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);
    expect(result.pay.amounts.socialInsuranceGrossCents).toBe(500_375);
    expect(result.pay.tax.wageTaxCents).toBe(78_241);
    expect(result.pay.socialInsurance).toMatchObject({
      healthStandardCents: 36_527,
      healthAdditionalCents: 7_255,
      careCents: 12_009,
      pensionCents: 46_535,
      unemploymentCents: 6_505,
      totalCents: 108_831,
    });
    expect(result.pay.netCents).toBe(313_928);
  });

  it("returns no pay for incomplete DRK-style gross", () => {
    const value = input();
    expect(
      calculateMonthlyNetPayWithSfn(
        { ...value, payroll: { ...value.payroll, completeGross: false } },
        bundledRuleResolver,
      ),
    ).toMatchObject({ status: "unavailable", stage: "sfn" });
  });

  it("returns no pay without a tax profile", () => {
    expect(
      calculateMonthlyNetPayWithSfn({ ...input(), profile: null }, bundledRuleResolver),
    ).toMatchObject({ status: "unavailable", stage: "net-pay" });
  });

  it("requires consistent Saxony employment information in the two inputs", () => {
    const value = input();
    const profile = value.profile!;
    expect(
      calculateMonthlyNetPayWithSfn(
        { ...value, profile: { ...profile, worksInSaxony: true } },
        bundledRuleResolver,
      ),
    ).toMatchObject({ status: "unavailable", stage: "net-pay" });
    expect(
      calculateMonthlyNetPayWithSfn(
        {
          ...value,
          payroll: { ...value.payroll, workplace: { federalState: "SN", holidayRegion: "NONE" } },
        },
        bundledRuleResolver,
      ),
    ).toMatchObject({ status: "unavailable", stage: "net-pay" });
  });

  it("retains unsupported payroll gates such as additional deductions and midijob", () => {
    const value = input();
    expect(
      calculateMonthlyNetPayWithSfn(
        { ...value, specialCases: ["ADDITIONAL_DEDUCTIONS"] },
        bundledRuleResolver,
      ),
    ).toMatchObject({ status: "unavailable", stage: "net-pay" });
    expect(
      calculateMonthlyNetPayWithSfn(
        {
          ...value,
          payroll: { ...value.payroll, regularMonthlySocialInsuranceGrossCents: 200_000 },
        },
        bundledRuleResolver,
      ),
    ).toMatchObject({ status: "unavailable", stage: "net-pay" });
  });
});
