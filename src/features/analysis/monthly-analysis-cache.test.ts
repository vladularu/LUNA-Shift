import { describe, expect, it, vi } from "vitest";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import {
  calculateMonthlyAnalysis,
  calculateMonthlyAnalysisSteps,
  getCachedMonthlyAnalysis,
  type MonthlyAnalysisRequest,
} from "./monthly-analysis";

vi.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (calculate: () => unknown) => ({ ok: true, value: calculate() }),
}));

function request(): MonthlyAnalysisRequest {
  return {
    month: "2026-09",
    profile: { ...forecastProfile },
    entries: [
      forecastShift({ id: "september", date: "2026-09-03" }),
      forecastShift({ id: "august", date: "2026-08-03" }),
    ],
    tariffDecisions: [],
    workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    ruleResolver: { ...bundledRuleResolver },
  };
}
function calculate(r: MonthlyAnalysisRequest) {
  return calculateMonthlyAnalysis(
    r.month,
    r.entries,
    r.profile,
    r.tariffDecisions,
    r.workPatternSettings,
    r.ruleResolver,
  );
}

describe("prepared monthly analysis", () => {
  it("returns the same complete snapshot for remounts and freshly loaded identical objects", () => {
    const r = request();
    expect(getCachedMonthlyAnalysis(r)).toBeNull();
    const first = calculate(r);
    const clone = JSON.parse(JSON.stringify(r));
    clone.ruleResolver = r.ruleResolver;
    expect(getCachedMonthlyAnalysis(clone)).toBe(first);
    expect(calculate(clone)).toBe(first);
    expect(Object.isFrozen(r.entries[0])).toBe(false);
    expect(Object.isFrozen(first.monthShifts[0])).toBe(true);
  });

  it("invalidates changed entries even without revision changes, while protecting old results", () => {
    const r = request();
    const first = calculate(r);
    Object.assign(r.entries[0], { endTime: "22:00" });
    expect(getCachedMonthlyAnalysis(r)).toBeNull();
    const second = calculate(r);
    expect(second.summary).not.toEqual(first.summary);
    const original = request();
    expect(getCachedMonthlyAnalysis({ ...original, ruleResolver: r.ruleResolver })).toBe(first);
  });

  it("includes surrounding legal/tariff windows, profile, decisions, patterns and resolver", () => {
    const r = request();
    calculate(r);
    for (const changed of [
      { ...r, month: "2026-10" },
      { ...r, entries: r.entries.map((e) => (e.id === "august" ? { ...e, endTime: "23:00" } : e)) },
      { ...r, profile: { ...r.profile, weeklyMinutes: 2000 } },
      {
        ...r,
        workPatternSettings: { ...DEFAULT_TVOED_WORK_PATTERN_SETTINGS, updatedAt: "2026-10-28" },
      },
      { ...r, ruleResolver: { ...bundledRuleResolver } },
    ])
      expect(getCachedMonthlyAnalysis(changed)).toBeNull();
    const unrelated = forecastShift({ id: "archived", date: "2020-01-01" });
    expect(getCachedMonthlyAnalysis({ ...r, entries: [...r.entries, unrelated] })).toBe(
      calculate(r),
    );
  });

  it("publishes no partial result and preserves the synchronous result across all phases", () => {
    const r = request();
    const steps = calculateMonthlyAnalysisSteps(r);
    expect(steps.next()).toEqual({ done: false, value: 0 });
    expect(getCachedMonthlyAnalysis(r)).toBeNull();
    let phaseCount = 1;
    while (true) {
      const next = steps.next();
      if (next.done) {
        expect(next.value).toEqual(calculate({ ...r, ruleResolver: { ...bundledRuleResolver } }));
        break;
      }
      phaseCount++;
    }
    expect(phaseCount).toBeGreaterThan(1);
    expect(getCachedMonthlyAnalysis(r)).not.toBeNull();
  });

  it("retries unavailable salary results instead of retaining them", () => {
    const r = request();
    const manual = { ...r, profile: { ...r.profile, tariff: null } };
    calculate(manual);
    expect(getCachedMonthlyAnalysis(manual)).toBeNull();
  });
});
