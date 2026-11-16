import { act, renderHook } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { MonthlyComplianceResult } from "@/domain/types";
import { createRuleResolver } from "@/rules/rule-resolver";
import type { AnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import * as original from "@/engine/compliance";
import { useDeferredMonthlyCompliance } from "./use-monthly-compliance";
import {
  createPersistentAnalysisCache,
  type PersistentAnalysisCache,
} from "./persistent-analysis-cache";
import type { MonthlyRustChecksCalculator } from "./monthly-rust-checks";
import fixture from "./monthly-rust-checks.fixture.json";

let mockCalculator: MonthlyRustChecksCalculator | null = null;
jest.mock("./use-monthly-rust-checks-calculator", () => ({
  useMonthlyRustChecksCalculator: () => mockCalculator,
}));
jest.mock("./use-local-reference-date", () => ({ useLocalReferenceDate: () => "2026-11-12" }));
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({ youthEnabled: false, error: null, retry: jest.fn() }),
}));
const value = fixture.value as unknown as MonthlyComplianceResult;
const edited = fixture.edited.value as unknown as MonthlyComplianceResult;
const input = () =>
  ({ enabled: true, ...fixture.request, ruleResolver: createRuleResolver() }) as Parameters<
    typeof useDeferredMonthlyCompliance
  >[0];
const native = (identity = "engine-a") =>
  Object.assign(
    jest
      .fn<
        (request: Parameters<MonthlyRustChecksCalculator>[0]) => Promise<MonthlyComplianceResult>
      >()
      .mockResolvedValue(value),
    {
      cacheIdentity: identity,
    },
  );
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
  });
}
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  jest.spyOn(original, "calculateMonthlyComplianceSteps").mockImplementation(function* () {
    throw new Error("Native checks must not execute TS compliance math");
  });
  mockCalculator = native();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("existing monthly check hook with recorded Rust findings", () => {
  it("shares overview/details and reuses a completed check on revisit", async () => {
    const request = input(),
      calculate = mockCalculator!;
    const hook = await renderHook(() => ({
      overview: useDeferredMonthlyCompliance(request),
      details: useDeferredMonthlyCompliance(request),
    }));
    await settle();
    expect(hook.result.current.overview.result).toEqual(value);
    expect(hook.result.current.details.result).toEqual(value);
    expect(calculate).toHaveBeenCalledTimes(1);
    await hook.unmount();
    const again = await renderHook(() => useDeferredMonthlyCompliance(request));
    expect(again.result.current.result).toEqual(value);
    await settle();
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(original.calculateMonthlyComplianceSteps).not.toHaveBeenCalled();
  });
  it("updates findings after an end-time edit and separates engine versions", async () => {
    const first = native().mockResolvedValueOnce(value).mockResolvedValue(edited);
    mockCalculator = first;
    const request = input();
    const hook = await renderHook(
      ({ current }: { current: typeof request }) => useDeferredMonthlyCompliance(current),
      { initialProps: { current: request } },
    );
    await settle();
    expect(hook.result.current.result).toEqual(value);
    const changed = { ...request, ...fixture.edited.request } as typeof request;
    await hook.rerender({ current: changed });
    await settle();
    expect(hook.result.current.result).toEqual(edited);
    expect(first).toHaveBeenCalledTimes(2);
    const second = native("engine-b").mockResolvedValue(edited);
    mockCalculator = second;
    await hook.rerender({ current: changed });
    expect(hook.result.current.result).toBeNull();
    await settle();
    expect(hook.result.current.result).toEqual(edited);
    expect(second).toHaveBeenCalledTimes(1);
    expect(original.calculateMonthlyComplianceSteps).not.toHaveBeenCalled();
  });
  it("ignores a late answer for the previous service data", async () => {
    let finish!: (value: MonthlyComplianceResult) => void;
    const calculate = native()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(edited);
    mockCalculator = calculate;
    const request = input();
    const hook = await renderHook(
      ({ current }: { current: typeof request }) => useDeferredMonthlyCompliance(current),
      { initialProps: { current: request } },
    );
    await settle();
    expect(calculate).toHaveBeenCalledTimes(1);
    await hook.rerender({ current: { ...request, ...fixture.edited.request } as typeof request });
    await settle();
    await act(async () => {
      finish(value);
      await Promise.resolve();
    });
    await settle();
    expect(hook.result.current.result).toEqual(edited);
    expect(calculate).toHaveBeenCalledTimes(2);
  });
  it("keeps the existing error/retry behavior without a TS substitute", async () => {
    const calculate = native()
      .mockRejectedValueOnce(new Error("native transport unavailable"))
      .mockResolvedValue(value);
    mockCalculator = calculate;
    const request = input(),
      hook = await renderHook(() => useDeferredMonthlyCompliance(request));
    await settle();
    expect(hook.result.current.result).toBeNull();
    expect(hook.result.current.error).toBe("Die Arbeitszeitprüfung konnte nicht berechnet werden.");
    await act(async () => {
      hook.result.current.retry();
    });
    await settle();
    expect(hook.result.current.result).toEqual(value);
    expect(calculate).toHaveBeenCalledTimes(2);
    expect(original.calculateMonthlyComplianceSteps).not.toHaveBeenCalled();
  });
  it("restores the persisted native result after fresh cache/resolver instances", async () => {
    const rows = new Map<string, { payload: string; digest: string }>();
    const repository: AnalysisResultRepository = {
      read: async (kind, month, key) => rows.get(JSON.stringify([kind, month, key])) ?? null,
      write: async (kind, month, key, stored) => {
        rows.set(JSON.stringify([kind, month, key]), stored);
      },
    };
    const cache = () =>
      createPersistentAnalysisCache({
        repository,
        sha256: async (text) => text,
        bundleId: "confirmed-preview",
      });
    let persistent: PersistentAnalysisCache = cache();
    const calculate = mockCalculator!,
      request = input();
    const first = await renderHook(() => useDeferredMonthlyCompliance({ ...request, persistent }));
    await settle();
    expect(first.result.current.result).toEqual(value);
    expect(rows.size).toBeGreaterThan(0);
    await first.unmount();
    persistent = cache();
    const restarted = input();
    const second = await renderHook(() =>
      useDeferredMonthlyCompliance({ ...restarted, persistent }),
    );
    await settle();
    expect(second.result.current.result).toEqual(value);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(original.calculateMonthlyComplianceSteps).not.toHaveBeenCalled();
  });
});
