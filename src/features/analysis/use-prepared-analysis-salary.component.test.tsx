import { act, renderHook, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import * as salary from "./analysis-salary";
import { usePreparedAnalysisSalary } from "./use-prepared-analysis-salary";
import { AnalysisNetPayRow } from "./analysis-net-pay-row";
import { useNetPayProfile } from "@/features/salary/use-net-pay-profile";
import { useAutomaticNetPay } from "@/features/salary/use-automatic-net-pay";

jest.mock("@/features/salary/use-net-pay-profile", () => ({
  useNetPayProfile: jest.fn(() => {
    throw new Error("duplicate SQL read");
  }),
}));
jest.mock("@/features/salary/use-automatic-net-pay", () => ({
  useAutomaticNetPay: jest.fn(() => {
    throw new Error("calculation in render");
  }),
}));

function request(): salary.AnalysisSalaryRequest {
  return {
    month: "2026-09",
    profile: forecastProfile,
    settings: automatedSettings("2026-01"),
    annualPayments: [],
    context: {
      entries: [forecastShift({ date: "2026-09-05" })],
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      resolver: { ...bundledRuleResolver },
      testMonths: [],
    },
  };
}
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("prepared salary lifecycle", () => {
  it("publishes the completed annual/gross stage without cancelling the remaining net calculation", async () => {
    jest.useFakeTimers();
    const input = request();
    const hook = await renderHook(() => usePreparedAnalysisSalary(input, true));
    for (let step = 0; step < 150 && hook.result.current.annual === null; step++) {
      await act(async () => {
        jest.advanceTimersToNextTimer();
      });
    }
    expect(hook.result.current.annual).not.toBeNull();
    expect(hook.result.current.pending).toBe(true);
    expect(hook.result.current.result).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(hook.result.current.pending).toBe(false);
    expect(hook.result.current.result?.forecast?.result.status).toBe("available");
  });
  it("does not calculate during render and selects a prepared neighbour without restarting", async () => {
    jest.useFakeTimers();
    const input = request();
    const calculate = jest.spyOn(salary, "prepareAnalysisSalarySteps");
    const hook = await renderHook(
      ({ active }: { active: boolean }) => usePreparedAnalysisSalary(input, active),
      {
        initialProps: { active: false },
      },
    );
    expect(hook.result.current.pending).toBe(true);
    expect(hook.result.current.result).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    const prepared = hook.result.current.result;
    expect(prepared?.forecast?.result.status).toBe("available");
    await hook.rerender({ active: true });
    expect(hook.result.current.result).toBe(prepared);
    expect(calculate).toHaveBeenCalledTimes(1);
    await hook.unmount();
    const remounted = await renderHook(() =>
      usePreparedAnalysisSalary({ ...input, profile: { ...input.profile } }, true),
    );
    expect(remounted.result.current.result).toEqual(prepared);
    expect(remounted.result.current.pending).toBe(false);
    expect(calculate).toHaveBeenCalledTimes(1);
  });
  it.each(["2026-09", "2027-09"])(
    "does not restart for freshly loaded equivalent inputs in %s",
    async (month) => {
      jest.useFakeTimers();
      const input = { ...request(), month };
      const calculate = jest.spyOn(salary, "prepareAnalysisSalarySteps");
      const hook = await renderHook(
        ({ active }: { active: boolean }) =>
          usePreparedAnalysisSalary(
            {
              ...input,
              profile: { ...input.profile },
              settings: structuredClone(input.settings),
              context: { ...input.context, entries: [...input.context.entries] },
            },
            active,
          ),
        { initialProps: { active: true } },
      );
      await act(async () => {
        jest.runAllTimers();
      });
      const prepared = hook.result.current.result;
      expect(prepared).not.toBeNull();
      await hook.rerender({ active: false });
      await act(async () => {
        jest.runAllTimers();
      });
      expect(hook.result.current.result).toBe(prepared);
      expect(calculate).toHaveBeenCalledTimes(1);
    },
  );
  it("cancels stale work and clears results on a different month, profile or resolver", async () => {
    jest.useFakeTimers();
    const input = request();
    const hook = await renderHook(
      ({ value }: { value: salary.AnalysisSalaryRequest }) =>
        usePreparedAnalysisSalary(value, true),
      {
        initialProps: { value: input },
      },
    );
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    const changed = {
      ...input,
      month: "2026-10",
      profile: { ...input.profile, weeklyMinutes: 1200 },
    };
    await hook.rerender({ value: changed });
    expect(hook.result.current.result).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(hook.result.current.result?.forecast?.sourceMonth).toBe("2026-01");
    expect(hook.result.current.result?.forecast?.result.status).toBe("available");
    expect(salary.readAnalysisSalary(input, salary.analysisSalaryKey(input))).toBeNull();
    const resolverChanged = {
      ...changed,
      context: { ...changed.context, resolver: { ...bundledRuleResolver } },
    };
    await hook.rerender({ value: resolverChanged });
    expect(hook.result.current.pending).toBe(true);
    expect(hook.result.current.result).toBeNull();
    await hook.unmount();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(
      salary.readAnalysisSalary(resolverChanged, salary.analysisSalaryKey(resolverChanged)),
    ).toBeNull();
  });
  it("uses the prepared row model without another profile read or synchronous net calculation", async () => {
    const screen = await render(
      <AnalysisNetPayRow
        month="2026-09"
        model={{ blocked: false, status: "ready", error: null, forecast: null, pending: true }}
      />,
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(useNetPayProfile).not.toHaveBeenCalled();
    expect(useAutomaticNetPay).not.toHaveBeenCalled();
  });
});
