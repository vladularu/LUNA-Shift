import { describe, expect, it } from "vitest";
import { annualRustMonthTotals } from "./annual-rust-month-totals";

const months = () =>
  Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, "0")}`,
    available: true,
    estimatedGrossAmount: 4000.01,
    timePremiumAmount: 0.1,
    overtimeAmount: 2.25,
    allowanceAmount: 3.5,
    tvoedAllowanceAmount: 4.75,
    careAllowanceAmount: 5,
  }));
describe("temporary annual sums from completed Rust months", () => {
  it("preserves original annual money fields, separate premium categories and month ordering", () => {
    const value = annualRustMonthTotals(2026, "TARIFF", months());
    expect(value).toMatchObject({
      estimatedGrossAmount: 48000.12,
      premiumAmount: 1.2,
      overtimeAmount: 27,
      allowanceAmount: 159,
      availablePayMonthCount: 12,
    });
    expect(value.months.map((row) => row.month)).toEqual(months().map((row) => row.month));
    expect(value.months[0].premiumAmount).toBe(0.1 + 2.25 + 3.5 + 4.75 + 5);
    expect(value.months[0].timePremiumAmount).toBe(0.1);
  });
  it("preserves unavailable months and the original manual-salary time-premium policy", () => {
    const input: unknown[] = months();
    input[2] = { month: "2026-03", available: false };
    const value = annualRustMonthTotals(2026, "MANUAL", input);
    expect(value.availablePayMonthCount).toBe(11);
    expect(value.months[2]).toEqual({
      month: "2026-03",
      timePremiumAmount: null,
      estimatedGrossAmount: null,
      premiumAmount: 0,
    });
    expect(value.months[0].timePremiumAmount).toBeNull();
  });
  it.each(["missing", "wrong month", "invalid amount"])(
    "rejects %s instead of showing an incomplete total",
    (failure) => {
      const input = months();
      if (failure === "missing") input.pop();
      if (failure === "wrong month") input[0].month = "2027-01";
      if (failure === "invalid amount") input[0].estimatedGrossAmount = Infinity;
      expect(() => annualRustMonthTotals(2026, "TARIFF", input)).toThrow();
    },
  );
});
