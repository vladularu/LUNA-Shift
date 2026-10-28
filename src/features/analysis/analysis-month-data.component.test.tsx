import { act, render, renderHook } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useLayoutEffect, type PropsWithChildren } from "react";
import type { SQLiteDatabase } from "expo-sqlite";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { loadNetPayProfileTimeline } from "@/infrastructure/database/net-pay-profile-repository";
import { AnalysisSalaryInputsProvider, useAnalysisSalaryInputs } from "./analysis-salary-inputs";
import { AnalysisMonthDataProvider, useAnalysisMonthData } from "./analysis-month-data";
import * as salary from "./analysis-salary";
import { calendarPerformance } from "@/application/calendar-performance";
import { netPayProfilesChanged } from "@/infrastructure/database/net-pay-profile-events";

let mockDb = {} as SQLiteDatabase;
let mockProfile = forecastProfile;
let mockEnabled = true;
let mockFocused = true;
let mockResolver = { ...bundledRuleResolver };
let mockEntries = [forecastShift({ id: "january", date: "2027-01-05" })];
const mockDecisions = Object.freeze([]),
  mockTestMonths = Object.freeze([]);
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("expo-router", () => ({
  useIsFocused: () => mockFocused,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import("react")>("react");
    React.useEffect(callback, [callback]);
  },
}));
jest.mock("@/infrastructure/database/net-pay-profile-repository", () => ({
  loadNetPayProfileTimeline: jest.fn(),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
  usePflegeShiftProfile: () => ({ profile: mockProfile, calculationProfile: null }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: mockDecisions,
    workPatternSettings:
      jest.requireActual<typeof import("@/engine/simple-pay")>("@/engine/simple-pay")
        .DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  }),
  usePflegeShiftTestData: () => ({ testMonths: mockTestMonths }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({
    resolver: mockResolver,
  }),
}));
jest.mock("./use-local-reference-date", () => ({ useLocalReferenceDate: () => "2026-10-28" }));
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({
    enabled: true,
    youthEnabled: false,
    error: null,
    retry: jest.fn(),
  }),
}));

const load = jest.mocked(loadNetPayProfileTimeline);
const row = (month: string): SavedMonthlyNetPaySettings => ({
  settings: automatedSettings(month),
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
function Inputs({ children }: PropsWithChildren) {
  return (
    <AnalysisSalaryInputsProvider enabled={mockEnabled} profile={mockProfile}>
      {children}
    </AnalysisSalaryInputsProvider>
  );
}
beforeEach(() => {
  mockDb = {} as SQLiteDatabase;
  mockProfile = forecastProfile;
  mockEnabled = true;
  mockFocused = true;
  mockResolver = { ...bundledRuleResolver };
  mockEntries = [forecastShift({ id: "january", date: "2027-01-05" })];
  load.mockReset();
  load.mockResolvedValue([row("2026-01"), row("2026-10")]);
});
afterEach(() => {
  calendarPerformance.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("shared fresh salary inputs", () => {
  it("loads once for multiple months and resolves dated settings across years", async () => {
    const hook = await renderHook(
      () => [
        useAnalysisSalaryInputs("2026-09", true),
        useAnalysisSalaryInputs("2026-11", true),
        useAnalysisSalaryInputs("2027-01", true),
      ],
      { wrapper: Inputs },
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(hook.result.current.map((value) => value.saved?.settings.month)).toEqual([
      "2026-01",
      "2026-10",
      "2026-10",
    ]);
    expect(hook.result.current[0].annualPayments).toBe(hook.result.current[2].annualPayments);
    await hook.rerender(undefined);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("reuses the loaded timeline for a new month without another query", async () => {
    const hook = await renderHook(
      ({ month }: { month: string }) => useAnalysisSalaryInputs(month, true),
      { wrapper: Inputs, initialProps: { month: "2026-09" } },
    );
    await hook.rerender({ month: "2026-12" });
    expect(hook.result.current.saved?.settings.month).toBe("2026-10");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("discards a changed timeline before another focus session can show old settings", async () => {
    const hook = await renderHook(() => useAnalysisSalaryInputs("2026-11", true), {
      wrapper: Inputs,
    });
    mockEnabled = false;
    await hook.rerender(undefined);
    expect(hook.result.current.status).toBe("loading");
    let resolve!: (value: readonly SavedMonthlyNetPaySettings[]) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    await act(async () => {
      netPayProfilesChanged(mockDb);
    });
    mockEnabled = true;
    await hook.rerender(undefined);
    expect(hook.result.current.status).toBe("loading");
    expect(hook.result.current.saved).toBeNull();
    await act(async () => resolve([row("2026-11")]));
    expect(hook.result.current.saved?.settings.month).toBe("2026-11");
  });
  it("reuses an unchanged ready timeline immediately when analysis regains focus", async () => {
    const hook = await renderHook(() => useAnalysisSalaryInputs("2026-11", true), {
      wrapper: Inputs,
    });
    mockEnabled = false;
    await hook.rerender(undefined);
    mockEnabled = true;
    await hook.rerender(undefined);
    expect(hook.result.current.status).toBe("ready");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("ignores an old database result after switching database and profile", async () => {
    let resolve!: (value: readonly SavedMonthlyNetPaySettings[]) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    const hook = await renderHook(() => useAnalysisSalaryInputs("2026-11", true), {
      wrapper: Inputs,
    });
    mockDb = {} as SQLiteDatabase;
    mockProfile = { ...forecastProfile, weeklyMinutes: 1800 };
    load.mockResolvedValueOnce([row("2026-11")]);
    await hook.rerender(undefined);
    await act(async () => resolve([row("2026-01")]));
    expect(hook.result.current.saved?.settings.month).toBe("2026-11");
  });
  it("does not read while disabled and retries a failed read in a fresh session", async () => {
    mockEnabled = false;
    const hook = await renderHook(() => useAnalysisSalaryInputs("2026-11", true), {
      wrapper: Inputs,
    });
    expect(load).not.toHaveBeenCalled();
    load.mockRejectedValueOnce(new Error("temporary database failure"));
    mockEnabled = true;
    await hook.rerender(undefined);
    expect(hook.result.current.status).toBe("error");
    mockEnabled = false;
    await hook.rerender(undefined);
    mockEnabled = true;
    await hook.rerender(undefined);
    expect(hook.result.current.status).toBe("ready");
  });
});

let observed: ReturnType<typeof useAnalysisMonthData> | null = null;
function Probe() {
  const data = useAnalysisMonthData();
  useLayoutEffect(() => {
    observed = data;
  }, [data]);
  return null;
}
function Month({
  visible,
  active = false,
  distance = 2,
}: {
  visible: boolean;
  active?: boolean;
  distance?: number;
}) {
  return (
    <Inputs>
      <AnalysisMonthDataProvider
        month="2027-01"
        enabled={mockEnabled}
        active={active}
        distance={distance}
      >
        {visible ? <Probe /> : null}
      </AnalysisMonthDataProvider>
    </Inputs>
  );
}
const drain = async () => {
  for (let phase = 0; phase < 6; phase++)
    await act(async () => {
      jest.runAllTimers();
    });
};

describe("headless complete month handoff", () => {
  it("cancels outstanding preparations when analysis loses focus", async () => {
    jest.useFakeTimers();
    calendarPerformance.start(true);
    load.mockResolvedValue([row("2027-01")]);
    const screen = await render(<Month visible={false} />);
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    mockFocused = false;
    await screen.rerender(<Month visible={false} />);
    await drain();
    const work = calendarPerformance
      .report()
      .events.filter((event) => event.kind === "analysis-work");
    expect(work.filter((event) => event.values.state === 2).length).toBeGreaterThanOrEqual(2);
    expect(work.filter((event) => event.values.state === 1)).toHaveLength(0);
  });
  it("keeps a fully prepared year without an annual proposal when its page becomes visible", async () => {
    jest.useFakeTimers();
    observed = null;
    load.mockResolvedValue([row("2027-01")]);
    const calculate = jest.spyOn(salary, "prepareAnalysisSalarySteps");
    const screen = await render(<Month visible={false} />);
    await drain();
    expect(calculate).toHaveBeenCalledTimes(1);
    const [request, key] = calculate.mock.calls[0];
    expect(salary.readAnalysisSalary(request, key)).toBeNull();
    await screen.rerender(<Month visible distance={1} />);
    const ready = observed!;
    expect(ready.salary.pending).toBe(false);
    expect(ready.salary.result?.annual.proposal).toBeNull();
    expect(ready.salary.result?.forecast?.result.status).toBe("available");
    expect(ready.monthlyCompliance.result).not.toBeNull();
    await screen.rerender(<Month visible active distance={0} />);
    expect(observed!.salary.result).toBe(ready.salary.result);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("clears prepared amounts on an entry edit without re-reading unchanged settings", async () => {
    jest.useFakeTimers();
    observed = null;
    load.mockResolvedValue([row("2027-01")]);
    const screen = await render(<Month visible active distance={0} />);
    await drain();
    const first = observed!;
    expect(first.monthlyData?.summary.ok).toBe(true);
    mockEntries = mockEntries.map((entry) => ({ ...entry, endTime: "08:00" }));
    await screen.rerender(<Month visible active distance={0} />);
    expect(observed!.salary.result).toBeNull();
    await drain();
    expect(observed!.monthlyData?.summary).not.toEqual(first.monthlyData?.summary);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
