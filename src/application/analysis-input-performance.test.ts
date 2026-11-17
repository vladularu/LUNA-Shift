import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarPerformance } from "./calendar-performance";
import { measureAnalysisInput } from "./analysis-input-performance";

afterEach(() => {
  calendarPerformance.clear();
  vi.restoreAllMocks();
});

describe("synchronous analysis input diagnostics", () => {
  it("does no timing outside a recording and preserves the exact result", () => {
    const now = vi.spyOn(performance, "now");
    const result = { private: "private input" };
    const operation = vi.fn(() => result);
    expect(measureAnalysisInput(1, 1, operation)).toBe(result);
    expect(operation).toHaveBeenCalledOnce();
    expect(now).not.toHaveBeenCalled();
    expect(calendarPerformance.report().events).toEqual([]);
  });
  it("records only slow synchronous numeric spans and never their contents", () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    calendarPerformance.start(true);
    const result = measureAnalysisInput(3, 0, () => {
      clock += 430;
      return "private input";
    });
    const object = { private: "another private value" };
    expect(
      measureAnalysisInput(5, 146, () => {
        clock += 12;
        return object;
      }),
    ).toBe(object);
    measureAnalysisInput(4, 1, () => {
      clock += 7;
    });
    expect(result).toBe("private input");
    expect(calendarPerformance.report().events.map((event) => event.values)).toEqual([
      { duration: 430, output: 13, count: 0, phase: 3, state: 1 },
      { duration: 12, count: 146, phase: 5, state: 1 },
    ]);
    expect(JSON.stringify(calendarPerformance.report())).not.toContain("private input");
    expect(JSON.stringify(calendarPerformance.report())).not.toContain("another private value");
  });
  it("preserves thrown errors and records failure without exporting their text", () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    calendarPerformance.start(true);
    const error = new Error("private error");
    let caught: unknown;
    try {
      measureAnalysisInput(2, 1000, () => {
        clock += 20;
        throw error;
      });
    } catch (value) {
      caught = value;
    }
    expect(caught).toBe(error);
    expect(calendarPerformance.report().events[0].values).toEqual({
      duration: 20,
      count: 1000,
      phase: 2,
      state: 3,
    });
    expect(JSON.stringify(calendarPerformance.report())).not.toContain("private error");
  });
  it("cannot append a completed span to a newer or stopped session", () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    calendarPerformance.start(true);
    measureAnalysisInput(6, 10, () => {
      clock += 20;
      calendarPerformance.start(true);
    });
    expect(calendarPerformance.report().events).toEqual([]);
    measureAnalysisInput(1, 10, () => {
      clock += 20;
      calendarPerformance.stop();
    });
    expect(calendarPerformance.report().events).toEqual([]);
  });
});
