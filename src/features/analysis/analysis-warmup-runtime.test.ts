import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forecastProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { createRuleResolver } from "@/rules/rule-resolver";
import { createAnalysisWarmupRuntime, type AnalysisWarmupInput } from "./analysis-warmup-runtime";

const mock = vi.hoisted(() => ({
  month: 0,
  salary: 0,
  checks: 0,
  blockMonth: true,
  blockSalary: true,
}));
vi.mock("./monthly-analysis", () => ({
  inspectMonthlyAnalysis: (input: AnalysisWarmupInput & { month: string }) => ({
    key: JSON.stringify([input.month, input.profile, input.entries]),
    cached: null,
  }),
  retainPreparedMonthlyAnalysis: (_request: unknown, _key: string, result: unknown) => result,
  calculateMonthlyAnalysisSteps: function* () {
    mock.month++;
    while (mock.blockMonth) yield 0;
    return { complianceShifts: { ok: true, value: [] } };
  },
}));
vi.mock("./analysis-salary", () => ({
  analysisSalaryKey: (input: unknown) => JSON.stringify(input),
  readAnalysisSalary: () => null,
  retainPreparedAnalysisSalary: (_request: unknown, _key: string, result: unknown) => result,
  prepareAnalysisSalarySteps: function* () {
    mock.salary++;
    while (mock.blockSalary) yield 0;
    return { annual: { proposal: null, payments: [], automatic: false }, forecast: null };
  },
}));
vi.mock("@/engine/compliance", () => ({
  calculateMonthlyComplianceSteps: function* () {
    mock.checks++;
    yield 0;
    return {
      month: "2026-10",
      issues: [],
      affectedDates: [],
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
    };
  },
}));
const runtimes: ReturnType<typeof createAnalysisWarmupRuntime>[] = [];
const fresh = (): AnalysisWarmupInput => ({
  months: ["2026-10"],
  profile: forecastProfile,
  savedProfile: forecastProfile,
  entries: [],
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  testMonths: [],
  resolver: createRuleResolver(),
  timeline: [],
  annualPayments: [],
  referenceDate: "2026-10-28",
  youthProtection: false,
});
const runtime = () => {
  const value = createAnalysisWarmupRuntime(null);
  runtimes.push(value);
  return value;
};
beforeEach(() => {
  Object.assign(mock, { month: 0, salary: 0, checks: 0, blockMonth: true, blockSalary: true });
  vi.useFakeTimers();
  vi.stubGlobal(
    "requestIdleCallback",
    (work: (budget: { didTimeout: boolean; timeRemaining(): number }) => void) =>
      setTimeout(() => work({ didTimeout: false, timeRemaining: () => 10 }), 16),
  );
  vi.stubGlobal("cancelIdleCallback", clearTimeout);
});
afterEach(() => {
  runtimes.splice(0).forEach((value) => value.stop());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("reconciled background stages", () => {
  it("retains in-flight generators and their progress for equivalent new input objects", () => {
    const input = fresh(),
      value = runtime();
    value.prepare(input);
    vi.advanceTimersByTime(50);
    expect([mock.month, mock.salary]).toEqual([1, 1]);
    value.prepare({ ...input, profile: { ...input.profile }, entries: [...input.entries] });
    vi.advanceTimersByTime(200);
    expect([mock.month, mock.salary]).toEqual([1, 1]);
  });
  it("replaces genuinely changed requests", () => {
    const input = fresh(),
      value = runtime();
    value.prepare(input);
    vi.advanceTimersByTime(50);
    const profile = { ...input.profile, weeklyMinutes: 1800 };
    value.prepare({ ...input, profile, savedProfile: profile });
    vi.advanceTimersByTime(200);
    expect([mock.month, mock.salary]).toEqual([2, 2]);
  });
  it("prepares month and checks before net inputs, then attaches only the missing salary stage", () => {
    mock.blockMonth = false;
    const input = fresh(),
      value = runtime();
    value.prepare({ ...input, timeline: null, annualPayments: null });
    vi.advanceTimersByTime(100);
    expect([mock.month, mock.checks, mock.salary]).toEqual([1, 1, 0]);
    value.prepare(input);
    vi.advanceTimersByTime(200);
    expect([mock.month, mock.checks, mock.salary]).toEqual([1, 1, 1]);
  });
  it("does not hold month preparation behind unloaded check preferences", () => {
    mock.blockMonth = false;
    const input = fresh(),
      value = runtime();
    value.prepare({ ...input, youthProtection: null });
    vi.advanceTimersByTime(100);
    expect([mock.month, mock.checks]).toEqual([1, 0]);
    value.prepare(input);
    vi.advanceTimersByTime(200);
    expect([mock.month, mock.checks]).toEqual([1, 1]);
  });
  it("stops all speculative work when inactive and limits preparation to three unique months", () => {
    mock.blockMonth = false;
    mock.blockSalary = false;
    const input = fresh(),
      value = runtime();
    value.prepare({ ...input, months: ["2026-10", "2026-10", "2026-11", "2026-12", "2027-01"] });
    vi.advanceTimersByTime(1000);
    expect(mock.month).toBe(3);
    value.stop();
    const before = [mock.month, mock.salary, mock.checks];
    vi.advanceTimersByTime(1000);
    expect([mock.month, mock.salary, mock.checks]).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
