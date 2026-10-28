import { afterEach, describe, expect, it, vi } from "vitest";
import { analysisWorkPriority, createAnalysisWorkQueue } from "./analysis-work-queue";
import { calendarPerformance } from "@/application/calendar-performance";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  calendarPerformance.clear();
});

describe("cooperative analysis queue", () => {
  it("does no warm work with an exhausted idle budget and does not force an idle timeout", () => {
    vi.useFakeTimers();
    const callbacks: ((budget?: { didTimeout: boolean; timeRemaining(): number }) => void)[] = [];
    const request = vi.fn((work: (typeof callbacks)[number], options?: { timeout?: number }) => {
      callbacks.push(work);
      return callbacks.length;
    });
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    let advanced = 0;
    const pending = createAnalysisWorkQueue()(
      (function* () {
        advanced++;
        yield 0;
        return 1;
      })(),
      vi.fn(),
      vi.fn(),
      10,
    );
    expect(request.mock.calls[0][1]).toBeUndefined();
    callbacks.shift()!({ didTimeout: true, timeRemaining: () => 0 });
    expect(advanced).toBe(0);
    callbacks.shift()!({ didTimeout: false, timeRemaining: () => 0 });
    expect(advanced).toBe(0);
    callbacks.shift()!({ didTimeout: false, timeRemaining: () => 10 });
    expect(advanced).toBe(1);
    pending.cancel();
  });
  it("replaces a visible wakeup with idle planning after demotion or cancellation", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn(() => 7),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const enqueue = createAnalysisWorkQueue();
    let advanced = 0;
    function* work() {
      advanced++;
      yield 0;
      return 1;
    }
    const warm = enqueue(work(), vi.fn(), vi.fn(), -3);
    warm.setPriority(10);
    vi.advanceTimersByTime(1000);
    expect(advanced).toBe(0);
    const visible = enqueue(work(), vi.fn(), vi.fn(), -3);
    visible.cancel();
    vi.advanceTimersByTime(1000);
    expect(advanced).toBe(0);
    warm.cancel();
  });
  it("makes bounded progress on the fallback when the native idle API is absent", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const done = vi.fn();
    const job = createAnalysisWorkQueue()(
      (function* () {
        yield 0;
        return 1;
      })(),
      done,
      vi.fn(),
      10,
    );
    vi.advanceTimersByTime(15);
    expect(done).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(done).toHaveBeenCalledExactlyOnceWith(1);
    job.cancel();
  });
  it("prepares neighbouring month cards before independent legal and salary details", () => {
    vi.useFakeTimers();
    const enqueue = createAnalysisWorkQueue(),
      calls: string[] = [];
    function* work(name: string) {
      calls.push(name + ":start");
      yield 0;
      calls.push(name + ":finish");
      return name;
    }
    for (const [name, stage, active] of [
      ["salary", 3, true],
      ["checks", 2, true],
      ["next", 1, false],
      ["visible", 1, true],
    ] as const)
      enqueue(
        work(name),
        () => {},
        () => {},
        analysisWorkPriority(stage, active),
      );
    vi.runAllTimers();
    expect(calls.slice(0, 4)).toEqual([
      "visible:start",
      "visible:finish",
      "next:start",
      "next:finish",
    ]);
    expect(calls.indexOf("checks:start")).toBeGreaterThan(calls.indexOf("next:finish"));
    expect(calls.indexOf("salary:start")).toBeGreaterThan(calls.indexOf("next:finish"));
  });
  it("finishes current and adjacent details before speculative distant months", () => {
    vi.useFakeTimers();
    const enqueue = createAnalysisWorkQueue(),
      calls: string[] = [];
    function* work(name: string) {
      calls.push(name + ":start");
      yield 0;
      calls.push(name + ":finish");
      return name;
    }
    enqueue(
      work("distant"),
      () => {},
      () => {},
      analysisWorkPriority(1, false, 2),
    );
    enqueue(
      work("adjacent"),
      () => {},
      () => {},
      analysisWorkPriority(3, false, 1),
    );
    enqueue(
      work("visible"),
      () => {},
      () => {},
      analysisWorkPriority(3, true, 0),
    );
    vi.runAllTimers();
    expect(calls.indexOf("visible:finish")).toBeLessThan(calls.indexOf("adjacent:start"));
    expect(calls.indexOf("adjacent:finish")).toBeLessThan(calls.indexOf("distant:start"));
  });

  it("bounds idle starvation and still limits each callback and cancels duplicate wakeups", () => {
    vi.useFakeTimers();
    const idleCallbacks: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (work: () => void) => idleCallbacks.push(work));
    const cancelIdle = vi.fn();
    vi.stubGlobal("cancelIdleCallback", cancelIdle);
    const enqueue = createAnalysisWorkQueue(),
      complete = vi.fn();
    let advanced = 0;
    function* work() {
      for (let i = 0; i < 90; i++) {
        advanced++;
        yield 1;
      }
      return 90;
    }
    const pending = enqueue(work(), complete, () => {}, 2);
    vi.advanceTimersByTime(7);
    expect(advanced).toBe(0);
    vi.advanceTimersByTime(1);
    expect(advanced).toBeGreaterThan(0);
    expect(advanced).toBeLessThanOrEqual(32);
    pending.setPriority(0);
    vi.runAllTimers();
    expect(complete).toHaveBeenCalledExactlyOnceWith(90);
    for (const callback of idleCallbacks) callback();
    expect(complete).toHaveBeenCalledOnce();
    expect(cancelIdle).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels both the idle wait and bounded continuation when a background page unmounts", () => {
    vi.useFakeTimers();
    let idleCallback = () => {};
    vi.stubGlobal("requestIdleCallback", (work: () => void) => {
      idleCallback = work;
      return 1;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const complete = vi.fn();
    function* work() {
      yield 0;
      return 1;
    }
    const pending = createAnalysisWorkQueue()(work(), complete, () => {}, 2);
    pending.cancel();
    idleCallback();
    vi.runAllTimers();
    expect(complete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records numeric queue wait, CPU steps and cancellation only when explicitly enabled", () => {
    vi.useFakeTimers();
    const enqueue = createAnalysisWorkQueue();
    function* work() {
      yield 0;
      return 7;
    }
    enqueue(
      work(),
      () => {},
      () => {},
      0,
      { month: "2026-09", stage: 3 },
    );
    vi.runAllTimers();
    expect(calendarPerformance.report().events).toEqual([]);
    calendarPerformance.start(true);
    enqueue(
      work(),
      () => {},
      () => {},
      0,
      { month: "2026-09", stage: 3 },
    );
    vi.advanceTimersToNextTimer();
    vi.runAllTimers();
    expect(calendarPerformance.report().events).toEqual([
      expect.objectContaining({
        kind: "analysis-work",
        values: expect.objectContaining({
          month: 202609,
          stage: 3,
          count: 2,
          state: 1,
          cpu: expect.any(Number),
          wait: expect.any(Number),
          maximum: expect.any(Number),
        }),
      }),
    ]);
    const stale = enqueue(
      work(),
      () => {},
      () => {},
      0,
      { month: "2026-08", stage: 2 },
    );
    stale.cancel();
    expect(calendarPerformance.report().events.at(-1)?.values.state).toBe(2);
    const abandoned = enqueue(
      work(),
      () => {},
      () => {},
      0,
      { month: "2026-07", stage: 1 },
    );
    calendarPerformance.start(true);
    abandoned.cancel();
    expect(calendarPerformance.report().events).toEqual([]);
  });
  it("prioritizes the selected month and can promote a prepared neighbour without restarting", () => {
    vi.useFakeTimers();
    const enqueue = createAnalysisWorkQueue();
    const calls: string[] = [];
    function* work(name: string) {
      calls.push(name + ":start");
      yield 0;
      calls.push(name + ":finish");
      return name;
    }
    const next = enqueue(
      work("next"),
      () => {},
      () => {},
      1,
    );
    enqueue(
      work("visible"),
      () => {},
      () => {},
      0,
    );
    expect(calls).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(calls).toEqual(["visible:start"]);
    next.setPriority(-1);
    vi.advanceTimersToNextTimer();
    expect(calls.at(-1)).toBe("next:start");
    vi.runAllTimers();
    expect(calls.filter((v) => v === "next:start")).toHaveLength(1);
    expect(calls).toContain("visible:finish");
  });

  it("cancels stale work before another generator step and does not deliver its result", () => {
    vi.useFakeTimers();
    const enqueue = createAnalysisWorkQueue();
    const done = vi.fn();
    let advanced = 0;
    function* work() {
      advanced++;
      yield 0;
      advanced++;
      return 1;
    }
    const job = enqueue(work(), done, () => {});
    vi.advanceTimersToNextTimer();
    job.cancel();
    vi.runAllTimers();
    expect(advanced).toBe(1);
    expect(done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds fast steps and releases the queue after failures", () => {
    vi.useFakeTimers();
    const enqueue = createAnalysisWorkQueue();
    let advanced = 0;
    const failed = vi.fn();
    const done = vi.fn();
    function* many() {
      for (let i = 0; i < 70; i++) {
        advanced++;
        yield 1;
      }
      return 70;
    }
    function* broken(): Generator<number, number> {
      throw new Error("broken");
    }
    enqueue(many(), done, failed);
    vi.advanceTimersToNextTimer();
    expect(advanced).toBeLessThanOrEqual(32);
    expect(done).not.toHaveBeenCalled();
    enqueue(broken(), () => {}, failed, -1);
    vi.runAllTimers();
    expect(failed).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith(70);
  });
});
