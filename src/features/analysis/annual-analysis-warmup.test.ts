import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { createRuleResolver } from "@/rules/rule-resolver";
import {
  createAnnualAnalysisWarmupRuntime,
  type AnnualPreparationInput,
} from "./annual-analysis-warmup";
const mock = vi.hoisted(() => ({
  keys: [] as string[],
  cancelled: [] as boolean[],
  failures: [] as ((error: unknown) => void)[],
}));
vi.mock("./annual-analysis", () => ({
  annualAnalysisKey: (input: unknown) => JSON.stringify(input),
  requestAnnualAnalysis: (
    _request: unknown,
    key: string,
    _persistent: unknown,
    _priority: number,
    _complete: unknown,
    fail: (error: unknown) => void,
  ) => {
    const index = mock.keys.length;
    mock.keys.push(key);
    mock.cancelled.push(false);
    mock.failures.push(fail);
    return {
      cancel: () => {
        mock.cancelled[index] = true;
      },
      setPriority: () => {},
    };
  },
}));
let runtime: ReturnType<typeof createAnnualAnalysisWarmupRuntime>;
const input = (): AnnualPreparationInput => ({
  years: [2026],
  entries: [forecastShift()],
  profile: forecastProfile,
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  referenceDate: "2026-10-28",
  youthProtection: false,
  ruleResolver: createRuleResolver(),
  testMonths: [],
});
beforeEach(() => {
  vi.useFakeTimers();
  mock.keys = [];
  mock.cancelled = [];
  mock.failures = [];
  runtime = createAnnualAnalysisWarmupRuntime(null);
});
afterEach(() => {
  runtime.stop();
  vi.useRealTimers();
});
describe("annual preparation reconciliation", () => {
  it("retains identical in-flight work but replaces it for an exact-content edit", async () => {
    const first = input();
    runtime.prepare(first);
    await vi.runAllTimersAsync();
    runtime.prepare({ ...first, entries: JSON.parse(JSON.stringify(first.entries)) });
    await vi.runAllTimersAsync();
    expect(mock.keys).toHaveLength(1);
    expect(mock.cancelled).toEqual([false]);
    runtime.prepare({ ...first, entries: [{ ...first.entries[0]!, endTime: "08:00" }] });
    await vi.runAllTimersAsync();
    expect(mock.keys).toHaveLength(2);
    expect(mock.cancelled).toEqual([true, false]);
  });
  it("debounces successive changes and does not start test-data or unknown-youth work", async () => {
    const first = input();
    runtime.prepare(first);
    runtime.prepare({ ...first, profile: { ...first.profile, weeklyMinutes: 1800 } });
    await vi.runAllTimersAsync();
    expect(mock.keys).toHaveLength(1);
    expect(mock.keys[0]).toContain("1800");
    runtime.prepare({ ...first, youthProtection: null });
    await vi.runAllTimersAsync();
    expect(mock.cancelled).toEqual([true]);
    expect(mock.keys).toHaveLength(1);
    runtime.prepare({ ...first, testMonths: ["2026-10"] });
    await vi.runAllTimersAsync();
    expect(mock.keys).toHaveLength(1);
  });
  it("retries a failed lease and bounds requested years, then stops all remaining work", async () => {
    const first = input();
    runtime.prepare(first);
    await vi.runAllTimersAsync();
    mock.failures[0]!(new Error("background failure"));
    runtime.prepare(first);
    await vi.runAllTimersAsync();
    expect(mock.keys).toHaveLength(2);
    runtime.prepare({ ...first, years: [2026, 2027, 2028, 2029, 2026] });
    await vi.runAllTimersAsync();
    expect(mock.keys).toHaveLength(4);
    runtime.stop();
    expect(mock.cancelled.every(Boolean)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
