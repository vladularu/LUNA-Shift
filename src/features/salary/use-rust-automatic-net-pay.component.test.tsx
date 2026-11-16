import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import type { AnalysisSalaryRequest } from "@/features/analysis/analysis-salary";
import type { MonthlyRustNetCalculator } from "@/features/analysis/monthly-rust-net";
import type { PersistentAnalysisCache } from "@/features/analysis/persistent-analysis-cache";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import fixture from "@/features/analysis/monthly-rust-net.fixture.json";
import { useRustAutomaticNetPay } from "./use-rust-automatic-net-pay";

let mockRequest: AnalysisSalaryRequest;
let mockCalculator: MonthlyRustNetCalculator;
let mockPersistent: PersistentAnalysisCache | null;
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({ entries: mockRequest.context.entries }),
  usePflegeShiftProfile: () => ({ profile: mockRequest.profile }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: mockRequest.context.tariffDecisions,
    workPatternSettings: mockRequest.context.workPatternSettings,
  }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockRequest.context.resolver, diagnosis: null }),
}));
jest.mock("./salary-payment-preferences", () => ({
  useSalaryPaymentPreferences: () => ({
    ready: true,
    preferences: mockRequest.payment!.preferences,
  }),
}));
jest.mock("@/features/analysis/use-monthly-rust-net-calculator", () => ({
  useMonthlyRustNetCalculator: () => mockCalculator,
}));
jest.mock("@/features/analysis/analysis-persistent-results", () => ({
  useAnalysisPersistentResults: () => mockPersistent,
}));
async function settle() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
  });
}
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  mockRequest = {
    ...fixture.request,
    context: { ...fixture.request.context, resolver: { ...bundledRuleResolver } },
  } as unknown as AnalysisSalaryRequest;
  expect(mockRequest.payment).toBeDefined();
  mockCalculator = Object.assign(
    jest
      .fn<MonthlyRustNetCalculator>()
      .mockResolvedValue(fixture.value as unknown as AutomaticNetPayForecast),
    { cacheIdentity: "hook-native-net" },
  );
  mockPersistent = null;
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
describe("native net data hook with unchanged detail-page inputs", () => {
  it("starts outside render and keeps unchanged inputs settled", async () => {
    const hook = await renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useRustAutomaticNetPay(
          mockRequest.month,
          mockRequest.settings,
          enabled,
          mockRequest.context.testMonths,
          mockRequest.payment!.sourceSettings,
        ),
      { initialProps: { enabled: true } },
    );
    expect(hook.result.current).toBeNull();
    expect(mockCalculator).not.toHaveBeenCalled();
    await settle();
    expect(hook.result.current).toEqual(fixture.value);
    await hook.rerender({ enabled: true });
    await settle();
    expect(mockCalculator).toHaveBeenCalledTimes(1);
  });
  it("restores the existing complete salary snapshot without a native calculation", async () => {
    mockPersistent = {
      read: jest.fn(async () => fixture.full),
      write: jest.fn(async () => {}),
    } as unknown as PersistentAnalysisCache;
    const hook = await renderHook(() =>
      useRustAutomaticNetPay(
        mockRequest.month,
        mockRequest.settings,
        true,
        mockRequest.context.testMonths,
        mockRequest.payment!.sourceSettings,
      ),
    );
    await settle();
    expect(hook.result.current).toEqual(fixture.full.forecast);
    expect(mockCalculator).not.toHaveBeenCalled();
  });
  it("discards completion from an obsolete request", async () => {
    let resolveOld!: (value: AutomaticNetPayForecast) => void;
    const old = structuredClone(fixture.value) as unknown as AutomaticNetPayForecast;
    const current = structuredClone(fixture.value) as unknown as AutomaticNetPayForecast;
    mockCalculator = Object.assign(
      jest
        .fn<
          (...args: Parameters<MonthlyRustNetCalculator>) => ReturnType<MonthlyRustNetCalculator>
        >()
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolveOld = done;
            }),
        )
        .mockResolvedValue(current),
      { cacheIdentity: "hook-native-net" },
    );
    const settings = mockRequest.settings!;
    const hook = await renderHook(
      ({
        settings,
        timeline,
      }: {
        settings: typeof mockRequest.settings;
        timeline: NonNullable<AnalysisSalaryRequest["payment"]>["sourceSettings"];
      }) =>
        useRustAutomaticNetPay(
          mockRequest.month,
          settings,
          true,
          mockRequest.context.testMonths,
          timeline,
        ),
      { initialProps: { settings, timeline: mockRequest.payment!.sourceSettings } },
    );
    await settle();
    const changed = {
      ...settings,
      profile: {
        ...settings.profile,
        healthAdditionalRateBps: settings.profile.healthAdditionalRateBps + 1,
      },
    };
    await hook.rerender({
      settings: changed,
      timeline: mockRequest.payment!.sourceSettings.map((row) =>
        row.settings.month === settings.month
          ? { ...row, settings: changed, revision: row.revision + 1 }
          : row,
      ),
    });
    await settle();
    expect(hook.result.current).toEqual(current);
    const settled = hook.result.current;
    await act(async () => {
      resolveOld(old);
      await Promise.resolve();
    });
    await settle();
    expect(hook.result.current).toBe(settled);
  });
  it("does not calculate for a disabled page", async () => {
    const hook = await renderHook(() =>
      useRustAutomaticNetPay(
        mockRequest.month,
        mockRequest.settings,
        false,
        mockRequest.context.testMonths,
        mockRequest.payment!.sourceSettings,
      ),
    );
    await settle();
    expect(hook.result.current).toBeNull();
    expect(mockCalculator).not.toHaveBeenCalled();
  });
});
