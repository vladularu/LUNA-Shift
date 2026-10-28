import { act, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useLayoutEffect, type PropsWithChildren } from "react";
import { Text } from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS as mockPattern } from "@/engine/simple-pay";
import { createRuleResolver } from "@/rules/rule-resolver";
import { ActiveMonthProvider, useActiveMonthCoordinator } from "@/navigation/active-month";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import { loadNetPayProfileTimeline } from "@/infrastructure/database/net-pay-profile-repository";
import { netPayProfilesChanged } from "@/infrastructure/database/net-pay-profile-events";
import * as monthly from "./monthly-analysis";
import * as salary from "./analysis-salary";
import * as checks from "@/engine/compliance";
import AnalysisBackgroundPreparation from "./analysis-background-preparation";
import { AnalysisPreparationBoundary } from "./analysis-warmup-provider";
import * as diagnostics from "@/infrastructure/diagnostics";
import { AnalysisSalaryInputsProvider } from "./analysis-salary-inputs";
import { AnalysisMonthDataProvider, useAnalysisMonthData } from "./analysis-month-data";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";

let mockDb = {} as SQLiteDatabase,
  mockReady = true,
  mockDate = "2026-10-28";
let mockProfile = forecastProfile,
  mockResolver = createRuleResolver();
let mockEntries = [7, 8, 9, 10].map((m) =>
  forecastShift({ id: `m${m}`, date: `2026-${String(m).padStart(2, "0")}-05` }),
);
let mockState = "active";
let mockPersistent: PersistentAnalysisCache | null = null;
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
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("expo-router", () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import("react")>("react");
    React.useEffect(callback, [callback]);
  },
}));
jest.mock("./analysis-persistent-results", () => ({
  AnalysisPersistentResultsProvider: ({ children }: PropsWithChildren) => children,
  useAnalysisPersistentResults: () => mockPersistent,
}));
jest.mock("./use-local-reference-date", () => ({ useLocalReferenceDate: () => mockDate }));
jest.mock("@/infrastructure/database/net-pay-profile-repository", () => ({
  loadNetPayProfileTimeline: jest.fn(),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: mockReady, error: null, reload: jest.fn() }),
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
  useCheckPreferences: () => ({
    enabled: true,
    youthEnabled: false,
    error: null,
    retry: jest.fn(),
  }),
}));
jest.mock("./rule-computation", () => ({
  captureRuleComputation: (calculate: () => unknown) => ({ ok: true, value: calculate() }),
}));

const load = jest.mocked(loadNetPayProfileTimeline);
const row = (): SavedMonthlyNetPaySettings => ({
  settings: automatedSettings("2026-01"),
  revision: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
let coordinator: ReturnType<typeof useActiveMonthCoordinator>;
let observed: ReturnType<typeof useAnalysisMonthData>;
let frames: boolean[] = [];
function Coordinator() {
  const value = useActiveMonthCoordinator();
  useLayoutEffect(() => {
    coordinator = value;
  }, [value]);
  return null;
}
function Probe() {
  const value = useAnalysisMonthData();
  useLayoutEffect(() => {
    observed = value;
    frames.push(
      value.monthlyData !== null &&
        value.monthlyCompliance.result !== null &&
        value.salary.result !== null &&
        !value.salary.pending,
    );
  });
  return <Text>Auswertung</Text>;
}
function Scene({ show = false, month = "2026-10" }: { show?: boolean; month?: string }) {
  return (
    <ActiveMonthProvider>
      <>
        <AnalysisBackgroundPreparation />
        <Coordinator />
        {show ? (
          <AnalysisSalaryInputsProvider enabled profile={mockProfile}>
            <AnalysisMonthDataProvider month={month} enabled active distance={0}>
              <Probe />
            </AnalysisMonthDataProvider>
          </AnalysisSalaryInputsProvider>
        ) : (
          <Text>Kalender</Text>
        )}
      </>
    </ActiveMonthProvider>
  );
}
async function flush() {
  for (let i = 0; i < 15; i++)
    await act(async () => {
      jest.runAllTimers();
    });
}
async function foreground(state: string) {
  await act(async () => {
    mockState = state;
    for (const listener of [...mockListeners]) listener(state);
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  startupPresentation.begin();
  mockDb = {} as SQLiteDatabase;
  mockReady = true;
  mockDate = "2026-10-28";
  mockState = "active";
  mockPersistent = null;
  mockProfile = forecastProfile;
  mockResolver = createRuleResolver();
  mockEntries = [7, 8, 9, 10].map((m) =>
    forecastShift({ id: `m${m}`, date: `2026-${String(m).padStart(2, "0")}-05` }),
  );
  frames = [];
  load.mockReset().mockResolvedValue([row()]);
});
afterEach(() => {
  startupPresentation.complete();
  jest.useRealTimers();
  jest.restoreAllMocks();
});
describe("calendar-first analysis preparation", () => {
  it("hydrates saved results before opening the report after a simulated cold restart", async () => {
    const rows = new Map<string, unknown>();
    mockPersistent = {
      read: async (kind, month, key, _resolver, accept) => {
        const value = rows.get(`${kind}:${month}:${key}`);
        return accept(value) ? value : null;
      },
      write: async (kind, month, key, _resolver, value, accept) => {
        if (accept(value)) rows.set(`${kind}:${month}:${key}`, JSON.parse(JSON.stringify(value)));
      },
    };
    const first = await render(<Scene />);
    await act(async () => startupPresentation.complete());
    await flush();
    await first.rerender(<Scene show />);
    const expected = observed.salary.result;
    expect(rows.size).toBe(3);
    await first.unmount();
    mockDb = {} as SQLiteDatabase;
    mockResolver = createRuleResolver();
    frames = [];
    startupPresentation.begin();
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps"),
      payWork = jest.spyOn(salary, "prepareAnalysisSalarySteps"),
      checkWork = jest.spyOn(checks, "calculateMonthlyComplianceSteps");
    const reopened = await render(<Scene />);
    await act(async () => startupPresentation.complete());
    await flush();
    await reopened.rerender(<Scene show />);
    expect(frames[0]).toBe(true);
    expect(observed.salary.result).toEqual(expected);
    expect(monthWork).not.toHaveBeenCalled();
    expect(payWork).not.toHaveBeenCalled();
    expect(checkWork).not.toHaveBeenCalled();
  });
  it("keeps the calendar visible if optional preparation fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const diagnostic = jest.spyOn(diagnostics, "recordDiagnostic");
    function Failure(): never {
      throw new Error("optional preparation");
    }
    const screen = await render(
      <>
        <Text>Kalender</Text>
        <AnalysisPreparationBoundary>
          <Failure />
        </AnalysisPreparationBoundary>
      </>,
    );
    expect(screen.getByText("Kalender")).toBeTruthy();
    expect(diagnostic).toHaveBeenCalledWith(
      "reporting",
      "ANALYSIS_WARMUP_FAILED",
      expect.any(Error),
    );
  });
  it("warms independent month and checks while salary SQL is still pending", async () => {
    let resolve!: (value: readonly SavedMonthlyNetPaySettings[]) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps"),
      checkWork = jest.spyOn(checks, "calculateMonthlyComplianceSteps"),
      payWork = jest.spyOn(salary, "prepareAnalysisSalarySteps");
    await render(<Scene />);
    await act(async () => startupPresentation.complete());
    await flush();
    expect(monthWork).toHaveBeenCalledTimes(1);
    expect(checkWork).toHaveBeenCalledTimes(1);
    expect(payWork).not.toHaveBeenCalled();
    await act(async () => resolve([row()]));
    await flush();
    expect(monthWork).toHaveBeenCalledTimes(1);
    expect(checkWork).toHaveBeenCalledTimes(1);
    expect(payWork).toHaveBeenCalledTimes(1);
  });
  it("keeps equivalent background requests when input references change", async () => {
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps"),
      payWork = jest.spyOn(salary, "prepareAnalysisSalarySteps");
    const screen = await render(<Scene />);
    await act(async () => startupPresentation.complete());
    await act(async () => jest.advanceTimersByTime(20));
    mockEntries = mockEntries.map((entry) => ({ ...entry }));
    mockProfile = { ...mockProfile };
    await screen.rerender(<Scene />);
    await flush();
    expect(monthWork).toHaveBeenCalledTimes(1);
    expect(payWork).toHaveBeenCalledTimes(1);
  });
  it("keeps startup free of analysis reads and opens warmed results on the first report frame", async () => {
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps"),
      payWork = jest.spyOn(salary, "prepareAnalysisSalarySteps"),
      checkWork = jest.spyOn(checks, "calculateMonthlyComplianceSteps");
    const screen = await render(<Scene />);
    await flush();
    expect(screen.getByText("Kalender")).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
    expect(monthWork).not.toHaveBeenCalled();
    await act(async () => startupPresentation.complete());
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(monthWork).toHaveBeenCalledTimes(1);
    expect(payWork).toHaveBeenCalledTimes(1);
    expect(checkWork).toHaveBeenCalledTimes(1);
    await screen.rerender(<Scene show />);
    expect(frames[0]).toBe(true);
    expect(observed.salaryPayments.status).toBe("ready");
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(monthWork).toHaveBeenCalledTimes(1);
    expect(payWork).toHaveBeenCalledTimes(1);
    expect(checkWork).toHaveBeenCalledTimes(1);
  });
  it("prepares an edited duty while calendar is visible without restarting work when report opens", async () => {
    const screen = await render(<Scene />);
    await act(async () => startupPresentation.complete());
    await flush();
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps"),
      payWork = jest.spyOn(salary, "prepareAnalysisSalarySteps"),
      checkWork = jest.spyOn(checks, "calculateMonthlyComplianceSteps");
    mockEntries = mockEntries.map((entry) =>
      entry.date.startsWith("2026-10") ? { ...entry, endTime: "23:00" } : entry,
    );
    await screen.rerender(<Scene />);
    await flush();
    expect(monthWork).toHaveBeenCalledTimes(1);
    expect(payWork).toHaveBeenCalledTimes(1);
    expect(checkWork).toHaveBeenCalledTimes(1);
    await screen.rerender(<Scene show />);
    expect(frames[0]).toBe(true);
    await flush();
    expect(monthWork).toHaveBeenCalledTimes(1);
    expect(payWork).toHaveBeenCalledTimes(1);
    expect(checkWork).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("takes over a running warm request instead of creating another monthly calculation", async () => {
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps"),
      payWork = jest.spyOn(salary, "prepareAnalysisSalarySteps");
    const screen = await render(<Scene />);
    await act(async () => startupPresentation.complete());
    for (let i = 0; i < 40 && monthWork.mock.calls.length === 0; i++)
      await act(async () => {
        jest.advanceTimersToNextTimer();
      });
    expect(monthWork).toHaveBeenCalledTimes(1);
    await act(async () => {
      coordinator.analysisRequests.setMonth("2026-10");
    });
    await screen.rerender(<Scene show />);
    await flush();
    expect(observed.monthlyData).not.toBeNull();
    expect(observed.salary.result).not.toBeNull();
    expect(monthWork).toHaveBeenCalledTimes(1);
    expect(payWork).toHaveBeenCalledTimes(1);
  });
  it("keeps a complete 2027 net snapshot without loosening the persistent success policy", async () => {
    mockEntries = [forecastShift({ id: "future", date: "2027-01-05" })];
    const screen = await render(<Scene />);
    await act(async () => {
      coordinator.analysisRequests.setMonth("2027-01");
      startupPresentation.complete();
    });
    await flush();
    const payWork = jest.spyOn(salary, "prepareAnalysisSalarySteps");
    await screen.rerender(<Scene show month="2027-01" />);
    expect(frames[0]).toBe(true);
    expect(observed.salary.result?.annual.proposal).toBeNull();
    await flush();
    expect(payWork).not.toHaveBeenCalled();
  });
  it("pauses preparation while inactive and refreshes settings when returning", async () => {
    const screen = await render(<Scene />);
    await act(async () => startupPresentation.complete());
    await flush();
    await foreground("background");
    const monthWork = jest.spyOn(monthly, "calculateMonthlyAnalysisSteps");
    mockEntries = mockEntries.map((entry) => ({ ...entry, endTime: "23:00" }));
    await screen.rerender(<Scene />);
    await flush();
    expect(monthWork).not.toHaveBeenCalled();
    await foreground("active");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(monthWork).toHaveBeenCalledTimes(1);
  });
  it("drops stale settings immediately and reuses one new salary computation after a committed edit", async () => {
    const screen = await render(<Scene />);
    await act(async () => startupPresentation.complete());
    await flush();
    await screen.rerender(<Scene show />);
    const payWork = jest.spyOn(salary, "prepareAnalysisSalarySteps"),
      changed = row();
    load.mockResolvedValue([
      {
        ...changed,
        settings: { ...changed.settings, profile: { ...changed.settings.profile, taxClass: 4 } },
      },
    ]);
    await act(async () => netPayProfilesChanged(mockDb));
    await flush();
    expect(payWork).toHaveBeenCalledTimes(1);
    expect(observed.salaryPayments.saved?.settings.profile.taxClass).toBe(4);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
