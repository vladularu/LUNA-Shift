import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { readSharedAnalysisResult, requestSharedAnalysis } from "./shared-analysis-tasks";

const accept = (value: unknown): value is number => typeof value === "number" && value >= 0;
const base = () => ({
  kind: "month" as const,
  month: "2026-10",
  key: "unchanged-input",
  resolver: { ...bundledRuleResolver },
  persistent: null,
  priority: 10,
  accept,
  fail: vi.fn(),
});
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("shared analysis jobs", () => {
  it("publishes a memory-prepared success under its new write claim without another disk lookup", () => {
    const read = vi.fn(async () => null),
      write = vi.fn(async () => {}),
      current = () => true;
    const persistent = { read, write, claim: () => current } as unknown as PersistentAnalysisCache;
    const steps = vi.fn(function* () {
        return 99;
      }),
      complete = vi.fn();
    const input = base();
    const lease = requestSharedAnalysis({ ...input, persistent, steps, prepared: 7, complete });
    expect(complete).toHaveBeenCalledWith(7);
    expect(read).not.toHaveBeenCalled();
    expect(steps).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      input.kind,
      input.month,
      input.key,
      input.resolver,
      7,
      accept,
      current,
    );
    lease.cancel();
  });
  it("bounds a warm idle batch even when it coalesces zero-valued yield markers", () => {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelIdleCallback", () => {});
    vi.stubGlobal("performance", { now: () => 0 });
    let advanced = 0;
    const lease = requestSharedAnalysis({
      ...base(),
      steps: function* () {
        for (let i = 0; i < 100; i++) {
          advanced++;
          yield 0;
        }
        return 100;
      },
      complete: vi.fn(),
    });
    callbacks.shift()!();
    expect(advanced).toBe(32);
    lease.cancel();
  });
  it("uses only idle time until a visible consumer promotes the same generator", () => {
    const idle = vi.fn(() => 7),
      cancelIdle = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("cancelIdleCallback", cancelIdle);
    const input = base(),
      steps = vi.fn(function* () {
        yield 0;
        return 12;
      }),
      background = vi.fn(),
      visible = vi.fn();
    const warm = requestSharedAnalysis({ ...input, steps, complete: background });
    vi.advanceTimersByTime(1000);
    expect(steps).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
    const ui = requestSharedAnalysis({ ...input, priority: -3, steps, complete: visible });
    warm.cancel();
    vi.runAllTimers();
    expect(cancelIdle).toHaveBeenCalled();
    expect(visible).toHaveBeenCalledWith(12);
    expect(background).not.toHaveBeenCalled();
    expect(steps).toHaveBeenCalledTimes(1);
    ui.cancel();
  });
  it("replays completed annual progress when the view joins an unfinished net calculation", () => {
    const input = { ...base(), priority: 0 },
      progress = vi.fn(),
      complete = vi.fn();
    const steps = vi.fn(function* (report: (value: number) => void) {
      report(8);
      yield 0;
      return 12;
    });
    const warm = requestSharedAnalysis<number, number>({ ...input, steps, complete: vi.fn() });
    vi.advanceTimersToNextTimer();
    const ui = requestSharedAnalysis<number, number>({
      ...input,
      priority: -1,
      steps,
      progress,
      complete,
    });
    expect(progress).toHaveBeenCalledWith(8);
    vi.runAllTimers();
    expect(complete).toHaveBeenCalledWith(12);
    expect(steps).toHaveBeenCalledTimes(1);
    ui.cancel();
    warm.cancel();
  });
  it("shares one persistent read and ignores a late lookup after the last consumer leaves", async () => {
    let resolve!: (value: number | null) => void;
    const read = vi.fn(
        () =>
          new Promise<number | null>((done) => {
            resolve = done;
          }),
      ),
      write = vi.fn(async () => {});
    const persistent = { read, write } as unknown as PersistentAnalysisCache;
    const input = { ...base(), persistent },
      steps = vi.fn(function* () {
        return 99;
      }),
      a = vi.fn(),
      b = vi.fn();
    const warm = requestSharedAnalysis({ ...input, steps, complete: a }),
      ui = requestSharedAnalysis({ ...input, priority: -1, steps, complete: b });
    expect(read).toHaveBeenCalledTimes(1);
    warm.cancel();
    resolve(17);
    await Promise.resolve();
    expect(b).toHaveBeenCalledWith(17);
    expect(a).not.toHaveBeenCalled();
    expect(steps).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    ui.cancel();
    const late = requestSharedAnalysis({ ...input, steps, complete: a });
    late.cancel();
    resolve(null);
    await Promise.resolve();
    vi.runAllTimers();
    expect(steps).not.toHaveBeenCalled();
  });
  it("retains only successful leased snapshots and retries a failed or unusable result", () => {
    const input = { ...base(), priority: 0 },
      fail = vi.fn(),
      steps = vi.fn(function* () {
        yield 0;
        throw new Error("failed");
      });
    const first = requestSharedAnalysis({ ...input, steps, fail, complete: vi.fn() });
    vi.runAllTimers();
    expect(fail).toHaveBeenCalledTimes(1);
    expect(readSharedAnalysisResult(input.kind, input.key, input.resolver, null)).toBeNull();
    const second = requestSharedAnalysis({
      ...input,
      steps: function* () {
        return -1;
      },
      complete: vi.fn(),
    });
    vi.runAllTimers();
    expect(readSharedAnalysisResult(input.kind, input.key, input.resolver, null)).toBeNull();
    const good = requestSharedAnalysis({
      ...input,
      steps: function* () {
        return 5;
      },
      complete: vi.fn(),
    });
    vi.runAllTimers();
    expect(readSharedAnalysisResult(input.kind, input.key, input.resolver, null)).toBe(5);
    good.cancel();
    expect(readSharedAnalysisResult(input.kind, input.key, input.resolver, null)).toBeNull();
    first.cancel();
    second.cancel();
  });
  it("separates database/cache scopes for identical input text", async () => {
    const a = { read: async () => null, write: async () => {} } as PersistentAnalysisCache,
      b = { read: async () => null, write: async () => {} } as PersistentAnalysisCache;
    const input = { ...base(), priority: 0 },
      steps = vi.fn(function* () {
        return 5;
      }),
      doneA = vi.fn(),
      doneB = vi.fn();
    const first = requestSharedAnalysis({ ...input, persistent: a, steps, complete: doneA }),
      second = requestSharedAnalysis({ ...input, persistent: b, steps, complete: doneB });
    await Promise.resolve();
    first.cancel();
    vi.runAllTimers();
    expect(doneA).not.toHaveBeenCalled();
    expect(doneB).toHaveBeenCalledWith(5);
    second.cancel();
  });
});
