import { describe, expect, it } from "vitest";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import type { KnownNetPayPensionScheme } from "@/domain/net-pay-pension-schemes";
import { calculateNetPayPension2026 } from "./net-pay-pension";
import { calculateMonthlyNetPay } from "./net-pay";

describe("2026 additional pension payroll", () => {
  // 5000 EUR monthly basis, official 2026 rates. Includes employer SV additions:
  // a zero employee premium must not turn a pension fund into 'no pension'.
  it.each<{
    scheme: KnownNetPayPensionScheme;
    employeeCents: number;
    taxableAdjustmentCents: number;
    socialInsuranceAdjustmentCents: number;
  }>([
    {
      scheme: "KZVK_DORTMUND",
      employeeCents: 3750,
      taxableAdjustmentCents: -3750,
      socialInsuranceAdjustmentCents: -3750,
    },
    {
      scheme: "BVK_I",
      employeeCents: 0,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 14087,
    },
    {
      scheme: "BVK_II",
      employeeCents: 0,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 0,
    },
    {
      scheme: "KVBW_I",
      employeeCents: 2750,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 21768,
    },
    {
      scheme: "KVBW_II",
      employeeCents: 2000,
      taxableAdjustmentCents: -2000,
      socialInsuranceAdjustmentCents: 6700,
    },
    {
      scheme: "RZVK",
      employeeCents: 0,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 15802,
    },
    {
      scheme: "KVW_I",
      employeeCents: 0,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 16726,
    },
    {
      scheme: "KVW_II",
      employeeCents: 2000,
      taxableAdjustmentCents: -2000,
      socialInsuranceAdjustmentCents: 9170,
    },
    {
      scheme: "KVK_I",
      employeeCents: 3250,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 22194,
    },
    {
      scheme: "ZVK_DARMSTADT_I",
      employeeCents: 2500,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 21556,
    },
    {
      scheme: "ZVK_DARMSTADT_II",
      employeeCents: 2000,
      taxableAdjustmentCents: -2000,
      socialInsuranceAdjustmentCents: -2000,
    },
    {
      scheme: "KVBBG",
      employeeCents: 12000,
      taxableAdjustmentCents: -12000,
      socialInsuranceAdjustmentCents: -7830,
    },
    {
      scheme: "ZVK_SACHSEN",
      employeeCents: 12000,
      taxableAdjustmentCents: -12000,
      socialInsuranceAdjustmentCents: -5330,
    },
    {
      scheme: "ZVK_THUERINGEN",
      employeeCents: 12000,
      taxableAdjustmentCents: -12000,
      socialInsuranceAdjustmentCents: -4830,
    },
  ])("calculates employee and employer effects for $scheme", ({ scheme, ...expected }) => {
    expect(calculateNetPayPension2026(scheme, 500000)).toMatchObject(expected);
  });
  it("applies municipal Darmstadt limits without charging employer restructuring payments", () => {
    // AV I: 456 EUR employer umlage, less 338 EUR exempt and 89.48 EUR flat taxed.
    expect(calculateNetPayPension2026("ZVK_DARMSTADT_I", 800000)).toMatchObject({
      employeeCents: 4000,
      taxableAdjustmentCents: 2852,
      socialInsuranceAdjustmentCents: 38656,
    });
    // AV II: 427.70 EUR ordinary employer capital; the 0.49% surcharge uses no exemption.
    expect(calculateNetPayPension2026("ZVK_DARMSTADT_II", 700000)).toMatchObject({
      employeeCents: 2800,
      taxableAdjustmentCents: -2800,
      socialInsuranceAdjustmentCents: 8970,
    });
  });
  it("uses an explicit EZVK share and preserves employer effects when it is zero", () => {
    expect(calculateNetPayPension2026("EZVK_DARMSTADT", 500000, 100)).toMatchObject({
      employeeCents: 5000,
      taxableAdjustmentCents: -5000,
      socialInsuranceAdjustmentCents: -5000,
    });
    expect(calculateNetPayPension2026("EZVK_KARLSRUHE", 500000, 100)).toMatchObject({
      employeeCents: 5000,
      taxableAdjustmentCents: -5000,
      socialInsuranceAdjustmentCents: -3800,
    });
    expect(calculateNetPayPension2026("EZVK_KARLSRUHE", 500000, 0)).toMatchObject({
      employeeCents: 0,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 1200,
    });
    expect(calculateNetPayPension2026("EZVK_DARMSTADT", 700000, 100)).toMatchObject({
      employeeCents: 7000,
      taxableAdjustmentCents: -7000,
      socialInsuranceAdjustmentCents: 5400,
    });
    for (const own of [undefined, -1, 331, 0.1, NaN])
      expect(() => calculateNetPayPension2026("EZVK_DARMSTADT", 500000, own)).toThrow(
        "Eigenanteil",
      );
    expect(() => calculateNetPayPension2026("EZVK_KARLSRUHE", 500000, 350)).not.toThrow();
    expect(() => calculateNetPayPension2026("EZVK_KARLSRUHE", 500000, 351)).toThrow("Eigenanteil");
    expect(() => calculateNetPayPension2026("VBL_WEST", 500000, 100)).toThrow("Eigenanteil");
  });
  it("matches the published VBL West monthly distribution example of 6500 euros", () => {
    expect(calculateNetPayPension2026("VBL_WEST", 650000)).toMatchObject({
      employeeCents: 11765,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 28909,
    });
  });
  it("matches the published VBL East monthly distribution example of 5000 euros", () => {
    expect(calculateNetPayPension2026("VBL_EAST", 500000)).toMatchObject({
      employeeCents: 21250,
      taxableAdjustmentCents: -21250,
      socialInsuranceAdjustmentCents: -17280,
    });
  });
  it("applies the KZVK 6 percent contribution and different tax and SV allowances", () => {
    expect(calculateNetPayPension2026("KZVK", 500000)).toMatchObject({
      employeeCents: 2000,
      taxableAdjustmentCents: -2000,
      socialInsuranceAdjustmentCents: -2000,
    });
    expect(calculateNetPayPension2026("KZVK", 700000)).toMatchObject({
      employeeCents: 2800,
      taxableAdjustmentCents: -2800,
      socialInsuranceAdjustmentCents: 5400,
    });
  });
  it("rejects unknown and special high-income pension cases", () => {
    expect(() => calculateNetPayPension2026("OTHER", 500000)).toThrow();
    expect(() => calculateNetPayPension2026("VBL_WEST", 1000000)).toThrow();
  });
  const input = (grossCents: number) => ({
    month: "2026-07",
    profile: settings().profile,
    specialCases: [] as const,
    amounts: {
      grossCents,
      taxableGrossCents: grossCents,
      socialInsuranceGrossCents: grossCents,
      regularMonthlySocialInsuranceGrossCents: grossCents,
    },
  });
  it("allows ordinary apprenticeship insurance above 325 euros, including minors", () => {
    const result = calculateMonthlyNetPay({
      ...input(150000),
      profile: { ...settings().profile, birthDate: "2008-07-20" },
      employmentKind: "APPRENTICE",
      specialCases: ["APPRENTICE"],
    });
    expect(result.status).toBe("available");
    expect(calculateMonthlyNetPay(input(150000)).status).toBe("unsupported");
    expect(calculateMonthlyNetPay({ ...input(32500), employmentKind: "APPRENTICE" }).status).toBe(
      "unsupported",
    );
  });
  it("reconciles pension and personal deductions with the cash gross", () => {
    const result = calculateMonthlyNetPay({
      ...input(500000),
      pension: {
        scheme: "VBL_EAST",
        contributionBasisCents: 500000,
        regularContributionBasisCents: 500000,
      },
      additionalNetDeductionCents: 2500,
    });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);
    expect(result.amounts.taxableGrossCents).toBe(478750);
    expect(result.amounts.socialInsuranceGrossCents).toBe(482720);
    expect(
      result.netCents +
        result.tax.totalCents +
        result.socialInsurance.totalCents +
        result.pension!.employeeCents +
        result.additionalNetDeductionCents!,
    ).toBe(500000);
  });
  it("checks transition-zone income after regular pension salary conversion", () => {
    expect(
      calculateMonthlyNetPay({
        ...input(205000),
        pension: {
          scheme: "VBL_EAST",
          contributionBasisCents: 205000,
          regularContributionBasisCents: 205000,
        },
      }).status,
    ).toBe("unsupported");
    expect(
      calculateMonthlyNetPay({
        ...input(205000),
        pension: {
          scheme: "EZVK_DARMSTADT",
          contributionBasisCents: 205000,
          regularContributionBasisCents: 205000,
          employeeRateBps: 300,
        },
      }).status,
    ).toBe("unsupported");
  });
});
