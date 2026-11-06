import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  forecastProfile as mockforecastProfile,
  forecastShift,
} from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS as mockDEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES as mockDEFAULT_SALARY_PAYMENT_PREFERENCES } from "@/domain/salary-payment";
import { bundledRuleResolver as mockbundledRuleResolver } from "@/rules/rule-resolver";
import { useAnnualNetPay } from "./use-annual-net-pay";
import { summarizeAnnualNetPay, type AnnualNetPay } from "./annual-net-pay";

let mockFocused = true;
let mockEntries = [forecastShift()];
const mockJobs: { complete: (value: AnnualNetPay) => void; cancel: ReturnType<typeof jest.fn> }[] =
  [];
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockforecastProfile }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: [],
    workPatternSettings: mockDEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockbundledRuleResolver }),
}));
jest.mock("@/features/salary/salary-payment-preferences", () => ({
  useSalaryPaymentPreferences: () => ({
    preferences: mockDEFAULT_SALARY_PAYMENT_PREFERENCES,
    ready: true,
    error: null,
  }),
}));
jest.mock("./analysis-work-queue", () => ({
  scheduleAnalysisWork: (_steps: unknown, complete: (value: AnnualNetPay) => void) => {
    const job = { complete, cancel: jest.fn() };
    mockJobs.push(job);
    return job;
  },
}));
const data = { status: "ready" as const, timeline: [], error: null };
beforeEach(() => {
  mockFocused = true;
  mockEntries = [forecastShift()];
  mockJobs.length = 0;
});
describe("annual net lifecycle", () => {
  it("defers work and does not restart for freshly loaded equivalent inputs", async () => {
    const hook = await renderHook(() => useAnnualNetPay(2026, { ...data, timeline: [] }, true, []));
    expect(hook.result.current.loading).toBe(true);
    expect(mockJobs).toHaveLength(1);
    const value = summarizeAnnualNetPay(2026, []);
    await act(async () => mockJobs[0].complete(value));
    await hook.rerender(undefined);
    expect(hook.result.current.report).toBe(value);
    expect(mockJobs).toHaveLength(1);
  });
  it("invalidates a changed year and rejects late completions from the old year", async () => {
    const hook = await renderHook(
      ({ year }: { year: number }) => useAnnualNetPay(year, data, true, []),
      {
        initialProps: { year: 2026 },
      },
    );
    await hook.rerender({ year: 2027 });
    expect(mockJobs[0].cancel).toHaveBeenCalledTimes(1);
    const next = summarizeAnnualNetPay(2027, []);
    await act(async () => {
      mockJobs[1].complete(next);
      mockJobs[0].complete(summarizeAnnualNetPay(2026, []));
    });
    expect(hook.result.current.report).toBe(next);
  });
  it("invalidates changed entry content even with unchanged revision and cancels on blur", async () => {
    const hook = await renderHook(() => useAnnualNetPay(2026, data, true, []));
    await act(async () => mockJobs[0].complete(summarizeAnnualNetPay(2026, [])));
    mockEntries = [{ ...mockEntries[0], startTime: "20:00" }];
    await hook.rerender(undefined);
    expect(hook.result.current.report).toBeNull();
    expect(mockJobs).toHaveLength(2);
    mockFocused = false;
    await hook.rerender(undefined);
    expect(mockJobs[1].cancel).toHaveBeenCalledTimes(1);
  });
  it("does not start on failed or still loading settings", async () => {
    const hook = await renderHook(() =>
      useAnnualNetPay(2026, { ...data, status: "error", error: "Laden fehlgeschlagen" }, true, []),
    );
    expect(mockJobs).toHaveLength(0);
    expect(hook.result.current).toMatchObject({
      loading: false,
      error: "Laden fehlgeschlagen",
      report: null,
    });
  });
});
