import { act, renderHook } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import { createRuleResolver } from "@/rules/rule-resolver";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import * as compliance from "@/engine/compliance";
import * as monthly from "./monthly-analysis";
import * as salary from "./analysis-salary";
import { usePreparedMonthlyAnalysis } from "./use-prepared-monthly-analysis";
import { usePreparedAnalysisSalary } from "./use-prepared-analysis-salary";
import { useDeferredMonthlyCompliance } from "./use-monthly-compliance";
import {
  createPersistentAnalysisCache,
  type PersistentAnalysisCache,
} from "./persistent-analysis-cache";
import {
  AnalysisPersistentResultsProvider,
  useAnalysisPersistentResults,
} from "./analysis-persistent-results";
import type { PropsWithChildren } from "react";
import type { SQLiteDatabase } from "expo-sqlite";
import { createAnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import { persistentCheckValue } from "./persistent-analysis-values";
import type { MonthlyComplianceResult } from "@/domain/types";

let mockDb = {} as SQLiteDatabase,
  mockUpdateId: string | null = "same-release";
const mockDbRows = new WeakMap<object, Map<string, { payload: string; digest: string }>>();
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("expo-updates", () => ({
  get updateId() {
    return mockUpdateId;
  },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: unknown, text: string) => text,
}));
jest.mock("@/infrastructure/database/analysis-result-repository", () => ({
  ...jest.requireActual<typeof import("@/infrastructure/database/analysis-result-repository")>(
    "@/infrastructure/database/analysis-result-repository",
  ),
  createAnalysisResultRepository: jest.fn((db: SQLiteDatabase) => {
    let rows = mockDbRows.get(db);
    if (!rows) {
      rows = new Map();
      mockDbRows.set(db, rows);
    }
    const data = rows;
    return {
      read: async (kind: string, month: string, key: string) =>
        data.get(JSON.stringify([kind, month, key])) ?? null,
      write: async (
        kind: string,
        month: string,
        key: string,
        value: { payload: string; digest: string },
      ) => {
        data.set(JSON.stringify([kind, month, key]), value);
      },
    };
  }),
}));

let mockDate = "2026-10-28",
  mockYouth = false;
jest.mock("./use-local-reference-date", () => ({ useLocalReferenceDate: () => mockDate }));
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({ youthEnabled: mockYouth, error: null, retry: jest.fn() }),
}));
jest.mock("./rule-computation", () => ({
  captureRuleComputation: (calculate: () => unknown) => ({ ok: true, value: calculate() }),
}));

function request() {
  const month: monthly.MonthlyAnalysisRequest = {
    month: "2026-10",
    profile: forecastProfile,
    entries: [7, 8, 9, 10].map((m) =>
      forecastShift({ id: `m${m}`, date: `2026-${String(m).padStart(2, "0")}-05` }),
    ),
    tariffDecisions: [],
    workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    ruleResolver: createRuleResolver(),
  };
  const pay: salary.AnalysisSalaryRequest = {
    month: month.month,
    profile: month.profile,
    settings: automatedSettings("2026-01"),
    annualPayments: [],
    context: {
      entries: month.entries,
      tariffDecisions: month.tariffDecisions,
      workPatternSettings: month.workPatternSettings ?? DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      resolver: month.ruleResolver,
      testMonths: [],
    },
  };
  return { month, pay };
}
function useAll(input: ReturnType<typeof request>, cache: PersistentAnalysisCache | null) {
  const month = usePreparedMonthlyAnalysis(input.month, true, 1, cache);
  const pay = usePreparedAnalysisSalary(input.pay, true, 1, cache);
  const check = useDeferredMonthlyCompliance({
    enabled: true,
    month: input.month.month,
    profile: input.month.profile,
    ruleResolver: input.month.ruleResolver,
    shifts: input.month.entries.filter((entry) => entry.kind === "SHIFT"),
    persistent: cache,
  });
  return { month, pay, check };
}
async function finish() {
  for (let i = 0; i < 15; i++)
    await act(async () => {
      jest.runAllTimers();
    });
}
function storage() {
  const data = new Map<string, { payload: string; digest: string }>();
  const repository: AnalysisResultRepository = {
    read: async (kind, month, key) => data.get(JSON.stringify([kind, month, key])) ?? null,
    write: async (kind, month, key, value) => {
      data.set(JSON.stringify([kind, month, key]), value);
    },
  };
  const fresh = () =>
    createPersistentAnalysisCache({
      repository,
      bundleId: "same-release",
      sha256: async (text) => text,
    });
  return { data, fresh };
}
beforeEach(() => {
  jest.useFakeTimers();
  mockDate = "2026-10-28";
  mockYouth = false;
  mockDb = {} as SQLiteDatabase;
  mockUpdateId = "same-release";
  jest.mocked(createAnalysisResultRepository).mockClear();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("persisted result lifecycle", () => {
  it("wires the actual provider to one keyed database and never carries rows to a replacement database", async () => {
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <AnalysisPersistentResultsProvider timeZone="Europe/Berlin">
          {children}
        </AnalysisPersistentResultsProvider>
      );
    }
    const hook = await renderHook(() => useAnalysisPersistentResults(), { wrapper: Wrapper });
    const first = hook.result.current!,
      resolver = createRuleResolver();
    const value: MonthlyComplianceResult = {
      month: "2026-10",
      issues: [],
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      affectedDates: [],
    };
    await act(async () => {
      await first.write("checks", "2026-10", "same-input", resolver, value, persistentCheckValue);
    });
    expect(
      await first.read("checks", "2026-10", "same-input", resolver, persistentCheckValue),
    ).toEqual(value);
    await hook.rerender(undefined);
    expect(hook.result.current).toBe(first);
    mockDb = {} as SQLiteDatabase;
    await hook.rerender(undefined);
    expect(hook.result.current).not.toBe(first);
    expect(
      await hook.result.current!.read(
        "checks",
        "2026-10",
        "same-input",
        resolver,
        persistentCheckValue,
      ),
    ).toBeNull();
    expect(createAnalysisResultRepository).toHaveBeenCalledTimes(2);
  });
  it("disables persistence when an app bundle identity is unavailable", async () => {
    mockUpdateId = null;
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <AnalysisPersistentResultsProvider timeZone="Europe/Berlin">
          {children}
        </AnalysisPersistentResultsProvider>
      );
    }
    const hook = await renderHook(() => useAnalysisPersistentResults(), { wrapper: Wrapper });
    expect(hook.result.current).toBeNull();
    expect(createAnalysisResultRepository).not.toHaveBeenCalled();
  });
  it("reopens complete month, salary and checks with fresh resolver/cache objects without any calculation", async () => {
    const disk = storage(),
      source = request();
    const cache = disk.fresh(),
      mounted = await renderHook(() => useAll(source, cache));
    await finish();
    const result = mounted.result.current;
    expect(result.month).not.toBeNull();
    expect(result.pay.result?.forecast?.result.status).toBe("available");
    expect(result.check.result).not.toBeNull();
    expect(disk.data.size).toBe(3);
    await mounted.unmount();
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps"),
      salaryWork = jest.spyOn(salary, "prepareAnalysisSalarySteps"),
      checkWork = jest.spyOn(compliance, "calculateMonthlyComplianceSteps");
    const reopened = request(),
      freshCache = disk.fresh();
    const next = await renderHook(() => useAll(reopened, freshCache));
    await finish();
    expect(next.result.current.month).toEqual(result.month);
    expect(next.result.current.pay.result).toEqual(result.pay.result);
    expect(next.result.current.check.result).toEqual(result.check.result);
    expect(monthWork).not.toHaveBeenCalled();
    expect(salaryWork).not.toHaveBeenCalled();
    expect(checkWork).not.toHaveBeenCalled();
  });
  it("recomputes changed duties without revision changes, and checks after date or preference changes", async () => {
    const disk = storage(),
      cache = disk.fresh(),
      source = request();
    const hook = await renderHook(
      ({ input }: { input: ReturnType<typeof request> }) => useAll(input, cache),
      { initialProps: { input: source } },
    );
    await finish();
    const before = hook.result.current;
    const changed = {
      ...source,
      month: {
        ...source.month,
        entries: source.month.entries.map((entry) => ({ ...entry, endTime: "23:00" })),
      },
      pay: {
        ...source.pay,
        context: {
          ...source.pay.context,
          entries: source.pay.context.entries.map((entry) => ({ ...entry, endTime: "23:00" })),
        },
      },
    };
    await hook.rerender({ input: changed });
    expect(hook.result.current.month).toBeNull();
    expect(hook.result.current.pay.result).toBeNull();
    await finish();
    expect(hook.result.current.month).not.toEqual(before.month);
    expect(hook.result.current.pay.result).not.toEqual(before.pay.result);
    const work = jest.spyOn(compliance, "calculateMonthlyComplianceSteps");
    mockDate = "2026-10-29";
    await hook.rerender({ input: changed });
    await finish();
    expect(work).toHaveBeenCalledTimes(1);
    mockYouth = true;
    await hook.rerender({ input: changed });
    await finish();
    expect(work).toHaveBeenCalledTimes(2);
  });
  it("cancels all three pending reads on unmount, without starting work from late hits", async () => {
    const pending: (() => void)[] = [];
    const cache = {
      read: () => new Promise<null>((resolve) => pending.push(() => resolve(null))),
      write: async () => {},
    } as PersistentAnalysisCache;
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps"),
      salaryWork = jest.spyOn(salary, "prepareAnalysisSalarySteps"),
      checkWork = jest.spyOn(compliance, "calculateMonthlyComplianceSteps");
    const source = request(),
      hook = await renderHook(() => useAll(source, cache));
    expect(pending).toHaveLength(3);
    await hook.unmount();
    await act(async () => {
      pending.forEach((resolve) => resolve());
    });
    await finish();
    expect(monthWork).not.toHaveBeenCalled();
    expect(salaryWork).not.toHaveBeenCalled();
    expect(checkWork).not.toHaveBeenCalled();
  });
});
