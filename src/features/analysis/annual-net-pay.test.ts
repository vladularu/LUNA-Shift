import { describe, expect, it } from "vitest";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { resolveNetPaySettings } from "@/domain/net-pay-profile";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES, setSalaryPaymentLag } from "@/domain/salary-payment";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { prepareAutomaticNetPay } from "@/features/salary/automatic-net-pay-preparation";
import {
  annualNetPaySteps,
  annualNetPayMonth,
  summarizeAnnualNetPay,
  type AnnualNetPayRequest,
} from "./annual-net-pay";

function input(): AnnualNetPayRequest {
  return {
    year: 2026,
    profile: forecastProfile,
    timeline: [
      {
        settings: automatedSettings("2026-07"),
        revision: 1,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ],
    preferences: DEFAULT_SALARY_PAYMENT_PREFERENCES,
    context: {
      entries: [forecastShift()],
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      resolver: bundledRuleResolver,
      testMonths: [],
    },
  };
}
function finish(request: AnnualNetPayRequest) {
  const steps = annualNetPaySteps(request);
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
describe("annual net pay from existing monthly payout forecasts", () => {
  it.each([0, 1, 2] as const)("matches every monthly forecast with payment delay %s", (lag) => {
    const request = {
      ...input(),
      preferences: setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2026-01", lag),
    };
    const annual = finish(request);
    expect(annual.months).toHaveLength(12);
    expect(annual.months.slice(0, 6).every((month) => month.netCents === null)).toBe(true);
    let total = 0,
      count = 0;
    for (const month of annual.months.slice(6)) {
      const settings = resolveNetPaySettings(month.month, request.timeline)!.settings;
      const forecast = prepareAutomaticNetPay(
        month.month,
        settings,
        request.profile,
        request.context,
        {
          preferences: request.preferences,
          perspective: "PAYOUT",
          sourceSettings: request.timeline,
        },
      );
      expect(month).toEqual(annualNetPayMonth(month.month, forecast));
      if (forecast.result.status === "available") {
        total += forecast.result.pay.netCents;
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
    expect(annual.netCents).toBe(total);
    expect(annual.availableMonthCount).toBe(count);
  });
  it("excludes individual test months and never substitutes missing months with zero", () => {
    const request = input();
    const annual = finish({ ...request, context: { ...request.context, testMonths: ["2026-08"] } });
    expect(annual.months[7]).toMatchObject({ netCents: null, status: "Im Testmonat gesperrt" });
    expect(annual.months[0]).toMatchObject({ netCents: null, status: "Noch nicht eingerichtet" });
    expect(annual.availableMonthCount).toBeLessThan(6);
    expect(finish({ ...request, timeline: [] }).netCents).toBeNull();
  });
  it("includes genuine zero and propagates partial basis notes without duplicating them", () => {
    const row = {
      month: "2026-01",
      netCents: 0,
      status: null,
      notes: ["Zusatzversorgung nicht berücksichtigt"],
      preliminary: true,
    };
    const result = summarizeAnnualNetPay(2026, [
      row,
      { ...row, month: "2026-02", netCents: 12345 },
      { ...row, month: "2026-03", netCents: null },
    ]);
    expect(result).toMatchObject({
      netCents: 12345,
      availableMonthCount: 2,
      preliminary: true,
      notes: row.notes,
    });
  });
  it("uses the settings effective in each month, not December settings for the whole year", () => {
    const request = input();
    const original = automatedSettings("2026-10");
    const changed = { ...original, profile: { ...original.profile, taxClass: 3 as const } };
    const timeline = [...request.timeline, { ...request.timeline[0], settings: changed }];
    const before = finish(request),
      after = finish({ ...request, timeline });
    expect(after.months.slice(0, 9)).toEqual(before.months.slice(0, 9));
    expect(after.months[9].netCents).not.toEqual(before.months[9].netCents);
  });
});
