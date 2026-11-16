import { act, renderHook } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createRuleResolver } from "@/rules/rule-resolver";
import type {
  AnalysisSalaryRequest,
  PreparedAnalysisSalary,
} from "@/features/analysis/analysis-salary";
import type { MonthlyRustNetCalculator } from "@/features/analysis/monthly-rust-net";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import {
  createPersistentAnalysisCache,
  type PersistentAnalysisCache,
} from "@/features/analysis/persistent-analysis-cache";
import type { AnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import * as annualMath from "./annual-salary-forecast";
import * as paymentMath from "./salary-payment-input";
import fixture from "@/features/analysis/monthly-rust-salary-preparation.fixture.json";
import { useNativeSalaryReport } from "./use-salary-report";
import { useNativeAnnualSalaryForecast } from "./use-annual-salary-forecast";
import { usePreparedRustAutomaticNetPay } from "./use-rust-automatic-net-pay";

let mockRequest: AnalysisSalaryRequest,
  mockCalculator: MonthlyRustNetCalculator,
  mockPersistent: PersistentAnalysisCache | null;
let mockSnapshot: {
  epoch: number;
  status: "ready" | "loading" | "error";
  timeline: NonNullable<AnalysisSalaryRequest["payment"]>["sourceSettings"];
  annualPayments: AnalysisSalaryRequest["annualPayments"];
  error: string | null;
};
const mockEnsure = jest.fn<() => Promise<void>>().mockResolvedValue();
const mockReload = jest.fn<() => Promise<void>>().mockResolvedValue();
const mockDb = {};
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: mockReload }),
  usePflegeShiftEntries: () => ({ entries: mockRequest.context.entries }),
  usePflegeShiftProfile: () => ({ profile: mockRequest.profile }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: mockRequest.context.tariffDecisions,
    workPatternSettings: mockRequest.context.workPatternSettings,
  }),
  usePflegeShiftTestData: () => ({ testMonths: mockRequest.context.testMonths ?? [] }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockRequest.context.resolver, diagnosis: null }),
}));
jest.mock("./salary-payment-preferences", () => ({
  useSalaryPaymentPreferences: () => ({
    ready: true,
    error: null,
    preferences: mockRequest.payment!.preferences,
    reload: mockReload,
  }),
}));
jest.mock("@/features/analysis/analysis-salary-input-store", () => ({
  analysisSalaryInputStore: () => ({
    subscribe: () => () => {},
    getSnapshot: () => mockSnapshot,
    ensure: mockEnsure,
  }),
}));
jest.mock("@/features/analysis/use-monthly-rust-net-calculator", () => ({
  useMonthlyRustNetCalculator: () => mockCalculator,
}));
jest.mock("@/features/analysis/analysis-persistent-results", () => ({
  useAnalysisPersistentResults: () => mockPersistent,
}));
const value = fixture.value as unknown as PreparedAnalysisSalary,
  edited = fixture.edited.value as unknown as PreparedAnalysisSalary;
function request(source: unknown = fixture.request): AnalysisSalaryRequest {
  const input = source as AnalysisSalaryRequest;
  return { ...input, context: { ...input.context, resolver: createRuleResolver() } };
}
function setRequest(source: AnalysisSalaryRequest) {
  mockRequest = source;
  mockSnapshot = {
    epoch: 0,
    status: "ready",
    timeline: source.payment!.sourceSettings,
    annualPayments: source.annualPayments,
    error: null,
  };
}
function calculator(identity = "prepared-a") {
  const prepare = jest
    .fn<(input: AnalysisSalaryRequest) => Promise<PreparedAnalysisSalary>>()
    .mockResolvedValue(value);
  const calculate = Object.assign(
    jest
      .fn<(input: AnalysisSalaryRequest) => Promise<AutomaticNetPayForecast>>()
      .mockResolvedValue(value.forecast!),
    { cacheIdentity: identity, prepare },
  );
  return calculate;
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 15; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
  });
}
function useAll() {
  const report = useNativeSalaryReport(mockRequest.month, true);
  const annual = useNativeAnnualSalaryForecast(
    Number(mockRequest.month.slice(0, 4)),
    mockRequest.annualPayments,
    true,
    mockRequest.context.testMonths,
    mockRequest.month,
  );
  const net = usePreparedRustAutomaticNetPay(
    mockRequest.month,
    mockRequest.settings,
    mockRequest.settings?.version === 2,
    mockRequest.context.testMonths,
    mockRequest.payment!.sourceSettings,
  );
  return { report, annual, net };
}
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  setRequest(request());
  mockCalculator = calculator();
  mockPersistent = null;
  mockEnsure.mockClear();
  mockReload.mockClear();
  jest.spyOn(annualMath, "annualSalaryForecastSteps").mockImplementation(function* () {
    throw new Error("Native preparation must not run TS annual salary math");
  });
  jest.spyOn(annualMath, "annualSalaryForecast").mockImplementation(() => {
    throw new Error("Native preparation must not run TS annual salary math");
  });
  jest.spyOn(paymentMath, "salaryPaymentInputSteps").mockImplementation(function* () {
    throw new Error("Native preparation must not run TS allocation math");
  });
  jest.spyOn(paymentMath, "salaryPaymentInput").mockImplementation(() => {
    throw new Error("Native preparation must not run TS allocation math");
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("original salary hooks consume one complete native preparation", () => {
  it("retains the current salary form while only committed net settings refresh", async () => {
    const hook = await renderHook(useAll);
    await settle();
    const before = hook.result.current.report.calculation;
    expect(before?.ok).toBe(true);
    mockSnapshot = { ...mockSnapshot, status: "loading" };
    await hook.rerender(undefined);
    expect(hook.result.current.report.calculation).toEqual(before);
    expect(hook.result.current.report.ready).toBe(true);
    expect(hook.result.current.annual).toEqual(value.annual);
  });
  it("shares salary, annual editor and net without placeholder values after report readiness", async () => {
    const native = mockCalculator.prepare!,
      states: { projection: boolean; annual: boolean }[] = [];
    const hook = await renderHook(() => {
      const current = useAll();
      states.push({
        projection: current.report.calculation !== null,
        annual: current.annual.proposal !== null,
      });
      return current;
    });
    expect(hook.result.current.report.calculation).toBeNull();
    await settle();
    expect(hook.result.current.report.calculation?.ok).toBe(true);
    if (hook.result.current.report.calculation?.ok)
      expect(hook.result.current.report.calculation.value.projection).toEqual(value.projection);
    expect(hook.result.current.annual).toEqual(value.annual);
    expect(hook.result.current.net).toEqual(value.forecast);
    expect(states.some((state) => state.projection && !state.annual)).toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
    await hook.rerender(undefined);
    await settle();
    expect(native).toHaveBeenCalledTimes(1);
    expect(annualMath.annualSalaryForecastSteps).not.toHaveBeenCalled();
    expect(paymentMath.salaryPaymentInputSteps).not.toHaveBeenCalled();
  });
  it("discards a late response after an end-time edit and reuses the updated result", async () => {
    let finish!: (value: PreparedAnalysisSalary) => void;
    const native = jest
      .fn<(input: AnalysisSalaryRequest) => Promise<PreparedAnalysisSalary>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(edited);
    mockCalculator = Object.assign(calculator(), { prepare: native });
    const hook = await renderHook(useAll);
    await settle();
    expect(native).toHaveBeenCalledTimes(1);
    const resolver = mockRequest.context.resolver;
    setRequest({
      ...request(fixture.edited.request),
      context: { ...fixture.edited.request.context, resolver },
    } as unknown as AnalysisSalaryRequest);
    await hook.rerender(undefined);
    await settle();
    await act(async () => {
      finish(value);
      await Promise.resolve();
    });
    await settle();
    expect(hook.result.current.annual).toEqual(edited.annual);
    expect(hook.result.current.net).toEqual(edited.forecast);
    expect(native).toHaveBeenCalledTimes(2);
  });
  it("restores complete preparation after fresh cache/resolver instances", async () => {
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
        bundleId: "prepared-preview",
      });
    mockPersistent = cache();
    const native = mockCalculator.prepare!;
    const first = await renderHook(useAll);
    await settle();
    expect(rows.size).toBeGreaterThan(0);
    await first.unmount();
    setRequest(request());
    mockPersistent = cache();
    const second = await renderHook(useAll);
    await settle();
    expect(second.result.current.annual).toEqual(value.annual);
    expect(second.result.current.net).toEqual(value.forecast);
    expect(native).toHaveBeenCalledTimes(1);
  });
  it("keeps the existing retry path and never substitutes TS math", async () => {
    const native = jest
      .fn<(input: AnalysisSalaryRequest) => Promise<PreparedAnalysisSalary>>()
      .mockRejectedValueOnce(new Error("native unavailable"))
      .mockResolvedValue(value);
    mockCalculator = Object.assign(calculator(), { prepare: native });
    const hook = await renderHook(() => useNativeSalaryReport(mockRequest.month, true));
    await settle();
    expect(hook.result.current.calculation).toBeNull();
    expect(hook.result.current.error).toBe("Die Gehaltsprognose konnte nicht berechnet werden.");
    await act(async () => {
      hook.result.current.retryRules();
    });
    await settle();
    expect(hook.result.current.calculation?.ok).toBe(true);
    expect(native).toHaveBeenCalledTimes(2);
    expect(annualMath.annualSalaryForecastSteps).not.toHaveBeenCalled();
    expect(paymentMath.salaryPaymentInputSteps).not.toHaveBeenCalled();
  });
  it("supports missing net setup and keeps annual gross preparation available", async () => {
    setRequest(request(fixture.empty.request));
    const native = jest
      .fn<(input: AnalysisSalaryRequest) => Promise<PreparedAnalysisSalary>>()
      .mockResolvedValue(fixture.empty.value as unknown as PreparedAnalysisSalary);
    mockCalculator = Object.assign(calculator(), { prepare: native });
    const hook = await renderHook(useAll);
    await settle();
    expect(hook.result.current.report.calculation?.ok).toBe(true);
    expect(hook.result.current.net).toBeNull();
    expect(hook.result.current.annual).toEqual(fixture.empty.value.annual);
    expect(native).toHaveBeenCalledTimes(1);
  });
  it("retains loading/error states without starting unknown-input calculations", async () => {
    mockSnapshot = { ...mockSnapshot, status: "loading" };
    const native = mockCalculator.prepare!;
    const hook = await renderHook(() => useNativeSalaryReport(mockRequest.month, true));
    await settle();
    expect(hook.result.current.calculation).toBeNull();
    expect(native).not.toHaveBeenCalled();
    mockSnapshot = {
      ...mockSnapshot,
      status: "error",
      error: "Die Netto-Angaben konnten nicht geladen werden.",
    };
    await hook.rerender(undefined);
    await settle();
    expect(hook.result.current.error).toBe(mockSnapshot.error);
    expect(native).not.toHaveBeenCalled();
  });
});
