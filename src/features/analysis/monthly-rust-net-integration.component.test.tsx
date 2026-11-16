import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import * as original from "@/engine/net-pay";
import type { AnalysisSalaryRequest } from "./analysis-salary";
import type { MonthlyRustNetCalculator } from "./monthly-rust-net";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { usePreparedAnalysisSalary } from "./use-prepared-analysis-salary";
import fixture from "./monthly-rust-net.fixture.json";

const value = fixture.value as unknown as AutomaticNetPayForecast;
const request = () =>
  ({
    ...fixture.request,
    context: { ...fixture.request.context, resolver: { ...bundledRuleResolver } },
  }) as unknown as AnalysisSalaryRequest;
const calculator = () =>
  Object.assign(jest.fn<MonthlyRustNetCalculator>().mockResolvedValue(value), {
    cacheIdentity: "native-net-integration",
  });
async function settle() {
  await act(async () => {
    for (let index = 0; index < 12; index++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
  });
}
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  jest.spyOn(original, "calculateMonthlyNetPay").mockImplementation(() => {
    throw new Error("Native net must not call TypeScript net math");
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
describe("existing monthly salary preparation with recorded native net", () => {
  it("returns the original salary shape and reuses an unchanged completed month", async () => {
    const input = request(),
      native = calculator();
    const hook = await renderHook(() => usePreparedAnalysisSalary(input, true, 0, null, native));
    expect(native).not.toHaveBeenCalled();
    await settle();
    expect(hook.result.current.result?.forecast).toEqual(value);
    expect(native).toHaveBeenCalledTimes(1);
    expect(original.calculateMonthlyNetPay).not.toHaveBeenCalled();
    await hook.unmount();
    const again = await renderHook(() =>
      usePreparedAnalysisSalary(
        { ...input, settings: structuredClone(input.settings) },
        true,
        0,
        null,
        native,
      ),
    );
    expect(again.result.current.result?.forecast).toEqual(value);
    await settle();
    expect(native).toHaveBeenCalledTimes(1);
  });
  it("separates a different engine version without changing the UI contract", async () => {
    const input = request(),
      one = calculator(),
      two = Object.assign(calculator(), { cacheIdentity: "new-native-engine" });
    const hook = await renderHook(
      ({ native }: { native: MonthlyRustNetCalculator }) =>
        usePreparedAnalysisSalary(input, true, 0, null, native),
      { initialProps: { native: one as MonthlyRustNetCalculator } },
    );
    await settle();
    await hook.rerender({ native: two });
    await settle();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
    expect(hook.result.current.result?.forecast).toEqual(value);
    expect(original.calculateMonthlyNetPay).not.toHaveBeenCalled();
  });
});
