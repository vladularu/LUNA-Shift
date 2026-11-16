import { act, renderHook } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import type { MonthlyRustCalculator } from "./monthly-rust-bridge";
import * as original from "./monthly-analysis";
import { usePreparedMonthlyAnalysis } from "./use-prepared-monthly-analysis";
import fixture from "./monthly-rust-native.fixture.json";

const base = fixture.value as unknown as original.MonthlyAnalysisCalculation;
const edited = fixture.edited.value as unknown as original.MonthlyAnalysisCalculation;
function request() {
  return {
    ...fixture.request,
    workPatternSettings: undefined,
    ruleResolver: { ...bundledRuleResolver },
  } as original.MonthlyAnalysisRequest;
}
async function settle() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
  });
}
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  jest.spyOn(original, "calculateMonthlyAnalysisSteps").mockImplementation(function* () {
    throw new Error("The tested Rust path must not run TypeScript month math");
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("existing month hook with actual recorded Rust results", () => {
  it("separates engine versions while reusing an unchanged engine result", async () => {
    const input = request();
    const first = Object.assign(jest.fn<MonthlyRustCalculator>().mockResolvedValue(base), {
      cacheIdentity: "engine-a",
    });
    const second = Object.assign(jest.fn<MonthlyRustCalculator>().mockResolvedValue(base), {
      cacheIdentity: "engine-b",
    });
    const hook = await renderHook(
      ({ calculate }: { calculate: MonthlyRustCalculator }) =>
        usePreparedMonthlyAnalysis(input, true, 1, null, calculate),
      { initialProps: { calculate: first as MonthlyRustCalculator } },
    );
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    await hook.rerender({ calculate: second });
    await settle();
    expect(second).toHaveBeenCalledTimes(1);
    await hook.rerender({ calculate: first });
    expect(hook.result.current).toEqual(base);
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(original.calculateMonthlyAnalysisSteps).not.toHaveBeenCalled();
  });
  it("returns the original result shape and reuses the completed month on revisit", async () => {
    const input = request();
    const rust = jest.fn<MonthlyRustCalculator>().mockResolvedValue(base);
    const hook = await renderHook(() => usePreparedMonthlyAnalysis(input, true, 1, null, rust));
    await settle();
    expect(hook.result.current).toEqual(base);
    expect(rust).toHaveBeenCalledTimes(1);
    expect(original.calculateMonthlyAnalysisSteps).not.toHaveBeenCalled();
    await hook.unmount();
    const again = await renderHook(() => usePreparedMonthlyAnalysis(input, true, 1, null, rust));
    expect(again.result.current).toEqual(base);
    await settle();
    expect(rust).toHaveBeenCalledTimes(1);
  });
  it("uses the changed Rust result after an end-time edit", async () => {
    const input = request();
    const rust = jest
      .fn<MonthlyRustCalculator>()
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(edited);
    const hook = await renderHook(
      ({ current }: { current: original.MonthlyAnalysisRequest }) =>
        usePreparedMonthlyAnalysis(current, true, 1, null, rust),
      { initialProps: { current: input } },
    );
    await settle();
    expect(hook.result.current).toEqual(base);
    await hook.rerender({
      current: {
        ...fixture.edited.request,
        workPatternSettings: undefined,
        ruleResolver: input.ruleResolver,
      } as original.MonthlyAnalysisRequest,
    });
    await settle();
    expect(hook.result.current).toEqual(edited);
    expect(rust).toHaveBeenCalledTimes(2);
    expect(original.calculateMonthlyAnalysisSteps).not.toHaveBeenCalled();
  });
  it("discards a result when the page closes before native completion", async () => {
    const input = request();
    let finish!: (value: original.MonthlyAnalysisCalculation) => void;
    const rust = jest
      .fn<MonthlyRustCalculator>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(base);
    const hook = await renderHook(() => usePreparedMonthlyAnalysis(input, true, 1, null, rust));
    await settle();
    expect(rust).toHaveBeenCalledTimes(1);
    await hook.unmount();
    await act(async () => {
      finish(base);
      await Promise.resolve();
    });
    const again = await renderHook(() => usePreparedMonthlyAnalysis(input, true, 1, null, rust));
    await settle();
    expect(again.result.current).toEqual(base);
    expect(rust).toHaveBeenCalledTimes(2);
  });
});
