import { act, renderHook } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { calendarPerformance } from "@/application/calendar-performance";
import { useAnalysisCommit, useAnalysisPerformance } from "./use-analysis-performance";

afterEach(() => {
  calendarPerformance.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
describe("opt-in analysis measurements", () => {
  it("does not start a timer or record by opening the analysis alone", async () => {
    jest.useFakeTimers();
    const interval = jest.spyOn(global, "setInterval");
    await renderHook(() => {
      useAnalysisPerformance("2026-09", true, "MONTH");
      useAnalysisCommit("2026-09", true, 63, true);
    });
    expect(interval).not.toHaveBeenCalled();
    expect(calendarPerformance.report().events).toEqual([]);
  });
  it("records readiness and JS timer lag for the selected analysis, then stops on blur", async () => {
    jest.useFakeTimers();
    const interval = jest.spyOn(global, "setInterval");
    const clear = jest.spyOn(global, "clearInterval");
    let now = 0;
    jest.spyOn(performance, "now").mockImplementation(() => now);
    calendarPerformance.start(true);
    const hook = await renderHook(
      ({ focused }: { focused: boolean }) => {
        useAnalysisPerformance("2026-09", focused, "MONTH");
        useAnalysisCommit("2026-09", true, 63, focused);
      },
      { initialProps: { focused: true } },
    );
    now = 180;
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(calendarPerformance.report().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "analysis-view", values: { month: 202609, mode: 1 } }),
        expect.objectContaining({
          kind: "analysis-commit",
          values: { month: 202609, mode: 1, state: 63 },
        }),
        expect.objectContaining({ kind: "analysis-lag", values: { duration: 80 } }),
      ]),
    );
    await hook.rerender({ focused: false });
    expect(clear).toHaveBeenCalledWith(interval.mock.results[0].value);
    await hook.rerender({ focused: true });
    expect(interval).toHaveBeenCalledTimes(2);
    await act(async () => {
      calendarPerformance.stop();
    });
    expect(clear).toHaveBeenCalledWith(interval.mock.results[1].value);
  });
});
