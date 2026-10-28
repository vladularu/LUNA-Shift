import { act, renderHook } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useLayoutEffect, type PropsWithChildren } from "react";
import type { CalendarEntry } from "@/domain/types";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS as mockPattern } from "@/engine/simple-pay";
import { BUNDLED_RULE_CATALOG, createRuleResolver } from "@/rules/rule-resolver";
import { ActiveMonthProvider, useActiveMonthCoordinator } from "@/navigation/active-month";
import * as engine from "./annual-core-report";
import AnnualAnalysisBackgroundPreparation from "./annual-analysis-background-preparation";
import { useSimpleAnnualReport } from "./use-simple-annual-report";
import { selectAnnualReportInputs } from "./annual-report-inputs";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";

let mockReady = true,
  mockState = "active",
  mockYouth: boolean | null = false;
let mockProfile = forecastProfile,
  mockResolver = createRuleResolver();
let mockEntries: readonly CalendarEntry[] = [];
let mockPersistent: PersistentAnalysisCache;
const mockListeners = new Set<(state: string) => void>();
const mockDecisions = Object.freeze([]),
  mockTestMonths = Object.freeze([]);
jest.mock("react-native/Libraries/AppState/AppState", () => ({
  __esModule: true,
  default: {
    get currentState() {
      return mockState;
    },
    addEventListener: (_name: string, listener: (state: string) => void) => {
      mockListeners.add(listener);
      return { remove: () => mockListeners.delete(listener) };
    },
  },
}));
jest.mock("./analysis-persistent-results", () => ({
  useAnalysisPersistentResults: () => mockPersistent,
}));
jest.mock("./use-local-reference-date", () => ({ useLocalReferenceDate: () => "2026-10-28" }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: mockReady, error: null }),
  usePflegeShiftProfile: () => ({ profile: mockProfile, calculationProfile: null }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: mockDecisions,
    workPatternSettings: mockPattern,
  }),
  usePflegeShiftTestData: () => ({ testMonths: mockTestMonths }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockResolver }),
}));
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({ youthEnabled: mockYouth, error: null, retry: jest.fn() }),
}));
let coordinator: ReturnType<typeof useActiveMonthCoordinator>;
function Capture() {
  const current = useActiveMonthCoordinator();
  useLayoutEffect(() => {
    coordinator = current;
  }, [current]);
  return null;
}
function Wrapper({ children }: PropsWithChildren) {
  return (
    <ActiveMonthProvider>
      <AnnualAnalysisBackgroundPreparation />
      <Capture />
      {children}
    </ActiveMonthProvider>
  );
}
function useYear(year = 2026, enabled = true) {
  const selected = selectAnnualReportInputs(
    null,
    year,
    mockEntries,
    mockDecisions,
    mockResolver,
    mockProfile.tariff !== null,
  );
  return useSimpleAnnualReport({
    enabled,
    year,
    entries: selected.entries,
    profile: mockProfile,
    ruleResolver: mockResolver,
    tariffDecisions: selected.tariffDecisions,
    workPatternSettings: mockPattern,
  });
}
async function flush() {
  await act(async () => {
    await jest.runAllTimersAsync();
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  mockReady = true;
  mockState = "active";
  mockYouth = false;
  mockProfile = forecastProfile;
  mockResolver = createRuleResolver();
  mockEntries = [
    forecastShift({ id: "january", date: "2026-01-05" }),
    forecastShift({ id: "october", date: "2026-10-05" }),
  ];
  mockPersistent = { read: async () => null, write: async () => {} };
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("annual background preparation and visible consumers", () => {
  it.each([12, 8])(
    "hydrates a persisted year with %i available salary months after a fresh cache and catalog instance",
    async (salaryMonths) => {
      const rules = () =>
        createRuleResolver({
          ...BUNDLED_RULE_CATALOG,
          tariff: BUNDLED_RULE_CATALOG.tariff.filter(
            (item) => salaryMonths === 12 || item.validFrom >= "2026-05-01",
          ),
        });
      mockResolver = rules();
      const rows = new Map<string, unknown>();
      const storage = (): PersistentAnalysisCache => ({
        read: async (kind, month, key, _resolver, accept) => {
          const value = rows.get(`${kind}:${month}:${key}`);
          return accept(value) ? value : null;
        },
        write: async (kind, month, key, _resolver, value, accept) => {
          if (accept(value)) rows.set(`${kind}:${month}:${key}`, value);
        },
      });
      mockPersistent = storage();
      const first = await renderHook(() => useYear(2026, false), { wrapper: Wrapper });
      await flush();
      expect(rows.size).toBe(1);
      await first.unmount();
      mockPersistent = storage();
      mockResolver = rules();
      const calculate = jest.spyOn(engine, "buildAnnualAvailableReportSteps");
      const second = await renderHook(({ show }: { show: boolean }) => useYear(2026, show), {
        initialProps: { show: false },
        wrapper: Wrapper,
      });
      await flush();
      await second.rerender({ show: true });
      expect(second.result.current.report?.distribution).toBeInstanceOf(Map);
      expect(second.result.current.report?.availablePayMonthCount).toBe(salaryMonths);
      expect(calculate).not.toHaveBeenCalled();
      await second.unmount();
    },
  );
  it("opens a prepared year in its first visible render and reuses it in another screen", async () => {
    const calculate = jest.spyOn(engine, "buildAnnualAvailableReportSteps");
    const frames: boolean[] = [];
    const screen = await renderHook(
      ({ show }: { show: boolean }) => {
        const value = useYear(2026, show);
        frames.push(value.report !== null);
        return value;
      },
      { initialProps: { show: false }, wrapper: Wrapper },
    );
    await flush();
    expect(calculate).toHaveBeenCalledTimes(1);
    frames.length = 0;
    await screen.rerender({ show: true });
    expect(frames[0]).toBe(true);
    const report = screen.result.current.report;
    expect(report).not.toBeNull();
    const details = await renderHook(() => useYear(), { wrapper: Wrapper });
    expect(details.result.current.report).toBe(report);
    expect(calculate).toHaveBeenCalledTimes(1);
    await details.unmount();
    await screen.unmount();
  });
  it("joins in-progress preparation and cancelling that background lease preserves the visible one", async () => {
    const calculate = jest.spyOn(engine, "buildAnnualAvailableReportSteps");
    const screen = await renderHook(({ show }: { show: boolean }) => useYear(2026, show), {
      initialProps: { show: false },
      wrapper: Wrapper,
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(35);
    });
    await screen.rerender({ show: true });
    mockState = "background";
    await act(async () => {
      for (const listener of mockListeners) listener("background");
    });
    await flush();
    expect(screen.result.current.report).not.toBeNull();
    expect(calculate).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });
  it("refreshes edits while the year is closed, then returns from another year without recomputing it", async () => {
    const calculate = jest.spyOn(engine, "buildAnnualAvailableReportSteps");
    const screen = await renderHook(
      ({ year, show }: { year: number; show: boolean }) => useYear(year, show),
      { initialProps: { year: 2026, show: false }, wrapper: Wrapper },
    );
    await flush();
    mockEntries = mockEntries.map((entry) => ({ ...entry, endTime: "09:00" }));
    await screen.rerender({ year: 2026, show: false });
    await flush();
    await screen.rerender({ year: 2026, show: true });
    const edited = screen.result.current.report;
    expect(edited).not.toBeNull();
    await act(async () => coordinator.analysisRequests.setMonth("2027-10"));
    await screen.rerender({ year: 2027, show: true });
    await flush();
    const calls = calculate.mock.calls.length;
    await act(async () => coordinator.analysisRequests.setMonth("2026-10"));
    await screen.rerender({ year: 2026, show: true });
    expect(screen.result.current.report).toBe(edited);
    await flush();
    expect(calculate).toHaveBeenCalledTimes(calls);
    await screen.unmount();
  });
  it("waits for loaded data and known check settings before background computation", async () => {
    const calculate = jest.spyOn(engine, "buildAnnualAvailableReportSteps");
    mockReady = false;
    const screen = await renderHook(() => useYear(2026, false), { wrapper: Wrapper });
    await flush();
    expect(calculate).not.toHaveBeenCalled();
    mockReady = true;
    mockYouth = null;
    await screen.rerender({});
    await flush();
    expect(calculate).not.toHaveBeenCalled();
    mockYouth = false;
    await screen.rerender({});
    await flush();
    expect(calculate).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });
});
