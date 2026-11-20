import { act, renderHook } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { embeddedReviewedRuleResolver } from "@/rules/embedded-reviewed-rules";
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
  it("uses the current 2027 tariff rules even with an older native module enabled", async () => {
    jest.mocked(original.calculateMonthlyAnalysisSteps).mockRestore();
    const input = { ...request(), month: "2027-04" };
    const native = jest.fn<MonthlyRustCalculator>().mockResolvedValue(base);
    const hook = await renderHook(() => usePreparedMonthlyAnalysis(input, true, 1, null, native));
    await settle();
    expect(native).not.toHaveBeenCalled();
    expect(hook.result.current?.pay).toMatchObject({
      ok: true,
      value: {
        available: true,
        estimatedGrossAmount: expect.any(Number),
        provisionalTariffMonths: ["2027-03"],
      },
    });
  });

  it("uses the dated continuation before 2027 when the native engine cannot show it", async () => {
    jest.mocked(original.calculateMonthlyAnalysisSteps).mockRestore();
    const existing = request();
    const catalog = structuredClone(embeddedReviewedRuleResolver.simpleTariffData!);
    const table = catalog.tables.find(
      (row) => row.tariffId === "TVUK_PUK" && row.validFrom === "2025-10-01",
    );
    if (!table) throw new Error("The bundled TV-UK table is missing");
    table.validTo = "2026-05-31";
    const input: original.MonthlyAnalysisRequest = {
      ...existing,
      month: "2026-06",
      profile: {
        ...existing.profile,
        tariff: null,
        tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
      },
      ruleResolver: { ...embeddedReviewedRuleResolver, simpleTariffData: catalog },
    };
    const native = jest.fn<MonthlyRustCalculator>().mockResolvedValue(base);
    const hook = await renderHook(() => usePreparedMonthlyAnalysis(input, true, 1, null, native));
    await settle();
    expect(native).not.toHaveBeenCalled();
    expect(hook.result.current?.pay).toMatchObject({
      ok: true,
      value: { available: true, provisionalTariffMonths: ["2026-05"] },
    });
  });

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
