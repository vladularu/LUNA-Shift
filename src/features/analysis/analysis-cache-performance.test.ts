import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarPerformance } from "@/application/calendar-performance";
import { measureAnalysisCache } from "./analysis-cache-performance";

afterEach(() => {
  calendarPerformance.clear();
  vi.restoreAllMocks();
});

describe("analysis cache phase measurements", () => {
  it("does not start spans when diagnosis is disabled", () => {
    calendarPerformance.clear();
    const capture = vi.spyOn(calendarPerformance, "capture");
    const measurement = measureAnalysisCache("month", "2026-10");
    measurement.next(1);
    measurement.finish();
    expect(capture).not.toHaveBeenCalled();
  });

  it("records numeric phase spans and ignores later work after timeout or completion", () => {
    calendarPerformance.start(true);
    const measurement = measureAnalysisCache("checks", "2026-10");
    measurement.next(1);
    measurement.next(2);
    measurement.finish();
    measurement.next(3);
    measurement.finish();
    const events = calendarPerformance.report().events;
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.values.phase)).toEqual([1, 2]);
    expect(events.every((event) => event.kind === "analysis-cache-phase")).toBe(true);
    expect(events[0].values).toMatchObject({ month: 202610, stage: 2 });
    expect(events.every((event) => Number.isFinite(event.values.duration))).toBe(true);
  });

  it("does not leak a previous session into a restarted diagnosis", () => {
    calendarPerformance.start(true);
    const measurement = measureAnalysisCache("annual", "2026-01");
    measurement.next(9);
    calendarPerformance.stop();
    calendarPerformance.start(true);
    measurement.next(10);
    measurement.finish();
    expect(calendarPerformance.report().events).toHaveLength(0);
  });

  it("keeps the original request when asynchronous phases outlive navigation", () => {
    calendarPerformance.start(true);
    calendarPerformance.begin("analysis-request", "2026-10");
    const measurement = measureAnalysisCache("checks", "2026-10");
    measurement.next(1);
    calendarPerformance.begin("analysis-request", "2026-11");
    measurement.next(2);
    measurement.finish();
    const phases = calendarPerformance
      .report()
      .events.filter((event) => event.kind === "analysis-cache-phase");
    expect(phases).toHaveLength(2);
    expect(phases.every((event) => event.request === 1)).toBe(true);
  });
});
