import { describe, expect, it } from "vitest";
import type { SfnPayrollInput, SfnPremiumCategory, SfnPremiumPayment } from "@/domain/net-pay-sfn";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { classifySfnPayroll2026 } from "./net-pay-sfn";
import { NetPayPremiumTrace, premiumCategory } from "./net-pay-premium-trace";

function classify(payments: readonly SfnPremiumPayment[], basicHourlyPayCents = 2000) {
  const input: SfnPayrollInput = {
    month: "2026-07",
    completeGross: true,
    grossCents: 500000,
    regularMonthlySocialInsuranceGrossCents: 400000,
    basicHourlyPayCents,
    workplace: { federalState: "NW", holidayRegion: "NONE" },
    workEvidence: "PLANNED",
    shifts: [
      {
        id: "mixed",
        start: "2026-07-05T20:00+02:00",
        end: "2026-07-05T21:00+02:00",
        unpaidBreaks: [],
        payments,
      },
    ],
  };
  const result = classifySfnPayroll2026(input, bundledRuleResolver);
  if (result.status !== "available") throw new Error(result.reason);
  const rows = result.shifts[0].premiumBreakdown;
  expect(rows.reduce((sum, row) => sum + row.paidPremiumCents, 0)).toBe(result.paidPremiumCents);
  expect(rows.reduce((sum, row) => sum + row.taxFreeCents, 0)).toBe(result.taxFreeCents);
  expect(rows.reduce((sum, row) => sum + row.taxablePremiumCents, 0)).toBe(
    result.paidPremiumCents - result.taxFreeCents,
  );
  for (const row of rows) expect(row.taxFreeCents).toBeLessThanOrEqual(row.paidPremiumCents);
  return result;
}
function payment(
  id: string,
  kind: SfnPremiumPayment["kind"],
  category: SfnPremiumCategory,
  amountCents: number,
): SfnPremiumPayment {
  return {
    id,
    kind,
    category,
    amountCents,
    additionalToBasicPay: true,
    periods: [{ start: "2026-07-05T20:00+02:00", end: "2026-07-05T21:00+02:00" }],
  };
}

describe("SFN category breakdown without changing payroll totals", () => {
  it("separates simultaneous night, Sunday and taxable Saturday payments", () => {
    const result = classify([
      payment("night", "NIGHT", "NIGHT", 700),
      payment("sunday", "DAY", "SUNDAY", 1200),
      payment("saturday", "OTHER", "SATURDAY", 300),
    ]);
    expect(result.taxFreeCents).toBe(1500);
    expect(result.shifts[0].premiumBreakdown).toEqual([
      { category: "NIGHT", paidPremiumCents: 700, taxFreeCents: 500, taxablePremiumCents: 200 },
      { category: "SATURDAY", paidPremiumCents: 300, taxFreeCents: 0, taxablePremiumCents: 300 },
      { category: "SUNDAY", paidPremiumCents: 1200, taxFreeCents: 1000, taxablePremiumCents: 200 },
    ]);
  });
  it("shares a capped day exemption cent-exactly across overlapping payments", () => {
    const result = classify([
      payment("a", "DAY", "SUNDAY", 1000),
      payment("b", "DAY", "HOLIDAY", 2000),
    ]);
    expect(result.taxFreeCents).toBe(1000);
    expect(result.shifts[0].premiumBreakdown.map((row) => row.taxFreeCents)).toEqual([667, 333]);
  });
  it("keeps all original totals when category annotations are removed", () => {
    const payments = [
      payment("a", "NIGHT", "NIGHT", 1357),
      payment("b", "DAY", "SUNDAY", 1789),
      payment("c", "OTHER", "SATURDAY", 297),
    ];
    const labeled = classify(payments, 6001);
    const legacy = classify(
      payments.map(({ category: _category, ...rest }) => rest),
      6001,
    );
    expect(labeled.amounts).toEqual(legacy.amounts);
    expect(labeled.socialInsuranceFreeCents).toBe(legacy.socialInsuranceFreeCents);
    expect(labeled.taxFreeCents).toBe(legacy.taxFreeCents);
  });
  it("does not make other payments tax-free through a misleading category", () => {
    const result = classify([payment("other", "OTHER", "HOLIDAY", 900)]);
    expect(result.taxFreeCents).toBe(0);
  });
  it("keeps paid night breaks in the night category while marking them taxable", () => {
    const trace = new NetPayPremiumTrace(
      "break",
      Date.parse("2026-07-05T20:00+02:00") / 60000,
      60,
      10,
      true,
    );
    for (let i = 0; i < 60; i++)
      trace.add("night", Date.parse("2026-07-05T20:00+02:00") / 60000 + i);
    trace.pay("night", "NIGHT", 600, "NIGHT");
    const result = classify(trace.finish().payments);
    expect(result.shifts[0].premiumBreakdown).toEqual([
      { category: "NIGHT", paidPremiumCents: 600, taxFreeCents: 416, taxablePremiumCents: 184 },
    ]);
  });
  it.each([
    ["night", "NIGHT"],
    ["NIGHT", "NIGHT"],
    ["sunday", "SUNDAY"],
    ["SUNDAY", "SUNDAY"],
    ["HOLIDAY_WITH_TIME_OFF", "HOLIDAY"],
    ["HOLIDAY_WITHOUT_TIME_OFF", "HOLIDAY"],
    ["holiday", "HOLIDAY"],
    ["PRE_HOLIDAY", "HOLIDAY"],
    ["preholiday", "HOLIDAY"],
    ["SATURDAY", "SATURDAY"],
    ["saturday", "SATURDAY"],
    ["OVERTIME", "OTHER"],
  ])("carries tariff type %s into category %s", (key, category) => {
    expect(premiumCategory(key)).toBe(category);
  });
});
