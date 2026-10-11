import { describe, expect, it } from "vitest";
import type { NetPayInput } from "@/domain/net-pay";
import type { SfnPayrollInput } from "@/domain/net-pay-sfn";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { calculateMonthlyNetPay } from "./net-pay";
import { classifySfnPayroll2026 } from "./net-pay-sfn";
import { resolveNetPayCalculationBasis } from "./net-pay-calculation-basis";

const input = (month: string): NetPayInput => ({
  month,
  profile: automatedSettings().profile,
  amounts: {
    grossCents: 500_000,
    taxableGrossCents: 500_000,
    socialInsuranceGrossCents: 500_000,
    regularMonthlySocialInsuranceGrossCents: 500_000,
  },
  specialCases: [],
});

function payroll(start: string, end: string): SfnPayrollInput {
  return {
    month: start.slice(0, 7),
    completeGross: true,
    grossCents: 500_000,
    regularMonthlySocialInsuranceGrossCents: 500_000,
    basicHourlyPayCents: 6_000,
    workplace: { federalState: "NW", holidayRegion: "NONE" },
    workEvidence: "PLANNED",
    shifts: [
      {
        id: "future-work",
        start,
        end,
        unpaidBreaks: [],
        payments: [
          {
            id: "premium",
            kind: "DAY",
            amountCents: 20_000,
            additionalToBasicPay: true,
            periods: [{ start, end }],
          },
        ],
      },
    ],
  };
}

describe("separate forecast month and verified deduction year", () => {
  it("requires the explicit forecast mode for 2027 and preserves the 2026 default", () => {
    expect(resolveNetPayCalculationBasis("2026-01")).toMatchObject({
      payrollYear: 2026,
      rulesYear: 2026,
      status: "VERIFIED",
    });
    expect(resolveNetPayCalculationBasis("2027-01")).toBeNull();
    expect(resolveNetPayCalculationBasis("2027-01", "FORECAST")).toMatchObject({
      payrollYear: 2027,
      rulesYear: 2026,
      status: "PREVIOUS_YEAR_ESTIMATE",
    });
    expect(calculateMonthlyNetPay(input("2027-01")).status).toBe("unsupported");
  });

  it.each(["2025-01", "2028-01", "2027-00", "2027-13", "2027-1", "2027-01-01"])(
    "does not invent a calculation basis for %s",
    (month) => {
      expect(resolveNetPayCalculationBasis(month, "FORECAST")).toBeNull();
      expect(calculateMonthlyNetPay(input(month), "FORECAST").status).not.toBe("available");
    },
  );

  it("carries the tested deduction model and pension assumptions with explicit metadata", () => {
    const pension = {
      scheme: "VBL_WEST" as const,
      contributionBasisCents: 500_000,
      regularContributionBasisCents: 500_000,
    };
    const before = calculateMonthlyNetPay({ ...input("2026-01"), pension });
    const after = calculateMonthlyNetPay({ ...input("2027-01"), pension }, "FORECAST");
    expect(before.status).toBe("available");
    expect(after.status).toBe("available");
    if (before.status !== "available" || after.status !== "available")
      throw new Error("Missing net");
    expect(after.month).toBe("2027-01");
    expect(after.calculationBasis).toMatchObject({
      payrollYear: 2027,
      rulesYear: 2026,
      status: "PREVIOUS_YEAR_ESTIMATE",
    });
    expect(after.tax).toEqual(before.tax);
    expect(after.socialInsurance).toEqual(before.socialInsurance);
    expect(after.pension).toEqual(before.pension);
    expect(after.netCents).toBe(before.netCents);
  });

  it("uses the real 2027 birthday month rather than moving the profile back to 2026", () => {
    const calculate = (month: string) =>
      calculateMonthlyNetPay(
        {
          ...input(month),
          profile: {
            ...input(month).profile!,
            birthDate: "2004-01-15",
            isParent: false,
            childrenUnder25: 0,
          },
        },
        "FORECAST",
      );
    const birthday = calculate("2027-01");
    const following = calculate("2027-02");
    expect(birthday.status).toBe("available");
    expect(following.status).toBe("available");
    if (birthday.status !== "available" || following.status !== "available")
      throw new Error("Missing net");
    expect(birthday.socialInsurance.careCents).toBe(9_000);
    expect(following.socialInsurance.careCents).toBe(12_000);
    expect(
      calculateMonthlyNetPay(
        { ...input("2027-01"), profile: { ...input("2027-01").profile!, birthDate: "1963-01-01" } },
        "FORECAST",
      ).status,
    ).toBe("unsupported");
  });

  it("uses Sunday in 2027 and keeps separate tax and social-insurance exemption caps", () => {
    const work = payroll("2027-01-03T08:00+01:00", "2027-01-03T10:00+01:00");
    expect(classifySfnPayroll2026(work, bundledRuleResolver).status).toBe("unsupported");
    const result = classifySfnPayroll2026(work, bundledRuleResolver, "FORECAST");
    expect(result).toMatchObject({
      status: "available",
      calculationBasis: { payrollYear: 2027, rulesYear: 2026, status: "PREVIOUS_YEAR_ESTIMATE" },
      taxFreeCents: 5_000,
      socialInsuranceFreeCents: 2_500,
    });
    if (result.status !== "available") throw new Error(result.reason);
    expect(result.shifts[0]).toMatchObject({
      dayMinutes: 120,
      taxablePremiumCents: 15_000,
      socialInsuranceLiablePremiumCents: 17_500,
    });
    expect(
      classifySfnPayroll2026({ ...work, workEvidence: "RECORDED" }, bundledRuleResolver, "FORECAST")
        .status,
    ).toBe("unsupported");
  });

  it.each(["2027-01-01", "2027-03-26"])(
    "recognizes the actual 2027 public holiday on %s",
    (date) => {
      const work = payroll(`${date}T08:00+01:00`, `${date}T10:00+01:00`);
      expect(classifySfnPayroll2026(work, bundledRuleResolver, "FORECAST")).toMatchObject({
        status: "available",
        taxFreeCents: 12_500,
        socialInsuranceFreeCents: 6_250,
        shifts: [{ dayMinutes: 120 }],
      });
    },
  );

  it("keeps non-SFN cash taxable even on a 2027 holiday", () => {
    const work = payroll("2027-01-01T08:00+01:00", "2027-01-01T10:00+01:00");
    const shift = work.shifts[0]!;
    expect(
      classifySfnPayroll2026(
        { ...work, shifts: [{ ...shift, payments: [{ ...shift.payments[0]!, kind: "OTHER" }] }] },
        bundledRuleResolver,
        "FORECAST",
      ),
    ).toMatchObject({
      status: "available",
      paidPremiumCents: 20_000,
      taxFreeCents: 0,
      socialInsuranceFreeCents: 0,
    });
  });

  it.each([
    ["2027-03-27T22:00+01:00", "2027-03-28T06:00+02:00", 420, 5_500],
    ["2027-10-30T22:00+02:00", "2027-10-31T06:00+01:00", 540, 7_500],
  ] as const)("uses actual 2027 DST minutes from %s", (start, end, minutes, freeCents) => {
    const work = payroll(start, end);
    const shift = work.shifts[0]!;
    const result = classifySfnPayroll2026(
      {
        ...work,
        basicHourlyPayCents: 2_500,
        shifts: [{ ...shift, payments: [{ ...shift.payments[0]!, kind: "NIGHT" }] }],
      },
      bundledRuleResolver,
      "FORECAST",
    );
    expect(result).toMatchObject({
      status: "available",
      taxFreeCents: freeCents,
      shifts: [{ workedMinutes: minutes }],
    });
  });
});
