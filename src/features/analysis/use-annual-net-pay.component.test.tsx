import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  forecastProfile as mockforecastProfile,
  forecastShift,
} from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS as mockDEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES as mockDEFAULT_SALARY_PAYMENT_PREFERENCES,
  setSalaryPaymentPeriod,
} from "@/domain/salary-payment";
import { createRuleResolver } from "@/rules/rule-resolver";
import { useAnnualNetPay } from "./use-annual-net-pay";
import { summarizeAnnualNetPay, type AnnualNetPay } from "./annual-net-pay";

let mockFocused = true;
let mockResolver = createRuleResolver();
let mockProfile = mockforecastProfile;
let mockPayment = mockDEFAULT_SALARY_PAYMENT_PREFERENCES;
let mockEntries = [forecastShift()];
const mockJobs: {
  complete: (value: AnnualNetPay) => void;
  fail: (error: unknown) => void;
  cancel: ReturnType<typeof jest.fn>;
  setPriority: ReturnType<typeof jest.fn>;
}[] = [];
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: [],
    workPatternSettings: mockDEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockResolver }),
}));
jest.mock("@/features/salary/salary-payment-preferences", () => ({
  useSalaryPaymentPreferences: () => ({
    preferences: mockPayment,
    ready: true,
    error: null,
  }),
}));
jest.mock("./analysis-work-queue", () => ({
  scheduleAnalysisWork: (
    _steps: unknown,
    complete: (value: AnnualNetPay) => void,
    fail: (error: unknown) => void,
  ) => {
    const job = { complete, fail, cancel: jest.fn(), setPriority: jest.fn() };
    mockJobs.push(job);
    return job;
  },
}));
const data = { status: "ready" as const, timeline: [], error: null };
beforeEach(() => {
  mockFocused = true;
  mockResolver = createRuleResolver();
  mockProfile = mockforecastProfile;
  mockPayment = mockDEFAULT_SALARY_PAYMENT_PREFERENCES;
  mockEntries = [forecastShift()];
  mockJobs.length = 0;
});
describe("annual net lifecycle", () => {
  it.each(["profile", "payment"] as const)(
    "invalidates changed %s content without requiring a new timestamp",
    async (change) => {
      const hook = await renderHook(() => useAnnualNetPay(2026, data, true, []));
      await act(async () => mockJobs[0].complete(summarizeAnnualNetPay(2026, [])));
      if (change === "profile")
        mockProfile = { ...mockProfile, weeklyMinutes: mockProfile.weeklyMinutes + 60 };
      else
        mockPayment = setSalaryPaymentPeriod(mockPayment, {
          effectiveMonth: "2026-01",
          delays: {
            PREMIUMS: 0,
            MONTHLY_ALLOWANCE: 0,
            HOURLY_ALLOWANCE: 0,
            OVERTIME: 0,
            SPECIAL_DUTY: 0,
          },
        });
      await hook.rerender(undefined);
      expect(hook.result.current.report).toBeNull();
      expect(mockJobs).toHaveLength(2);
    },
  );
  it("keeps the amount and month rows through repeated blur/refocus without new jobs", async () => {
    const hook = await renderHook(() => useAnnualNetPay(2026, data, true, []));
    await act(async () =>
      mockJobs[0].complete(
        summarizeAnnualNetPay(2026, [
          { month: "2026-01", netCents: 210000, status: null, notes: [], preliminary: false },
        ]),
      ),
    );
    const report = hook.result.current.report;
    for (let step = 0; step < 10; step++) {
      mockFocused = !mockFocused;
      await hook.rerender(undefined);
      expect(hook.result.current).toMatchObject({ report, loading: false, error: null });
      expect(hook.result.current.report).toBe(report);
    }
    expect(mockJobs).toHaveLength(1);
  });
  it("reuses a completed overview result immediately after unmount and opening details", async () => {
    const overview = await renderHook(() => useAnnualNetPay(2026, data, true, []));
    await act(async () => mockJobs[0].complete(summarizeAnnualNetPay(2026, [])));
    const report = overview.result.current.report;
    await overview.unmount();
    const detail = await renderHook(() =>
      useAnnualNetPay(2026, { ...data, timeline: [] }, true, []),
    );
    expect(detail.result.current.report).toBe(report);
    expect(detail.result.current.loading).toBe(false);
    expect(mockJobs).toHaveLength(1);
  });
  it("shares pending work and does not cancel the remaining consumer", async () => {
    const overview = await renderHook(() => useAnnualNetPay(2026, data, true, []));
    const detail = await renderHook(() => useAnnualNetPay(2026, data, true, []));
    expect(mockJobs).toHaveLength(1);
    await overview.unmount();
    expect(mockJobs[0].cancel).not.toHaveBeenCalled();
    await act(async () => mockJobs[0].complete(summarizeAnnualNetPay(2026, [])));
    expect(detail.result.current.loading).toBe(false);
    expect(detail.result.current.report?.year).toBe(2026);
  });
  it("does not begin cold work while blurred and rejects a canceled late completion", async () => {
    mockFocused = false;
    const hook = await renderHook(() => useAnnualNetPay(2026, data, true, []));
    expect(mockJobs).toHaveLength(0);
    mockFocused = true;
    await hook.rerender(undefined);
    mockFocused = false;
    await hook.rerender(undefined);
    expect(mockJobs[0].cancel).toHaveBeenCalledTimes(1);
    await act(async () => mockJobs[0].complete(summarizeAnnualNetPay(2026, [])));
    expect(hook.result.current.report).toBeNull();
    mockFocused = true;
    await hook.rerender(undefined);
    expect(mockJobs).toHaveLength(2);
    expect(hook.result.current.report).toBeNull();
  });
  it("never presents the previous year or previous catalog as the current result", async () => {
    const hook = await renderHook(
      ({ year }: { year: number }) => useAnnualNetPay(year, data, true, []),
      { initialProps: { year: 2026 } },
    );
    await act(async () => mockJobs[0].complete(summarizeAnnualNetPay(2026, [])));
    const report = hook.result.current.report;
    await hook.rerender({ year: 2027 });
    expect(hook.result.current.report).toBeNull();
    await hook.rerender({ year: 2026 });
    expect(hook.result.current.report).toBe(report);
    expect(mockJobs).toHaveLength(2);
    mockResolver = createRuleResolver();
    await hook.rerender({ year: 2026 });
    expect(hook.result.current.report).toBeNull();
    expect(mockJobs).toHaveLength(3);
  });
  it("invalidates test-month restrictions even when financial inputs otherwise match", async () => {
    const hook = await renderHook(
      ({ months }: { months: string[] }) => useAnnualNetPay(2026, data, true, months),
      { initialProps: { months: [] } },
    );
    await act(async () => mockJobs[0].complete(summarizeAnnualNetPay(2026, [])));
    await hook.rerender({ months: ["2026-01"] });
    expect(hook.result.current.report).toBeNull();
    expect(mockJobs).toHaveLength(2);
  });
  it("keeps calculation failures visible without starting an endless retry loop", async () => {
    const hook = await renderHook(() => useAnnualNetPay(2026, data, true, []));
    await act(async () => mockJobs[0].fail(new Error("Calculation failed")));
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.error).toContain("nicht berechnet");
    mockFocused = false;
    await hook.rerender(undefined);
    mockFocused = true;
    await hook.rerender(undefined);
    expect(mockJobs).toHaveLength(1);
  });
  it("defers work and does not restart for freshly loaded equivalent inputs", async () => {
    const hook = await renderHook(() => useAnnualNetPay(2026, { ...data, timeline: [] }, true, []));
    expect(hook.result.current.loading).toBe(true);
    expect(mockJobs).toHaveLength(1);
    const value = summarizeAnnualNetPay(2026, []);
    await act(async () => mockJobs[0].complete(value));
    await hook.rerender(undefined);
    expect(hook.result.current.report).toEqual(value);
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
    expect(hook.result.current.report).toEqual(next);
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
