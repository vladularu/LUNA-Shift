import { describe, expect, it } from "vitest";

import { settings } from "./net-pay-profile-test-fixtures";
import { isNetPayProfileValid, validateMonthlyNetPaySettings } from "./net-pay-profile";
import { calculateMonthlyNetPay } from "@/engine/net-pay";

describe("monthly net-pay settings", () => {
  it("returns a complete independent immutable monthly snapshot", () => {
    const original = settings();
    const parsed = validateMonthlyNetPaySettings(original);
    expect(parsed).toEqual(original);
    expect(parsed.profile).not.toBe(original.profile);
    expect(parsed.specialCases).not.toBe(original.specialCases);
    expect([parsed, parsed.profile, parsed.specialCases].every(Object.isFrozen)).toBe(true);
  });
  it("stores a future year without claiming calculation support", () => {
    const parsed = validateMonthlyNetPaySettings(settings("2027-01"));
    expect(
      calculateMonthlyNetPay({
        month: parsed.month,
        profile: parsed.profile,
        specialCases: parsed.specialCases,
        amounts: {
          grossCents: 500_000,
          taxableGrossCents: 500_000,
          socialInsuranceGrossCents: 500_000,
          regularMonthlySocialInsuranceGrossCents: 500_000,
        },
      }).status,
    ).toBe("unsupported");
  });
  it("preserves explicitly declared unsupported payroll cases", () => {
    expect(
      validateMonthlyNetPaySettings({
        ...settings(),
        specialCases: ["PRIVATE_INSURANCE", "ADDITIONAL_DEDUCTIONS"],
      }).specialCases,
    ).toEqual(["PRIVATE_INSURANCE", "ADDITIONAL_DEDUCTIONS"]);
  });
  it.each(["2026-7", "2026-00", "2026-13", "1899-12", "4100-01", "2026-07-01", null])(
    "rejects invalid month %s",
    (month) => {
      expect(() => validateMonthlyNetPaySettings({ ...settings(), month })).toThrow();
    },
  );
  it.each([
    null,
    [],
    {},
    { ...settings(), version: 2 },
    { ...settings(), extra: true },
    { ...settings(), specialCases: undefined },
    { ...settings(), sfnBasicHourlyPayCents: undefined },
    { ...settings(), specialCases: ["UNKNOWN"] },
    { ...settings(), specialCases: ["MINIJOB", "MINIJOB"] },
    { ...settings(), sfnBasicHourlyPayCents: 0 },
    { ...settings(), sfnBasicHourlyPayCents: 0.5 },
  ])("rejects missing or unknown settings %#", (value) => {
    expect(() => validateMonthlyNetPaySettings(value)).toThrow();
  });
  it.each([
    { birthDate: "2026-08-01" },
    { birthDate: "1990-02-30" },
    { birthDate: "1990-1-15" },
    { birthDate: undefined },
    { birthDate: "1899-12-31" },
    { taxClass: 0 },
    { taxClass: 7 },
    { factorPermille: 500 },
    { churchTaxRatePercent: 7 },
    { childrenUnder25: 1 },
    { isParent: undefined },
    { worksInSaxony: undefined },
    { healthAdditionalRateBps: -1 },
    { healthAdditionalRateBps: 269.5 },
    { monthlyTaxAllowanceCents: Number.NaN },
    { extra: true },
  ])("rejects invalid or incomplete profile %#", (patch) => {
    expect(() =>
      validateMonthlyNetPaySettings({
        ...settings(),
        profile: { ...settings().profile, ...patch },
      }),
    ).toThrow();
  });
  it("distinguishes PV children from child tax allowances and accepts an IV factor", () => {
    const parsed = validateMonthlyNetPaySettings({
      ...settings(),
      profile: {
        ...settings().profile,
        taxClass: 4,
        factorPermille: 875,
        isParent: true,
        childrenUnder25: 2,
        childAllowanceHalfUnits: 1,
      },
      sfnBasicHourlyPayCents: 4_000,
    });
    expect(parsed.profile).toMatchObject({
      factorPermille: 875,
      childrenUnder25: 2,
      childAllowanceHalfUnits: 1,
    });
    expect(parsed.sfnBasicHourlyPayCents).toBe(4_000);
  });
  it("does not consider a missing birth date a valid computation profile", () => {
    const { birthDate: _, ...withoutBirthDate } = settings().profile;
    expect(isNetPayProfileValid(withoutBirthDate)).toBe(false);
  });
});
