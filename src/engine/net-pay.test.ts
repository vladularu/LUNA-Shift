import { describe, expect, it } from "vitest";

import bmfReferences from "../../scripts/fixtures/net-pay/bmf-2026-reference.json";
import type { NetPayInput, NetPayProfile, NetPayResult, NetPaySpecialCase } from "@/domain/net-pay";
import { calculateMonthlyNetPay } from "@/engine/net-pay";

const profile: NetPayProfile = {
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
};

function input(patch: Partial<NetPayProfile> = {}, grossCents = 500_000): NetPayInput {
  return {
    month: "2026-07",
    profile: { ...profile, ...patch },
    amounts: {
      grossCents,
      taxableGrossCents: grossCents,
      socialInsuranceGrossCents: grossCents,
      regularMonthlySocialInsuranceGrossCents: grossCents,
    },
    specialCases: [],
  };
}

function available(value = input()): Extract<NetPayResult, { status: "available" }> {
  const result = calculateMonthlyNetPay(value);
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error(result.reason);
  return result;
}

describe("offline net-pay prototype 2026", () => {
  describe("recorded official BMF program-test results", () => {
    for (const reference of bmfReferences.cases) {
      it(`matches BMF cents: ${reference.name}`, () => {
        const result = available(reference.input as NetPayInput);
        expect({
          wageTaxCents: result.tax.wageTaxCents,
          solidarityCents: result.tax.solidarityCents,
          churchTaxBasisCents: result.tax.churchTaxBasisCents,
        }).toEqual(reference.expected);
      });
    }
  });

  it("reconciles the 5,000 euro example with employee deductions in cents", () => {
    const result = available();
    expect(result.tax.wageTaxCents).toBe(78_241); // Recorded BMF reference, not a derived snapshot.
    expect(result.socialInsurance).toMatchObject({
      healthStandardCents: 36_500,
      healthAdditionalCents: 7_250,
      healthCents: 43_750,
      careCents: 12_000,
      pensionCents: 46_500,
      unemploymentCents: 6_500,
      totalCents: 108_750,
    });
    expect(result.netCents).toBe(313_009);
    expect(result.netCents + result.tax.totalCents + result.socialInsurance.totalCents).toBe(
      500_000,
    );
  });

  it("caps insurance branches independently at the official 2026 limits", () => {
    expect(available(input({}, 1_000_000)).socialInsurance).toEqual({
      healthBasisCents: 581_250,
      pensionBasisCents: 845_000,
      healthStandardCents: 42_431,
      healthAdditionalCents: 8_428,
      healthCents: 50_859,
      careCents: 13_950,
      pensionCents: 78_585,
      unemploymentCents: 10_985,
      totalCents: 154_379,
    });
    const limit = available(input({}, 581_250));
    const above = available(input({}, 581_251));
    expect(above.socialInsurance.healthCents).toBe(limit.socialInsurance.healthCents);
    expect(above.socialInsurance.pensionBasisCents).toBe(581_251);
  });

  it("rounds the standard GKV and additional contributions separately", () => {
    const insurance = available(input({ healthAdditionalRateBps: 269 }, 200_006)).socialInsurance;
    expect(insurance.healthStandardCents).toBe(14_600);
    expect(insurance.healthAdditionalCents).toBe(2_690);
    expect(insurance.healthCents).toBe(17_290); // Combined rounding would incorrectly produce 17,291.
  });

  it.each([
    [0, 9_000],
    [1, 9_000],
    [2, 7_750],
    [3, 6_500],
    [4, 5_250],
    [5, 4_000],
    [6, 4_000],
  ])(
    "uses parent status and caps discounts for %i eligible children",
    (childrenUnder25, careCents) => {
      expect(available(input({ isParent: true, childrenUnder25 })).socialInsurance.careCents).toBe(
        careCents,
      );
    },
  );

  it("uses the Saxony employment rule independently of church tax", () => {
    expect(available(input({ worksInSaxony: true })).socialInsurance.careCents).toBe(14_500);
    expect(
      available(input({ worksInSaxony: true, isParent: true, childrenUnder25: 2 })).socialInsurance
        .careCents,
    ).toBe(10_250);
  });

  it.each(["2003-07-01", "2003-07-15", "2003-07-31"])(
    "starts the childless surcharge after the birthday month: %s",
    (birthDate) => {
      expect(available(input({ birthDate })).socialInsurance.careCents).toBe(9_000);
      expect(
        available({ ...input({ birthDate }), month: "2026-08" }).socialInsurance.careCents,
      ).toBe(12_000);
    },
  );

  it("uses the church-tax basis with child allowance and discards fractional cents", () => {
    expect(available(input({ churchTaxRatePercent: 8 })).tax.churchTaxCents).toBe(6_259);
    expect(available(input({ churchTaxRatePercent: 9 })).tax.churchTaxCents).toBe(7_041);
    const parent = available(input({ isParent: true, churchTaxRatePercent: 9 }));
    const allowance = available(
      input({ isParent: true, churchTaxRatePercent: 9, childAllowanceHalfUnits: 2 }),
    );
    expect(allowance.tax.wageTaxCents).toBe(parent.tax.wageTaxCents);
    expect(allowance.tax.churchTaxCents).toBeLessThan(parent.tax.churchTaxCents);
    expect(allowance.socialInsurance).toEqual(parent.socialInsurance);
  });

  it("keeps cash gross, tax gross and insurance gross independent", () => {
    const baseline = available();
    const result = available({
      ...input(),
      amounts: {
        grossCents: 560_000,
        taxableGrossCents: 500_000,
        socialInsuranceGrossCents: 530_000,
        regularMonthlySocialInsuranceGrossCents: 500_000,
      },
    });
    expect(result.tax).toEqual(baseline.tax);
    expect(result.socialInsurance.totalCents).toBe(115_275);
    expect(result.netCents).toBe(366_484);
  });

  it.each([60300, 60301, 150000, 200000])("rejects transition-zone income %i", (grossCents) => {
    expect(calculateMonthlyNetPay(input({}, grossCents)).status).toBe("unsupported");
  });

  it("does not let an unusually high month bypass the regular-income transition-zone check", () => {
    const value = input();
    expect(
      calculateMonthlyNetPay({
        ...value,
        amounts: { ...value.amounts, regularMonthlySocialInsuranceGrossCents: 150_000 },
      }).status,
    ).toBe("unsupported");
  });

  const specialCases: readonly NetPaySpecialCase[] = [
    "PRIVATE_INSURANCE",
    "MINIJOB",
    "MIDIJOB",
    "MULTIPLE_EMPLOYMENTS",
    "ONE_OFF_PAYMENT",
    "ADDITIONAL_DEDUCTIONS",
    "PARTIAL_MONTH",
    "PENSIONER",
    "APPRENTICE",
    "OTHER_INSURANCE_STATUS",
  ];
  it.each(specialCases)("does not invent a result for %s", (specialCase) => {
    expect(calculateMonthlyNetPay({ ...input(), specialCases: [specialCase] }).status).toBe(
      "unsupported",
    );
  });

  it("requires a tax profile and an explicit payroll scope", () => {
    expect(calculateMonthlyNetPay({ ...input(), profile: null }).status).toBe("missing-profile");
    expect(
      calculateMonthlyNetPay({ ...input(), specialCases: undefined } as unknown as NetPayInput)
        .status,
    ).toBe("invalid-input");
  });

  it.each(["2026-00", "2026-13", "26-07", "2026-7", "2026-07-01"])(
    "rejects malformed month %s",
    (month) => {
      expect(calculateMonthlyNetPay({ ...input(), month }).status).toBe("invalid-input");
    },
  );

  it.each(["2025-12", "2027-01"])("does not reuse 2026 rules for %s", (month) => {
    expect(calculateMonthlyNetPay({ ...input(), month }).status).toBe("unsupported");
  });

  it.each(["1960-01-01", "2010-01-01", "2030-01-01"])("rejects unsupported age %s", (birthDate) => {
    expect(calculateMonthlyNetPay(input({ birthDate })).status).toBe("unsupported");
  });

  it.each(["1990-02-30", "1990-1-1", "", "1990-01-01T00:00"])(
    "rejects malformed birth date %s",
    (birthDate) => {
      expect(calculateMonthlyNetPay(input({ birthDate })).status).toBe("invalid-input");
    },
  );

  it.each([
    { taxClass: 0 },
    { taxClass: 7 },
    { churchTaxRatePercent: 7 },
    { factorPermille: 0 },
    { taxClass: 4, factorPermille: 1000 },
    { factorPermille: 800 },
    { childAllowanceHalfUnits: 1.5 },
    { taxClass: 6, childAllowanceHalfUnits: 1 },
    { isParent: false, childrenUnder25: 1 },
    { childrenUnder25: -1 },
    { healthAdditionalRateBps: Number.NaN },
    { monthlyTaxAllowanceCents: -1 },
    { worksInSaxony: undefined },
  ])("rejects invalid profile data %j", (patch) => {
    expect(calculateMonthlyNetPay(input(patch as Partial<NetPayProfile>)).status).toBe(
      "invalid-input",
    );
  });

  it.each([-1, 0, 200_000.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001])(
    "rejects invalid gross cents %s",
    (grossCents) => {
      expect(calculateMonthlyNetPay(input({}, grossCents)).status).toBe("invalid-input");
    },
  );

  it("rejects contradictory and missing gross bases", () => {
    const value = input();
    for (const amounts of [
      { ...value.amounts, taxableGrossCents: 500_001 },
      { ...value.amounts, socialInsuranceGrossCents: 499_999 },
      { ...value.amounts, regularMonthlySocialInsuranceGrossCents: undefined },
    ]) {
      expect(calculateMonthlyNetPay({ ...value, amounts } as NetPayInput).status).toBe(
        "invalid-input",
      );
    }
  });

  it("is deterministic, does not mutate input, and retains an immutable result snapshot", () => {
    const value = input();
    const before = structuredClone(value);
    const first = available(value);
    expect(available(value)).toEqual(first);
    expect(value).toEqual(before);
    expect(first.amounts).not.toBe(value.amounts);
    expect(Object.isFrozen(first.amounts)).toBe(true);
    expect(Object.isFrozen(first.tax)).toBe(true);
    expect(Object.isFrozen(first.socialInsurance)).toBe(true);
  });
});
