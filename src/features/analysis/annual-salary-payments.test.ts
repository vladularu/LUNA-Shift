import { describe, expect, it } from "vitest";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { buildAnnualCoreReport } from "./annual-core-report";
import { withAnnualSalaryPayments } from "./annual-salary-payments";

function report() {
  const core = buildAnnualCoreReport(2026, [], forecastProfile);
  return {
    ...core,
    availablePayMonthCount: 12,
    estimatedGrossAmount: 48_000,
    months: core.months.map((m) => ({ ...m, estimatedGrossAmount: 4_000 })),
  };
}
function timeline() {
  const initial = automatedSettings("2026-10");
  return [
    {
      settings: {
        ...initial,
        automation: {
          ...initial.automation!,
          annualPayments: [
            { revision: 1, payoutMonth: "2026-07", grossCents: 150_000, netBasis: null },
            { revision: 1, payoutMonth: "2026-11", grossCents: 360_000, netBasis: null },
            { revision: 1, payoutMonth: "2027-06", grossCents: 200_000, netBasis: null },
          ],
        },
      },
      revision: 1,
      createdAt: "2026-10-18T10:00:00Z",
      updatedAt: "2026-10-18T10:00:00Z",
    },
  ];
}
describe("annual gross including confirmed cash payments", () => {
  it("counts the right year and month, including payments before net setup", () => {
    const base = report();
    const actual = withAnnualSalaryPayments(base, timeline());
    expect(actual.estimatedGrossAmount).toBe(53_100);
    expect(actual.months.find((m) => m.month === "2026-07")?.estimatedGrossAmount).toBe(5_500);
    expect(actual.months.find((m) => m.month === "2026-11")?.estimatedGrossAmount).toBe(7_600);
    expect(base.estimatedGrossAmount).toBe(48_000);
    expect(withAnnualSalaryPayments(actual, timeline())).toBe(actual);
  });
  it("does not invent complete gross for an unavailable base month", () => {
    const base = report();
    const actual = withAnnualSalaryPayments(
      {
        ...base,
        months: base.months.map((m) =>
          m.month === "2026-11" ? { ...m, estimatedGrossAmount: null } : m,
        ),
      },
      timeline(),
    );
    expect(actual.months.find((m) => m.month === "2026-11")?.estimatedGrossAmount).toBeNull();
    expect(actual.annualPaymentAmount).toBe(1_500);
  });
});
