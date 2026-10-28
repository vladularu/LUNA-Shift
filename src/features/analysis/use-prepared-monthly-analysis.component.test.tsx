import { act, renderHook } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import * as monthly from "./monthly-analysis";
import { usePreparedMonthlyAnalysis } from "./use-prepared-monthly-analysis";

jest.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (calculate: () => unknown) => ({ ok: true, value: calculate() }),
}));

function request(): monthly.MonthlyAnalysisRequest {
  return {
    month: "2026-09",
    profile: forecastProfile,
    entries: [forecastShift({ id: "september", date: "2026-09-03" })],
    tariffDecisions: [],
    workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    ruleResolver: { ...bundledRuleResolver },
  };
}
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("prepared month lifecycle", () => {
  it("keeps unexpected neighbour failures deferred and forwards them to the visible error boundary", async () => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(monthly, "calculateMonthlyAnalysisSteps").mockImplementation(function* () {
      yield 0;
      throw new Error("unexpected calculation failure");
    });
    const input = request();
    const hook = await renderHook(
      ({ active }: { active: boolean }) => usePreparedMonthlyAnalysis(input, active),
      { initialProps: { active: false } },
    );
    await act(async () => {
      jest.runAllTimers();
    });
    expect(hook.result.current).toBeNull();
    await expect(hook.rerender({ active: true })).rejects.toThrow("unexpected calculation failure");
  });
  it.each(["2026-09", "2027-09"])(
    "does not create a render loop for freshly loaded equivalent inputs in %s",
    async (month) => {
      jest.useFakeTimers();
      const source = { ...request(), month };
      const calculate = jest.spyOn(monthly, "calculateMonthlyAnalysis");
      const hook = await renderHook(
        ({ active }: { active: boolean }) =>
          usePreparedMonthlyAnalysis(
            {
              ...source,
              profile: { ...source.profile },
              entries: [...source.entries],
            },
            active,
          ),
        { initialProps: { active: true } },
      );
      expect(hook.result.current).toBeNull();
      expect(calculate).not.toHaveBeenCalled();
      await act(async () => {
        jest.runAllTimers();
      });
      const result = hook.result.current;
      expect(result).not.toBeNull();
      expect(calculate).not.toHaveBeenCalled();
      await hook.rerender({ active: false });
      expect(hook.result.current).toBe(result);
      expect(calculate).not.toHaveBeenCalled();
    },
  );
  it("retains a visible month's complete preview when it becomes a neighbour", async () => {
    jest.useFakeTimers();
    const r = { ...request(), month: "2027-09" };
    const hook = await renderHook(
      ({ active }: { active: boolean }) => usePreparedMonthlyAnalysis(r, active),
      {
        initialProps: { active: true },
      },
    );
    expect(hook.result.current).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    const visible = hook.result.current;
    expect(visible).not.toBeNull();
    await hook.rerender({ active: false });
    expect(hook.result.current).toBe(visible);
    await act(async () => {
      jest.runAllTimers();
    });
    expect(hook.result.current).toBe(visible);
  });
  it("prepares a neighbour outside rendering and selects it without a synchronous calculation", async () => {
    jest.useFakeTimers();
    const r = request();
    const calculate = jest.spyOn(monthly, "calculateMonthlyAnalysis");
    const hook = await renderHook(
      ({ active }: { active: boolean }) => usePreparedMonthlyAnalysis(r, active),
      {
        initialProps: { active: false },
      },
    );
    expect(hook.result.current).toBeNull();
    expect(calculate).not.toHaveBeenCalled();
    await act(async () => {
      jest.runAllTimers();
    });
    const prepared = hook.result.current;
    expect(prepared?.summary.ok).toBe(true);
    await hook.rerender({ active: true });
    expect(hook.result.current).toBe(prepared);
    expect(calculate).not.toHaveBeenCalled();
    await hook.unmount();
    const remounted = await renderHook(() =>
      usePreparedMonthlyAnalysis({ ...r, entries: [...r.entries] }, true),
    );
    expect(remounted.result.current).toBe(prepared);
    expect(calculate).not.toHaveBeenCalled();
  });

  it("abandons a partially prepared old month after its inputs change", async () => {
    jest.useFakeTimers();
    const old = request();
    const next = {
      ...old,
      entries: [forecastShift({ id: "new", date: "2026-09-03", endTime: "22:00" })],
    };
    const hook = await renderHook(
      ({ value }: { value: monthly.MonthlyAnalysisRequest | null }) =>
        usePreparedMonthlyAnalysis(value, false),
      {
        initialProps: { value: old as monthly.MonthlyAnalysisRequest | null },
      },
    );
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    await hook.rerender({ value: next });
    expect(hook.result.current).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(hook.result.current?.monthShifts[0].id).toBe("new");
    expect(monthly.getCachedMonthlyAnalysis(old)).toBeNull();
    await hook.rerender({ value: null });
    expect(hook.result.current).toBeNull();
  });

  it("clears an old result immediately and prepares changed visible inputs outside rendering", async () => {
    jest.useFakeTimers();
    const old = request();
    const hook = await renderHook(
      ({ value }: { value: monthly.MonthlyAnalysisRequest }) =>
        usePreparedMonthlyAnalysis(value, true),
      {
        initialProps: { value: old },
      },
    );
    await act(async () => {
      jest.runAllTimers();
    });
    const previous = hook.result.current;
    const next = {
      ...old,
      month: "2026-10",
      entries: [forecastShift({ id: "october", date: "2026-10-03" })],
    };
    await hook.rerender({ value: next });
    expect(hook.result.current).not.toBe(previous);
    expect(hook.result.current).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(hook.result.current?.monthShifts[0].id).toBe("october");
  });
});
