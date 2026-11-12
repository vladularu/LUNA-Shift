import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuleResolver } from "@/rules/rule-resolver";
import type { PersistentAnalysisCache } from "@/features/analysis/persistent-analysis-cache";
import { annualInputKey } from "@/features/analysis/annual-core-report";
import {
  calendarPerformance,
  createCalendarPerformanceRecorder,
} from "@/application/calendar-performance";
import { observeAnnualCacheRead, observeAnnualMonthCache } from "./analysis-cache-diagnostics";

const resolver = {} as RuleResolver;
const accept = (_value: unknown): _value is object => true;
const profile = { privateName: "do-not-export", weeklyMinutes: 2340 };
const oldParts = () => ({
  summary: { key: annualInputKey([[], profile]), value: { total: 1 } },
  shiftTypeAnalysis: { key: annualInputKey([[], profile]), value: null },
  compliance: { key: annualInputKey([[], profile, "2026-11-12", false]), value: null },
  pay: { key: annualInputKey([[], [], profile, null, {}]), value: null },
});
function fixture(value: object = oldParts()) {
  const recorder = createCalendarPerformanceRecorder(() => 0);
  const claim = vi.fn(() => () => true);
  const read = vi.fn(async () => value);
  const write = vi.fn(async () => {});
  const cache = { claim, read, write } as unknown as PersistentAnalysisCache;
  return { recorder, claim, read, write, cache: observeAnnualMonthCache(cache, recorder) };
}
afterEach(() => calendarPerformance.clear());

describe("session-scoped annual-month key observation", () => {
  it("preserves results and writer claims while exporting only numeric differences", async () => {
    const value = oldParts(),
      f = fixture(value);
    f.recorder.start(true);
    expect(await f.cache.read("annual-month", "2026-01", "key", resolver, accept)).toBe(value);
    const current = f.cache.claim!("annual-month", "2026-01");
    const next = {
      ...value,
      compliance: { key: annualInputKey([[], profile, "2026-11-13", false]), value: null },
    };
    await f.cache.write("annual-month", "2026-01", "key", resolver, next, accept, current);
    expect(f.write).toHaveBeenCalledWith(
      "annual-month",
      "2026-01",
      "key",
      resolver,
      next,
      accept,
      current,
    );
    expect(f.claim).toHaveBeenCalledWith("annual-month", "2026-01");
    expect(f.recorder.report().events.at(-1)?.values).toEqual({
      month: 202601,
      stage: 5,
      input: 15,
      valid: 15,
      cache: 11,
      state: 4,
      reason: 4,
    });
    expect(JSON.stringify(f.recorder.report())).not.toContain("do-not-export");
    expect(value).toEqual(oldParts());
  });
  it("keeps immutable old keys even when the restored object is mutated in place", async () => {
    const value = oldParts(),
      f = fixture(value);
    f.recorder.start(true);
    await f.cache.read("annual-month", "2026-01", "key", resolver, accept);
    const changedProfile = { ...profile, weeklyMinutes: 2000 };
    value.summary.key = annualInputKey([[], changedProfile]);
    value.compliance.key = annualInputKey([
      [{ id: "private-shift" }],
      changedProfile,
      "2026-11-12",
      true,
    ]);
    await f.cache.write("annual-month", "2026-01", "key", resolver, value, accept);
    expect(f.recorder.report().events.at(-1)?.values).toMatchObject({
      state: 5,
      reason: 11,
      cache: 10,
    });
  });
  it("clears baselines across recordings and ignores reads completing in a later session", async () => {
    const f = fixture();
    f.recorder.start(true);
    await f.cache.read("annual-month", "2026-01", "key", resolver, accept);
    f.recorder.start(true);
    await f.cache.write("annual-month", "2026-01", "key", resolver, oldParts(), accept);
    expect(f.recorder.report().events.at(-1)?.values.input).toBe(0);
    let done!: (value: object) => void;
    f.read.mockImplementationOnce(
      () =>
        new Promise<object>((resolve) => {
          done = resolve;
        }),
    );
    const pending = f.cache.read("annual-month", "2026-02", "key", resolver, accept);
    f.recorder.start(true);
    done(oldParts());
    await pending;
    await f.cache.write("annual-month", "2026-02", "key", resolver, oldParts(), accept);
    expect(f.recorder.report().events.at(-1)?.values.input).toBe(0);
  });
  it("bounds retained months and key characters without changing cache reads", async () => {
    const f = fixture();
    f.recorder.start(true);
    for (let i = 0; i < 37; i++)
      await f.cache.read("annual-month", `month-${i}`, "key", resolver, accept);
    await f.cache.write("annual-month", "month-0", "key", resolver, oldParts(), accept);
    expect(f.recorder.report().events.at(-1)?.values.input).toBe(0);
    const large = { summary: { key: "x".repeat(600000) } };
    f.read.mockResolvedValue(large);
    await f.cache.read("annual-month", "2026-01", "key", resolver, accept);
    await f.cache.read("annual-month", "2026-02", "key", resolver, accept);
    await f.cache.write("annual-month", "2026-01", "key", resolver, large, accept);
    expect(f.recorder.report().events.at(-1)?.values.input).toBe(0);
  });
  it("treats unknown key formats and changed resolver owners explicitly", async () => {
    const f = fixture({ summary: { key: "old-unknown-format" } });
    f.recorder.start(true);
    await f.cache.read("annual-month", "2026-01", "key", resolver, accept);
    await f.cache.write("annual-month", "2026-01", "key", resolver, oldParts(), accept);
    expect(f.recorder.report().events.at(-1)?.values).toMatchObject({ state: 1, reason: 128 });
    await f.cache.write("annual-month", "2026-01", "key", {} as RuleResolver, oldParts(), accept);
    expect(f.recorder.report().events.at(-1)?.values.input).toBe(0);
  });
  it("stays inactive outside recordings and preserves failures from the real cache", async () => {
    const f = fixture();
    await f.cache.read("annual-month", "2026-01", "key", resolver, accept);
    await f.cache.write("annual-month", "2026-01", "key", resolver, oldParts(), accept);
    expect(f.recorder.report().events).toHaveLength(0);
    const failure = new Error("underlying cache failure");
    f.read.mockRejectedValueOnce(failure);
    await expect(f.cache.read("annual-month", "2026-01", "key", resolver, accept)).rejects.toBe(
      failure,
    );
  });
  it("isolates optional observers from valid persistence", async () => {
    const f = fixture();
    f.recorder.start(true);
    await f.cache.read("annual-month", "2026-01", "key", resolver, accept);
    vi.spyOn(f.recorder, "capture").mockImplementation(() => {
      throw new Error("diagnostic failure");
    });
    await f.cache.write("annual-month", "2026-01", "key", resolver, oldParts(), accept);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
});

it("binds annual row events to the recording where their read began", () => {
  expect(observeAnnualCacheRead("2026-01")).toBeNull();
  calendarPerformance.start(true);
  const record = observeAnnualCacheRead("2026-01")!;
  calendarPerformance.start(true);
  record({ state: 3, valid: 0, epoch: 1 });
  expect(calendarPerformance.report().events).toHaveLength(0);
});
