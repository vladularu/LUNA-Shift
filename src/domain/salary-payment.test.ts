import { describe, expect, it } from "vitest";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  SUGGESTED_TVOED_PAYMENT_DELAYS,
  SalaryPaymentValidationError,
  addSalaryPaymentMonths,
  resolveSalaryPaymentPeriod,
  salaryComponentPaymentMonth,
  salaryPaymentSources,
  setSalaryPaymentEmptyMonth,
  setSalaryPaymentPeriod,
  setSalaryPaymentLag,
  validateSalaryPaymentPreferences,
  type SalaryPaymentDelays,
  type SalaryPaymentLag,
} from "./salary-payment";

function rules(lag: SalaryPaymentLag): SalaryPaymentDelays {
  return {
    PREMIUMS: lag,
    MONTHLY_ALLOWANCE: lag,
    HOURLY_ALLOWANCE: lag,
    OVERTIME: lag,
    SPECIAL_DUTY: lag,
  };
}
const policy = (lag: SalaryPaymentLag) =>
  setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
    effectiveMonth: "2025-01",
    delays: rules(lag),
  });

describe("salary claim and payment months", () => {
  it("preserves the existing same-month view before a timing setting is saved", () => {
    expect(
      salaryComponentPaymentMonth(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2026-10", "PREMIUMS"),
    ).toBe("2026-10");
    expect(salaryPaymentSources(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2026-10", "PREMIUMS")).toEqual(
      { months: ["2026-10"], unresolvedMonths: [] },
    );
  });

  it("keeps an explicitly unknown imported period unresolved", () => {
    const preferences = policy(null);
    expect(salaryComponentPaymentMonth(preferences, "2026-10", "PREMIUMS")).toBeNull();
    expect(salaryPaymentSources(preferences, "2026-10", "PREMIUMS")).toEqual({
      months: [],
      unresolvedMonths: ["2026-08", "2026-09", "2026-10"],
    });
  });

  it.each([0, 1, 2] as const)(
    "applies the single %i-month choice to every group from the displayed payout",
    (lag) => {
      const preferences = setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2027-01", lag);
      expect(preferences.periods).toEqual([{ effectiveMonth: "2026-11", delays: rules(lag) }]);
      for (const group of Object.keys(rules(lag)) as (keyof SalaryPaymentDelays)[])
        expect(salaryPaymentSources(preferences, "2027-01", group).months).toEqual([
          addSalaryPaymentMonths("2027-01", -lag),
        ]);
      expect(DEFAULT_SALARY_PAYMENT_PREFERENCES.periods).toEqual([]);
    },
  );

  it("replaces later timing rules while preserving earlier rules and other user data", () => {
    const old = setSalaryPaymentPeriod(policy(1), { effectiveMonth: "2027-02", delays: rules(0) });
    const original = {
      ...setSalaryPaymentEmptyMonth(old, "2026-07", true),
      socialInsuranceAttribution: "CASH_VARIABLE" as const,
    };
    const result = setSalaryPaymentLag(original, "2027-01", 2);
    expect(result.periods).toEqual([
      original.periods[0],
      { effectiveMonth: "2026-11", delays: rules(2) },
    ]);
    expect(result.reviewedEmptyMonths).toEqual(["2026-07"]);
    expect(result.socialInsuranceAttribution).toBe("CASH_VARIABLE");
    expect(original.periods).toHaveLength(2);
  });

  it.each([0, 1, 2] as const)("assigns a claim once with %i month(s) lag", (lag) => {
    const preferences = policy(lag);
    const cash = addSalaryPaymentMonths("2026-09", lag);
    expect(salaryComponentPaymentMonth(preferences, "2026-09", "PREMIUMS")).toBe(cash);
    expect(salaryPaymentSources(preferences, cash, "PREMIUMS")).toEqual({
      months: ["2026-09"],
      unresolvedMonths: [],
    });
  });

  it("keeps the original claim year across a December/January boundary", () => {
    expect(salaryPaymentSources(policy(2), "2027-01", "PREMIUMS").months).toEqual(["2026-11"]);
  });

  it("keeps conditional monthly allowance and actual service remuneration independent", () => {
    const preferences = setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
      effectiveMonth: "2026-01",
      delays: SUGGESTED_TVOED_PAYMENT_DELAYS,
    });
    expect(salaryPaymentSources(preferences, "2026-10", "PREMIUMS").months).toEqual(["2026-08"]);
    expect(salaryPaymentSources(preferences, "2026-10", "MONTHLY_ALLOWANCE").months).toEqual([
      "2026-10",
    ]);
    expect(salaryPaymentSources(preferences, "2026-10", "HOURLY_ALLOWANCE").months).toEqual([
      "2026-08",
    ]);
  });

  it("finds multiple source months at a rhythm transition instead of losing one", () => {
    const preferences = setSalaryPaymentPeriod(policy(2), {
      effectiveMonth: "2026-07",
      delays: rules(1),
    });
    expect(salaryPaymentSources(preferences, "2026-08", "PREMIUMS")).toEqual({
      months: ["2026-06", "2026-07"],
      unresolvedMonths: [],
    });
    expect(salaryComponentPaymentMonth(preferences, "2026-06", "PREMIUMS")).toBe("2026-08");
    expect(salaryComponentPaymentMonth(preferences, "2026-07", "PREMIUMS")).toBe("2026-08");
  });

  it("allows an empty payout interval at a longer-lag transition without inventing a source", () => {
    const preferences = setSalaryPaymentPeriod(policy(0), {
      effectiveMonth: "2026-07",
      delays: rules(2),
    });
    expect(salaryPaymentSources(preferences, "2026-07", "PREMIUMS")).toEqual({
      months: [],
      unresolvedMonths: [],
    });
  });

  it("applies rules only forward from their explicit effective claim month", () => {
    const preferences = setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
      effectiveMonth: "2026-10",
      delays: rules(2),
    });
    expect(resolveSalaryPaymentPeriod(preferences, "2026-09")).toBeNull();
    expect(salaryPaymentSources(preferences, "2026-10", "PREMIUMS")).toEqual({
      months: [],
      unresolvedMonths: [],
    });
  });

  it("requires an explicit, reversible confirmation of an empty month", () => {
    const reviewed = setSalaryPaymentEmptyMonth(policy(2), "2026-08", true);
    expect(reviewed.reviewedEmptyMonths).toEqual(["2026-08"]);
    expect(setSalaryPaymentEmptyMonth(reviewed, "2026-08", true)).toEqual(reviewed);
    expect(setSalaryPaymentEmptyMonth(reviewed, "2026-08", false).reviewedEmptyMonths).toEqual([]);
  });

  it("replaces only the selected dated period and canonicalizes its order", () => {
    const preferences = setSalaryPaymentPeriod(policy(2), {
      effectiveMonth: "2026-10",
      delays: rules(1),
    });
    const edited = setSalaryPaymentPeriod(preferences, {
      effectiveMonth: "2025-01",
      delays: rules(0),
    });
    expect(edited.periods.map((item) => item.effectiveMonth)).toEqual(["2025-01", "2026-10"]);
    expect(resolveSalaryPaymentPeriod(edited, "2026-11")?.delays.PREMIUMS).toBe(1);
    expect(resolveSalaryPaymentPeriod(preferences, "2026-09")?.delays.PREMIUMS).toBe(2);
  });

  it.each([
    null,
    { ...policy(1), version: 2 },
    { ...policy(1), surprise: true },
    { ...policy(1), periods: [...policy(1).periods, ...policy(1).periods] },
    { ...policy(1), reviewedEmptyMonths: ["2026-08", "2026-08"] },
    { ...policy(1), reviewedEmptyMonths: ["2026-13"] },
    { ...policy(1), periods: [{ effectiveMonth: "2026-1", delays: rules(1) }] },
    {
      ...policy(1),
      periods: [{ effectiveMonth: "2026-01", delays: { ...rules(1), PREMIUMS: "2" } }],
    },
    {
      ...policy(1),
      periods: [{ effectiveMonth: "2026-01", delays: { ...rules(1), PREMIUMS: 3 } }],
    },
    { ...policy(1), periods: [{ effectiveMonth: "2026-01", delays: { ...rules(1), EXTRA: 0 } }] },
  ])("rejects invalid stored or imported payment preferences", (value) => {
    expect(() => validateSalaryPaymentPreferences(value)).toThrow(SalaryPaymentValidationError);
  });
});
