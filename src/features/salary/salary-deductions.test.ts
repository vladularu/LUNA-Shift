import { describe, expect, it } from "vitest";
import type { NetPayResult } from "@/domain/net-pay";
import { salaryDeductions } from "./salary-deductions";

type AvailablePay = Extract<NetPayResult, { status: "available" }>;

const pay: AvailablePay = {
  status: "available",
  month: "2026-10",
  ruleVersion: "DE-2026-PAP1-SV2026-PROTOTYPE",
  amounts: {
    grossCents: 500_000,
    taxableGrossCents: 500_000,
    socialInsuranceGrossCents: 500_000,
    regularMonthlySocialInsuranceGrossCents: 500_000,
  },
  tax: {
    wageTaxCents: 80_000,
    solidarityCents: 0,
    churchTaxBasisCents: 80_000,
    churchTaxCents: 0,
    totalCents: 80_000,
  },
  socialInsurance: {
    healthBasisCents: 500_000,
    pensionBasisCents: 500_000,
    healthStandardCents: 36_500,
    healthAdditionalCents: 3_500,
    healthCents: 40_000,
    careCents: 9_000,
    pensionCents: 46_000,
    unemploymentCents: 6_000,
    totalCents: 101_000,
  },
  netCents: 319_000,
};

describe("salaryDeductions", () => {
  it("shows the employee deductions once, with the combined health contribution", () => {
    expect(salaryDeductions(pay)).toEqual({
      totalCents: 181_000,
      rows: [
        { id: "wage-tax", label: "Lohnsteuer", amountCents: 80_000 },
        { id: "pension-insurance", label: "Rentenversicherung", amountCents: 46_000 },
        { id: "unemployment-insurance", label: "Arbeitslosenversicherung", amountCents: 6_000 },
        { id: "health-insurance", label: "Krankenversicherung", amountCents: 40_000 },
        { id: "care-insurance", label: "Pflegeversicherung", amountCents: 9_000 },
      ],
    });
  });

  it.each([
    { solidarity: 1_000, church: 0, ids: ["solidarity"] },
    { solidarity: 0, church: 7_200, ids: ["church-tax"] },
    { solidarity: 1_000, church: 7_200, ids: ["solidarity", "church-tax"] },
  ])("shows only positive solidarity/church deductions: $ids", ({ solidarity, church, ids }) => {
    const result = salaryDeductions({
      ...pay,
      tax: {
        ...pay.tax,
        solidarityCents: solidarity,
        churchTaxCents: church,
        totalCents: 80_000 + solidarity + church,
      },
      netCents: 319_000 - solidarity - church,
    });
    expect(result.rows.filter((row) => ["solidarity", "church-tax"].includes(row.id))).toEqual(
      ids.map((id) => ({
        id,
        label: id === "solidarity" ? "Solidaritätszuschlag" : "Kirchensteuer",
        amountCents: id === "solidarity" ? solidarity : church,
      })),
    );
    expect(result.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(result.totalCents);
  });

  it("keeps statutory pension separate from supplementary pension and other net deductions", () => {
    const result = salaryDeductions({
      ...pay,
      pension: {
        scheme: "VBL_WEST",
        contributionBasisCents: 500_000,
        employeeCents: 9_050,
        taxableAdjustmentCents: 0,
        socialInsuranceAdjustmentCents: 0,
      },
      additionalNetDeductionCents: 1_500,
      netCents: 308_450,
    });
    expect(result.totalCents).toBe(191_550);
    expect(result.rows).toContainEqual({
      id: "pension-insurance",
      label: "Rentenversicherung",
      amountCents: 46_000,
    });
    expect(result.rows.slice(-2)).toEqual([
      { id: "supplementary-pension", label: "Zusatzversorgung", amountCents: 9_050 },
      { id: "other-net", label: "Weitere Netto-Abzüge", amountCents: 1_500 },
    ]);
    expect(result.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(result.totalCents);
  });

  it("keeps the mandatory deduction rows when their calculated amounts are zero", () => {
    const result = salaryDeductions({
      ...pay,
      tax: {
        wageTaxCents: 0,
        solidarityCents: 0,
        churchTaxBasisCents: 0,
        churchTaxCents: 0,
        totalCents: 0,
      },
      socialInsurance: {
        healthBasisCents: 0,
        pensionBasisCents: 0,
        healthStandardCents: 0,
        healthAdditionalCents: 0,
        healthCents: 0,
        careCents: 0,
        pensionCents: 0,
        unemploymentCents: 0,
        totalCents: 0,
      },
      netCents: 500_000,
    });
    expect(result.totalCents).toBe(0);
    expect(result.rows).toHaveLength(5);
    expect(result.rows.every((row) => row.amountCents === 0)).toBe(true);
  });

  it("does not present an absent supplementary pension or zero personal deduction as charged", () => {
    const result = salaryDeductions({
      ...pay,
      pension: {
        scheme: "NONE",
        contributionBasisCents: 0,
        employeeCents: 0,
        taxableAdjustmentCents: 0,
        socialInsuranceAdjustmentCents: 0,
      },
      additionalNetDeductionCents: 0,
    });
    expect(result.rows.map((row) => row.id)).not.toContain("supplementary-pension");
    expect(result.rows.map((row) => row.id)).not.toContain("other-net");
    expect(result.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(result.totalCents);
  });

  it("uses already finalized annual-payment amounts without adding them a second time", () => {
    const result = salaryDeductions({
      ...pay,
      amounts: { ...pay.amounts, grossCents: 650_000 },
      tax: {
        ...pay.tax,
        wageTaxCents: 125_000,
        solidarityCents: 2_000,
        churchTaxCents: 10_000,
        totalCents: 137_000,
      },
      socialInsurance: {
        ...pay.socialInsurance,
        healthStandardCents: 47_450,
        healthAdditionalCents: 4_550,
        healthCents: 52_000,
        careCents: 11_700,
        pensionCents: 59_800,
        unemploymentCents: 7_800,
        totalCents: 131_300,
      },
      additionalNetDeductionCents: 1_500,
      netCents: 380_200,
    });
    expect(result.totalCents).toBe(269_800);
    expect(result.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(269_800);
  });
});
