import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { AnnualDetailsScreen } from "./annual-details-screen";
import { WorktimeDetailsScreen } from "./worktime-details-screen";
import { ComplianceDetailsScreen } from "./compliance-details-screen";
import * as MockReact from "react";
import type { ReactElement } from "react";

import holidayPackageValue from "../../../rules/packages/reviewed/de-holidays/2026.json";
import futureHolidayPackageValue from "../../../rules/packages/reviewed/de-holidays/2027.json";
import legalPackageValue from "../../../rules/packages/reviewed/de-arbzg-care/2026-01.json";
import tariffPackageValue from "../../../rules/packages/reviewed/tvoed-vka-bt-k/2026-05.json";
import type { MonthlyComplianceResult, ShiftEntry, UserProfile } from "@/domain/types";
import * as monthlyAnalysis from "./monthly-analysis";
import { useDeferredMonthlyCompliance } from "./use-monthly-compliance";
import { AnalysisScreen } from "@/features/analysis/analysis-screen";
import { buildAnnualCoreReport } from "@/features/analysis/annual-core-report";
import type { AnnualReport } from "@/features/analysis/annual-report";
import { PremiumDetailsScreen } from "@/features/analysis/premium-details-screen";
import { TariffAssessmentScreen } from "@/features/analysis/tariff-assessment-screen";
import { SalaryScreen } from "@/features/salary/salary-screen";
import { SalaryDetailsScreen } from "@/features/salary/salary-details-screen";
import type {
  RuleHolidayPackage,
  RuleLegalPackage,
  RuleTariffPackage,
} from "@/rules/contracts.generated";
import { createRuleResolver, RuleResolutionError, type RuleResolver } from "@/rules/rule-resolver";
import { AppErrorBoundary } from "@/ui/app-error-boundary";
import { currentMonth } from "@/engine/calendar";
const mockSaveEmployment = jest.fn();
// These assertions exercise real rule results; cooperative scheduling has dedicated lifecycle tests.
jest.mock("@/features/analysis/use-prepared-monthly-analysis", () => ({
  usePreparedMonthlyAnalysis: (
    request: import("./monthly-analysis").MonthlyAnalysisRequest | null,
    active: boolean,
  ) => {
    const actual = jest.requireActual<typeof import("./monthly-analysis")>("./monthly-analysis");
    return MockReact.useMemo(
      () =>
        request === null
          ? null
          : active
            ? actual.calculateMonthlyAnalysis(
                request.month,
                request.entries,
                request.profile,
                request.tariffDecisions,
                request.workPatternSettings,
                request.ruleResolver,
              )
            : (() => {
                const cached = actual.getCachedMonthlyAnalysis(request);
                if (cached !== null) return cached;
                const steps = actual.calculateMonthlyAnalysisSteps(request);
                while (true) {
                  const next = steps.next();
                  if (next.done) return next.value;
                }
              })(),
      [request, active],
    );
  },
}));
jest.mock("@/features/report-export/report-export-button", () => ({
  ReportExportButton: () => null,
}));

// Native modal inset measurements are outside the JS renderer's layout coverage.
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual<typeof import("react-native-safe-area-context")>(
    "react-native-safe-area-context",
  ),
  SafeAreaProvider: ({ children }: MockReact.PropsWithChildren) => children,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

const GENERATION_ONE_REVIEWED_RESOLVER = createRuleResolver(
  {
    tariff: [tariffPackageValue as RuleTariffPackage],
    legal: [legalPackageValue as RuleLegalPackage],
    holiday: [holidayPackageValue as RuleHolidayPackage],
  },
  {
    tariff: "tvoed-vka-bt-k",
    legal: "de-arbzg-care",
    holiday: "de-holidays",
  },
);

const FUTURE_HOLIDAY_TARIFF_EXPIRY_RESOLVER = createRuleResolver(
  {
    tariff: [tariffPackageValue as RuleTariffPackage],
    legal: [legalPackageValue as RuleLegalPackage],
    holiday: [
      holidayPackageValue as RuleHolidayPackage,
      futureHolidayPackageValue as RuleHolidayPackage,
    ],
  },
  {
    tariff: "tvoed-vka-bt-k",
    legal: "de-arbzg-care",
    holiday: "de-holidays",
  },
);

const FUTURE_HOLIDAY_MISSING_LEGAL_RESOLVER = createRuleResolver(
  {
    tariff: [tariffPackageValue as RuleTariffPackage],
    legal: [],
    holiday: [
      holidayPackageValue as RuleHolidayPackage,
      futureHolidayPackageValue as RuleHolidayPackage,
    ],
  },
  {
    tariff: "tvoed-vka-bt-k",
    legal: "de-arbzg-care",
    holiday: "de-holidays",
  },
);

const MOCK_TARIFF_PROFILE: UserProfile = {
  federalState: "NW",
  holidayRegion: "NONE",
  weeklyMinutes: 2_310,
  timeZone: "Europe/Berlin",
  regularRotatingNightWork: false,
  sundayHolidayWorkEligible: true,
  allEmploymentWorkRecorded: true,
  tariff: {
    payGroup: "P8",
    payLevel: 4,
    sector: "BT_K",
    tariffRegion: "OTHER",
    fullTimeWeeklyMinutes: 2_310,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
let mockProfile: UserProfile = MOCK_TARIFF_PROFILE;

const mockCompliance: MonthlyComplianceResult = {
  month: "2027-01",
  criticalCount: 0,
  warningCount: 0,
  infoCount: 0,
  affectedDates: [],
  issues: [],
};

let mockComplianceResult: MonthlyComplianceResult | null = mockCompliance;
let mockCheckError: string | null = null;
let mockEntries: readonly ShiftEntry[] = [];
let mockRuleResolver: RuleResolver = GENERATION_ONE_REVIEWED_RESOLVER;
let mockRouteMonth = "2027-01";
let mockRoutePeriod: "MONTH" | "YEAR" | undefined;
let mockActivePeriod: "MONTH" | "YEAR" = "MONTH";
let mockAnnualSection: string | undefined;
let mockAnnualFatalError: Error | null = null;
let mockAnnualInputFailure: {
  readonly ok: false;
  readonly error: RuleResolutionError;
  readonly failure: RuleResolutionError["failure"];
} | null = null;
let mockAnnualReportValue: AnnualReport | null = null;
let mockAnnualCoreValue: AnnualReport | null = null;
let mockAnnualRuleFailure: {
  readonly ok: false;
  readonly error: RuleResolutionError;
  readonly failure: RuleResolutionError["failure"];
} | null = null;

let mockFocused = true;
const mockTariffDecisions = Object.freeze([]);
const mockWorkPatternSettings = {
  workplaceCoverage: "UNKNOWN",
  assignment: "UNKNOWN",
  updatedAt: null,
};
let mockAnalysisRequest = 0;
let mockAnalysisMonth: string | null = null;
jest.mock("@/features/salary/use-net-pay-profile", () => ({
  useNetPayProfile: () => ({
    status: "ready",
    saved: null,
    timeline: [],
    busy: false,
    error: null,
  }),
}));
// Input freshness and cross-month sharing are exercised with the real provider in its lifecycle tests.
jest.mock("./analysis-persistent-results", () => ({
  AnalysisPersistentResultsProvider: ({ children }: MockReact.PropsWithChildren) => children,
  useAnalysisPersistentResults: () => null,
}));
jest.mock("./analysis-salary-inputs", () => ({
  AnalysisSalaryInputsProvider: ({ children }: MockReact.PropsWithChildren) => children,
  useAnalysisSalaryInputs: () => ({
    status: "ready",
    saved: null,
    annualPayments: [],
    error: null,
  }),
}));
const mockActiveMonthCoordinator = {
  analysisRequests: {
    getRevision: () => mockAnalysisRequest,
    getMonth: () => mockAnalysisMonth,
    setMonth: jest.fn((month: string) => {
      mockAnalysisMonth = month;
    }),
    getPeriod: () => mockActivePeriod,
    setPeriod: (period: "MONTH" | "YEAR") => {
      mockActivePeriod = period;
    },
    subscribe: () => () => {},
  },
  getMonth: () => mockRouteMonth,
  setMonth: jest.fn((month: string) => month),
};

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  router: {
    back: jest.fn(),
    push: jest.fn(),
    setParams: jest.fn((next: { month: string; period: "MONTH" | "YEAR" }) => {
      mockRouteMonth = next.month;
      mockRoutePeriod = next.period;
    }),
  },
  useFocusEffect: (effect: () => void | (() => void)) =>
    MockReact.useEffect(() => (mockFocused ? effect() : undefined), [effect, mockFocused]),
  useIsFocused: () => mockFocused,
  useLocalSearchParams: () => ({
    month: mockRouteMonth,
    period: mockRoutePeriod,
    section: mockAnnualSection,
  }),
}));

jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftProfile: () => ({ profile: mockProfile, updateProfile: mockSaveEmployment }),
  usePflegeShiftStatus: () => ({ error: null, ready: true, reload: jest.fn() }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: mockTariffDecisions,
    workPatternSettings: mockWorkPatternSettings,
    updateWorkPatternSettings: jest.fn(),
    upsertTariffDecision: jest.fn(),
  }),
  usePflegeShiftTestData: () => ({ testMonths: [] }),
}));

jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockRuleResolver }),
}));

jest.mock("@/features/analysis/use-monthly-compliance", () => ({
  useDeferredMonthlyCompliance: jest.fn(() => ({
    error: mockCheckError,
    result: mockComplianceResult,
    retry: jest.fn(),
  })),
}));

// Queue lifecycle is tested separately; keep rule-coverage assertions deterministic and real.
jest.mock("@/features/analysis/use-prepared-analysis-salary", () => ({
  usePreparedAnalysisSalary: (
    request: import("./analysis-salary").AnalysisSalaryRequest | null,
  ) => ({
    result: request
      ? {
          annual: jest
            .requireActual<typeof import("@/features/salary/annual-salary-forecast")>(
              "@/features/salary/annual-salary-forecast",
            )
            .annualSalaryForecast(
              Number(request.month.slice(0, 4)),
              request.profile,
              request.context,
              request.annualPayments,
            ),
          forecast: null,
        }
      : null,
    pending: false,
    error: null,
  }),
}));

jest.mock("@/features/analysis/use-annual-report-inputs", () => ({
  useAnnualReportInputs: () =>
    mockAnnualInputFailure ?? {
      ok: true,
      value: {
        entries: [],
        rangeEnd: "2026-12-31",
        rangeStart: "2026-01-01",
        tariffDecisions: [],
        year: 2026,
      },
    },
}));

jest.mock("@/features/analysis/use-simple-annual-report", () => ({
  useSimpleAnnualReport: () => ({
    error: null,
    fatalError: mockAnnualFatalError,
    report: mockAnnualReportValue,
    coreReport: mockAnnualCoreValue,
    retry: jest.fn(),
    ruleFailure: mockAnnualRuleFailure,
  }),
}));

jest.mock("@/navigation/active-month", () => ({
  useActiveMonthCoordinator: () => mockActiveMonthCoordinator,
}));

function januaryShift(): ShiftEntry {
  return {
    kind: "SHIFT",
    id: "january-shift",
    date: "2027-01-03",
    templateId: null,
    title: "Sonntagsdienst",
    type: "DAY",
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 30,
    color: "#207A68",
    symbol: "D",
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function expectPartialAnalysisShell(
  screen: Awaited<ReturnType<typeof render>>,
  salaryUnavailable = true,
) {
  expect(screen.getByTestId("analysis-month-toolbar")).toBeTruthy();
  if (salaryUnavailable) {
    expect(screen.getByRole("button", { name: /Gehalt, Nicht verfügbar/ })).toBeTruthy();
  } else {
    expect(screen.queryByRole("button", { name: /Gehalt, Nicht verfügbar/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Gehalt, \d/ })).toBeTruthy();
  }
  expect(screen.getByLabelText("Soll: Nicht verfügbar")).toBeTruthy();
  expect(screen.getByLabelText("Stundensaldo: Nicht verfügbar")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Diagnosecode: RULE_PACKAGE_NOT_FOUND")).toBeNull();
  expect(screen.queryByText("LUNA Shift konnte nicht angezeigt werden")).toBeNull();
}

async function expectRuleCoverageDiagnostic(component: ReactElement) {
  mockEntries = [januaryShift()];
  const screen = await render(component);

  expect(screen.getByText("Diagnosecode: RULE_PACKAGE_NOT_FOUND")).toBeTruthy();
  expect(screen.queryByText("LUNA Shift konnte nicht angezeigt werden")).toBeNull();
}

async function followNativePeriod(screen: Awaited<ReturnType<typeof render>>) {
  const route = jest.mocked(router.push).mock.calls.at(-1)?.[0] as {
    pathname: string;
    params: { month: string; period: "MONTH" | "YEAR" };
  };
  expect(route.pathname).toBe("/(tabs)/(analysis)/period");
  mockRouteMonth = route.params.month;
  mockRoutePeriod = route.params.period;
  await screen.rerender(
    mockAnnualFatalError ? (
      <AppErrorBoundary>
        <AnalysisScreen />
      </AppErrorBoundary>
    ) : (
      <AnalysisScreen />
    ),
  );
}
async function openAnalysisMode(screen: Awaited<ReturnType<typeof render>>, label: string) {
  await fireEvent.press(screen.getByLabelText(label));
  await followNativePeriod(screen);
}

describe("reviewed Generation 1 rule coverage in analysis screens", () => {
  beforeEach(() => {
    mockComplianceResult = mockCompliance;
    mockCheckError = null;
    mockEntries = [];
    mockFocused = true;
    mockAnalysisRequest = 0;
    mockAnalysisMonth = null;
    mockRoutePeriod = undefined;
    mockActivePeriod = "MONTH";
    mockRuleResolver = GENERATION_ONE_REVIEWED_RESOLVER;
    mockRouteMonth = "2027-01";
    mockAnnualSection = undefined;
    mockAnnualFatalError = null;
    mockAnnualInputFailure = null;
    mockAnnualReportValue = null;
    mockAnnualCoreValue = null;
    mockAnnualRuleFailure = null;
    mockProfile = MOCK_TARIFF_PROFILE;
    mockActiveMonthCoordinator.setMonth.mockClear();
    mockActiveMonthCoordinator.analysisRequests.setMonth.mockClear();
  });

  it("does not calculate a hidden month and uses the latest month when focused again", async () => {
    const calculate = jest.spyOn(monthlyAnalysis, "calculateMonthlyAnalysis");
    mockFocused = false;
    mockRouteMonth = "2026-09";
    const screen = await render(<AnalysisScreen />);
    expect(calculate).not.toHaveBeenCalled();
    mockEntries = [januaryShift()];
    mockRouteMonth = "2026-10";
    await screen.rerender(<AnalysisScreen />);
    expect(calculate).not.toHaveBeenCalled();
    mockFocused = true;
    await screen.rerender(<AnalysisScreen />);
    expect(calculate).toHaveBeenCalled();
    expect(calculate.mock.calls.at(-1)?.[0]).toBe("2026-10");
    await screen.unmount();
  });

  it("prioritizes changed visible data while retaining both prepared native swipe pages", async () => {
    mockRouteMonth = "2026-09";
    const calculate = jest.spyOn(monthlyAnalysis, "calculateMonthlyAnalysis");
    const screen = await render(<AnalysisScreen />);
    await fireEvent(screen.getByTestId("report-period-pager"), "layout", {
      nativeEvent: { layout: { width: 390, height: 700 } },
    });
    for (const month of ["2026-08", "2026-10"]) {
      expect(
        screen.getByTestId(`analysis-month-page-${month}`, { includeHiddenElements: true }),
      ).toBeTruthy();
    }
    calculate.mockClear();
    mockEntries = [{ ...januaryShift(), date: "2026-09-03" }];
    await screen.rerender(<AnalysisScreen />);
    expect(calculate.mock.calls[0]?.[0]).toBe("2026-09");
    expect(screen.getByLabelText("Ist: 7:30 h")).toBeTruthy();
    const checks = jest.mocked(useDeferredMonthlyCompliance);
    expect(
      checks.mock.calls
        .filter(([request]) => request.enabled && (request.priority ?? 0) < 0)
        .every(([request]) => request.month === "2026-09"),
    ).toBe(true);
    await waitFor(() =>
      expect(
        checks.mock.calls.some(
          ([request]) => request.month === "2026-08" && request.enabled && request.priority === 0,
        ),
      ).toBe(true),
    );
    checks.mockClear();
    await fireEvent(screen.getByTestId("report-period-scroll"), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: 13 * 390, y: 0 } },
    });
    expect(screen.getByTestId("analysis-month-page-2026-10")).toBeTruthy();
    expect(screen.getByLabelText("Ist: 0:00 h")).toBeTruthy();
    expect(
      checks.mock.calls.some(([request]) => request.enabled && request.month === "2026-10"),
    ).toBe(true);
    expect(
      checks.mock.calls
        .filter(([request]) => request.enabled && (request.priority ?? 0) < 0)
        .every(([request]) => request.month === "2026-10"),
    ).toBe(true);
  });

  it("returns a reselected monthly analysis to the current month while retaining monthly mode", async () => {
    mockRouteMonth = "2030-01";
    const screen = await render(<AnalysisScreen />);
    mockAnalysisRequest += 1;
    await screen.rerender(<AnalysisScreen />);
    const present = currentMonth(mockProfile.timeZone);
    expect(mockActiveMonthCoordinator.analysisRequests.setMonth).toHaveBeenLastCalledWith(present);
    expect(screen.getByTestId("analysis-month-toolbar")).toBeTruthy();
    expect(screen.queryByTestId("analysis-year-toolbar")).toBeNull();
  });

  it("pages months and years in both chronological directions without native route pushes", async () => {
    mockRouteMonth = "2030-12";
    const screen = await render(<AnalysisScreen />);
    const measure = () =>
      fireEvent(screen.getByTestId("report-period-pager"), "layout", {
        nativeEvent: { layout: { width: 390, height: 700 } },
      });
    const settle = (index: number) =>
      fireEvent(screen.getByTestId("report-period-scroll"), "momentumScrollEnd", {
        nativeEvent: { contentOffset: { x: index * 390, y: 0 } },
      });
    const calls = jest.mocked(router.push).mock.calls.length;
    await measure();
    await settle(13);
    expect(screen.getByTestId("analysis-month-page-2031-01")).toBeTruthy();
    await settle(11);
    expect(screen.getByTestId("analysis-month-page-2030-11")).toBeTruthy();
    expect(router.push).toHaveBeenCalledTimes(calls);
    await openAnalysisMode(screen, "Jahresauswertung öffnen");
    await measure();
    await settle(11);
    expect(screen.getByLabelText("Vorheriges Jahr, aktuell 2029")).toBeTruthy();
    await settle(13);
    expect(screen.getByLabelText("Vorheriges Jahr, aktuell 2031")).toBeTruthy();
  });

  it("keeps the source report until native paging settles, then exposes the target's explicit check error", async () => {
    mockRouteMonth = "2026-09";
    mockEntries = [{ ...januaryShift(), date: "2026-09-03" }];
    const screen = await render(<AnalysisScreen />);
    await fireEvent(screen.getByTestId("report-period-pager"), "layout", {
      nativeEvent: { layout: { width: 390, height: 700 } },
    });
    expect(screen.getByLabelText("Ist: 7:30 h")).toBeTruthy();
    mockComplianceResult = null;
    await fireEvent.press(screen.getByRole("button", { name: /Nächster Monat/ }));
    expect(screen.getByTestId("analysis-month-page-2026-09")).toBeTruthy();
    expect(
      screen.getByTestId("analysis-month-page-2026-10", { includeHiddenElements: true }),
    ).toBeTruthy();
    mockCheckError = "Prüfung fehlgeschlagen";
    await screen.rerender(<AnalysisScreen />);
    await fireEvent(screen.getByTestId("report-period-scroll"), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: 13 * 390, y: 0 } },
    });
    expect(screen.getByTestId("analysis-month-page-2026-10")).toBeTruthy();
    expect(screen.getByLabelText("Ist: 0:00 h")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prüfung, Nicht verfügbar" })).toBeTruthy();
  });

  it("returns a reselected yearly analysis to the current year and preserves its mode and month selection", async () => {
    mockRouteMonth = "2030-03";
    const screen = await render(<AnalysisScreen />);
    await openAnalysisMode(screen, "Jahresauswertung öffnen");
    mockAnalysisRequest += 1;
    await screen.rerender(<AnalysisScreen />);
    const presentYear = currentMonth(mockProfile.timeZone).slice(0, 4);
    expect(mockActiveMonthCoordinator.analysisRequests.setMonth).toHaveBeenLastCalledWith(
      `${presentYear}-03`,
    );
    expect(screen.getByTestId("analysis-year-toolbar")).toBeTruthy();
    expect(screen.getByLabelText(`Vorheriges Jahr, aktuell ${presentYear}`)).toBeTruthy();
    expect(screen.queryByTestId("analysis-month-toolbar")).toBeNull();
    await openAnalysisMode(screen, "Monatsauswertung öffnen");
    expect(screen.getByTestId(`analysis-month-page-${presentYear}-03`)).toBeTruthy();
  });

  it("retains a tab-reset request while a detail page is focused and applies it when the overview returns", async () => {
    mockRouteMonth = "2030-03";
    const screen = await render(<AnalysisScreen />);
    mockFocused = false;
    await screen.rerender(<AnalysisScreen />);
    mockActiveMonthCoordinator.analysisRequests.setMonth.mockClear();
    mockAnalysisRequest += 1;
    await screen.rerender(<AnalysisScreen />);
    expect(mockActiveMonthCoordinator.analysisRequests.setMonth).not.toHaveBeenCalled();
    mockFocused = true;
    await screen.rerender(<AnalysisScreen />);
    const present = currentMonth(mockProfile.timeZone);
    expect(mockActiveMonthCoordinator.analysisRequests.setMonth).toHaveBeenLastCalledWith(present);
    expect(screen.getByTestId(`analysis-month-page-${present}`)).toBeTruthy();
  });

  it.each([
    ["Prüfung", "/compliance-details"],
    ["Gehalt", "/salary"],
  ])("opens %s for the selected month and keeps return navigation", async (title, pathname) => {
    mockRouteMonth = "2026-09";
    const screen = await render(<AnalysisScreen />);
    const name = new RegExp(`^${title},`);
    await fireEvent.press(screen.getByRole("button", { name }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname, params: { month: "2026-09" } });
    mockFocused = false;
    await screen.rerender(<AnalysisScreen />);
    mockRouteMonth = "2026-10";
    mockFocused = true;
    await screen.rerender(<AnalysisScreen />);
    await fireEvent.press(screen.getByRole("button", { name }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname, params: { month: "2026-10" } });
  });

  it("shows pending and failed checks without hiding hours or inventing a clear result", async () => {
    mockRouteMonth = "2026-09";
    mockEntries = [{ ...januaryShift(), id: "pending-shift", date: "2026-09-03" }];
    mockComplianceResult = null;
    const screen = await render(<AnalysisScreen />);
    expect(screen.getByRole("button", { name: "Prüfung, Wird geprüft …" })).toBeTruthy();
    expect(screen.getByText("Arbeitszeit")).toBeTruthy();
    expect(screen.queryByText("Keine sichtbaren Auffälligkeiten")).toBeNull();
    mockCheckError = "Prüfung fehlgeschlagen";
    await screen.rerender(<AnalysisScreen />);
    expect(screen.getByRole("button", { name: "Prüfung, Nicht verfügbar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Gehalt,/ })).toBeTruthy();
  });

  it("opens time premiums for a tariff month without shifts", async () => {
    mockRouteMonth = "2026-09";
    const screen = await render(<SalaryScreen />);
    await openSalaryComponents(screen, "2026-09");
    await openSalaryServicesFromOverview(screen, "2026-09");
    expect(
      screen.getByLabelText(
        "Keine Zeitzuschläge. In diesem Monat wurden keine Zeitzuschläge berechnet.",
      ),
    ).toBeTruthy();
  });

  it("explains a direct premium link for manual salary without inventing zeros", async () => {
    mockProfile = { ...MOCK_TARIFF_PROFILE, tariff: null, manualMonthlyGrossCents: 320000 };
    const screen = await render(<PremiumDetailsScreen />);
    expect(screen.getByText("Keine tarifliche Berechnung")).toBeTruthy();
    expect(screen.queryByText("0,00 €")).toBeNull();
  });

  it("shows nursing trainee salary components in the overview instead of manual salary", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
    };
    const screen = await render(<AnalysisScreen />);
    expect(screen.getByText("Grundgehalt")).toBeTruthy();
    expect(screen.getByLabelText(/^Grundgehalt: 1\.490,69/)).toBeTruthy();
    expect(screen.getByText("Zeitzuschläge")).toBeTruthy();
    expect(screen.getByText("Brutto geschätzt")).toBeTruthy();
    expect(screen.getByText("Unverbindliche Schätzung")).toBeTruthy();
    expect(screen.queryByText("Monatsbrutto")).toBeNull();
    expect(screen.queryByText("Manuell hinterlegtes Monatsbrutto")).toBeNull();
  });

  it("opens calculated nursing trainee time premiums from the salary detail view", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
    };
    mockEntries = [
      {
        ...januaryShift(),
        id: "trainee-night",
        date: "2026-10-06",
        title: "Nachtdienst",
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:00",
        breakMinutes: 60,
      },
    ];
    const salary = await render(<SalaryScreen />);
    await openSalaryComponents(salary, "2026-10");
    expect(salary.getByText(/14,26/)).toBeTruthy();
    await openSalaryServicesFromOverview(salary, "2026-10");
    const premiums = await render(<PremiumDetailsScreen />);
    expect(premiums.queryByText("Keine tarifliche Berechnung")).toBeNull();
    expect(premiums.getByText("Nach Zuschlagsart")).toBeTruthy();
    expect(premiums.getAllByText(/14,26/).length).toBeGreaterThan(0);
  });

  it("shows uncovered nursing trainee months as unavailable rather than manual salary", async () => {
    mockRouteMonth = "2027-04";
    mockRuleResolver = FUTURE_HOLIDAY_TARIFF_EXPIRY_RESOLVER;
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
    };
    const screen = await render(<PremiumDetailsScreen />);
    expect(screen.getByText("Für diesen Zeitraum fehlen geprüfte Tarifdaten.")).toBeTruthy();
    expect(screen.queryByText("Keine tarifliche Berechnung")).toBeNull();
    expect(screen.queryByText("0,00 €")).toBeNull();
  });

  it("shows TVA-L as training tariff salary in the familiar overview", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST" },
    };
    const screen = await render(<AnalysisScreen />);
    expect(screen.getByLabelText(/^Grundgehalt: 1\.440,70/)).toBeTruthy();
    expect(screen.getByText("Brutto geschätzt")).toBeTruthy();
    expect(screen.queryByText("Manuell hinterlegtes Monatsbrutto")).toBeNull();
  });
  it("keeps TVA-L training pay and grouped night premiums in the existing details", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST" },
    };
    mockEntries = [
      {
        ...januaryShift(),
        id: "tval-night",
        date: "2026-10-06",
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:00",
        breakMinutes: 60,
        overtimeMinutes: 0,
      },
    ];
    const salary = await render(<SalaryScreen />);
    await openSalaryComponents(salary, "2026-10");
    expect(salary.getByText("TVA-L Pflege · 1. Ausbildungsjahr")).toBeTruthy();
    expect(salary.getByText("Ausbildungsentgelt")).toBeTruthy();
    expect(salary.getByText(/13,76/)).toBeTruthy();
    expect(salary.queryByText(/Pflegezulage TVöD-P|TVöD-Zulage/)).toBeNull();
    await openSalaryServicesFromOverview(salary, "2026-10");
    const premiums = await render(<PremiumDetailsScreen />);
    expect(premiums.getByText("Nach Zuschlagsart")).toBeTruthy();
    expect(premiums.getAllByText(/13,76/).length).toBeGreaterThan(0);
    expect(premiums.queryByText("Keine tarifliche Berechnung")).toBeNull();
  });
  it("shows TV-H salary in the familiar overview as tariff pay", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    };
    const screen = await render(<AnalysisScreen />);
    expect(screen.getByLabelText(/^Grundgehalt: 4\.108,81/)).toBeTruthy();
    expect(screen.getByText("Brutto geschätzt")).toBeTruthy();
    expect(screen.queryByText("Manuell hinterlegtes Monatsbrutto")).toBeNull();
  });
  it("shows TV-UK salary in the familiar overview as tariff pay", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
    };
    const screen = await render(<AnalysisScreen />);
    expect(screen.getByLabelText(/^Grundgehalt: 4\.352,00/)).toBeTruthy();
    expect(screen.getByText("Brutto geschätzt")).toBeTruthy();
    expect(screen.queryByText("Manuell hinterlegtes Monatsbrutto")).toBeNull();
  });
  it("shows TV-H pay and familiar grouped premiums", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    };
    mockEntries = [
      {
        ...januaryShift(),
        id: "uk-night",
        date: "2026-10-05",
        type: "NIGHT",
        startTime: "20:00",
        endTime: "06:00",
        breakMinutes: 0,
        overtimeMinutes: 0,
      },
    ];
    const salary = await render(<SalaryScreen />);
    await openSalaryComponents(salary, "2026-10");
    expect(salary.getByText("TV-H KR8 · Stufe 4")).toBeTruthy();
    expect(salary.getByText("Pflegezulage TV-H")).toBeTruthy();
    expect(salary.queryByText("Pflegezulage TVöD-P")).toBeNull();
    expect(salary.queryByRole("button", { name: /Pflegezulage TV-H/ })).toBeNull();
    await openSalaryServicesFromOverview(salary, "2026-10");
    const premiums = await render(<PremiumDetailsScreen />);
    expect(premiums.getByText("Nach Zuschlagsart")).toBeTruthy();
    expect(premiums.getAllByText(/41,85/).length).toBeGreaterThan(0);
    expect(premiums.queryByText("Keine tarifliche Berechnung")).toBeNull();
  });
  it("shows TV-UK cash, compulsory time credit and familiar grouped premiums", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
    };
    mockEntries = [
      {
        ...januaryShift(),
        id: "uk-night",
        date: "2026-10-05",
        type: "NIGHT",
        startTime: "20:00",
        endTime: "06:00",
        breakMinutes: 0,
        overtimeMinutes: 0,
      },
    ];
    const salary = await render(<SalaryScreen />);
    await openSalaryComponents(salary, "2026-10");
    expect(salary.getByText("TV-UK P-UK8 · Stufe 4")).toBeTruthy();
    expect(salary.getByText("Pflegezulage TV-UK")).toBeTruthy();
    expect(salary.getByText(/Zusätzlich 30 Min. Freizeitausgleich/)).toBeTruthy();
    expect(salary.queryByText("Pflegezulage TVöD-P")).toBeNull();
    expect(salary.queryByRole("button", { name: /Pflegezulage TV-UK/ })).toBeNull();
    await openSalaryServicesFromOverview(salary, "2026-10");
    const premiums = await render(<PremiumDetailsScreen />);
    expect(premiums.getByText("Nach Zuschlagsart")).toBeTruthy();
    expect(premiums.getAllByText(/67,60/).length).toBeGreaterThan(0);
    expect(premiums.getByText(/Zusätzlich 30 Min. Freizeitausgleich/)).toBeTruthy();
    expect(premiums.queryByText("Keine tarifliche Berechnung")).toBeNull();
  });
  it("shows TV-L salary in the familiar overview without a manual caption", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
    };
    const screen = await render(<AnalysisScreen />);
    expect(screen.getByLabelText(/^Grundgehalt: 4\.052,74/)).toBeTruthy();
    expect(screen.getByText("Brutto geschätzt")).toBeTruthy();
    expect(screen.queryByText("Manuell hinterlegtes Monatsbrutto")).toBeNull();
  });
  it("shows TV-L allowance read-only and opens grouped premiums from salary", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
    };
    mockEntries = [
      {
        ...januaryShift(),
        id: "tvl-night",
        date: "2026-10-06",
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:00",
        breakMinutes: 60,
      },
    ];
    const salary = await render(<SalaryScreen />);
    await openSalaryComponents(salary, "2026-10");
    expect(salary.getByText("TV-L KR8 · Stufe 4")).toBeTruthy();
    expect(salary.getByText(/36,67/)).toBeTruthy();
    expect(salary.getByText("Pflegezulage TV-L")).toBeTruthy();
    expect(salary.queryByText("Pflegezulage TVöD-P")).toBeNull();
    expect(salary.queryByRole("button", { name: /Pflegezulage TV-L/ })).toBeNull();
    await openSalaryServicesFromOverview(salary, "2026-10");
    const premiums = await render(<PremiumDetailsScreen />);
    expect(premiums.getByText("Nach Zuschlagsart")).toBeTruthy();
    expect(premiums.getAllByText(/36,67/).length).toBeGreaterThan(0);
    expect(premiums.queryByText("Keine tarifliche Berechnung")).toBeNull();
  });
  it("shows E salary composition in the familiar overview", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    };
    const screen = await render(<AnalysisScreen />);
    expect(screen.getByLabelText(/^Grundgehalt: 4\.690,55/)).toBeTruthy();
    expect(screen.getByText("Zeitzuschläge")).toBeTruthy();
    expect(screen.getByText("Brutto geschätzt")).toBeTruthy();
    expect(screen.queryByText("Manuell hinterlegtes Monatsbrutto")).toBeNull();
  });
  it("navigates E salary to grouped calculated premium cards", async () => {
    mockRouteMonth = "2026-10";
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    };
    mockEntries = [
      {
        ...januaryShift(),
        id: "e-night",
        date: "2026-10-06",
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:00",
        breakMinutes: 60,
      },
    ];
    const salary = await render(<SalaryScreen />);
    await openSalaryComponents(salary, "2026-10");
    expect(salary.getByText("TVöD E9b · Stufe 4")).toBeTruthy();
    expect(salary.getByText(/40,18/)).toBeTruthy();
    expect(salary.queryByText("Pflegezulage TVöD-P")).toBeNull();
    await openSalaryServicesFromOverview(salary, "2026-10");
    const premiums = await render(<PremiumDetailsScreen />);
    expect(premiums.getByText("Nach Zuschlagsart")).toBeTruthy();
    expect(premiums.getAllByText(/40,18/).length).toBeGreaterThan(0);
    expect(premiums.queryByText("Keine tarifliche Berechnung")).toBeNull();
  });
  it("keeps an uncovered E period unavailable without treating it as manual salary", async () => {
    mockRouteMonth = "2027-04";
    mockRuleResolver = FUTURE_HOLIDAY_TARIFF_EXPIRY_RESOLVER;
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      vkaETariff: { payGroup: "E12", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    };
    const screen = await render(<PremiumDetailsScreen />);
    expect(screen.getByText("Für diesen Zeitraum fehlen geprüfte Tarifdaten.")).toBeTruthy();
    expect(screen.queryByText("Keine tarifliche Berechnung")).toBeNull();
  });

  it("keeps missing rule coverage local in ComplianceDetailsScreen", async () => {
    await expectRuleCoverageDiagnostic(<ComplianceDetailsScreen />);
  });

  it("keeps January 2027 navigable and shows independent zero values without shifts", async () => {
    const screen = await render(<AnalysisScreen />);

    expectPartialAnalysisShell(screen, false);
    expect(screen.getByLabelText("Ist: 0:00 h")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: /Nächster Monat/ }));

    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2027-02", period: "MONTH" });
    expect(mockActiveMonthCoordinator.analysisRequests.setMonth).toHaveBeenCalledWith("2027-02");
    expect(
      (await render(<WorktimeDetailsScreen />)).getByLabelText(
        "Noch keine Dienste. Trage Dienste ein, um den Monat auszuwerten.",
      ),
    ).toBeTruthy();
  });

  it("keeps January 2027 shift count and worked time visible without holiday coverage", async () => {
    mockEntries = [januaryShift()];

    const screen = await render(<AnalysisScreen />);

    expectPartialAnalysisShell(screen);
    expect(screen.getByLabelText("Ist: 7:30 h")).toBeTruthy();
    await expectShiftCount(1);
    expect(
      (await render(<WorktimeDetailsScreen />)).getByLabelText("Gesamt, Anzahl 1, Stunden 7:30 h"),
    ).toBeTruthy();
  });

  it("keeps manual salary visible without a valid tariff package", async () => {
    mockRouteMonth = "2027-04";
    mockRuleResolver = FUTURE_HOLIDAY_TARIFF_EXPIRY_RESOLVER;
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: null,
      manualMonthlyGrossCents: 345_050,
    };
    mockEntries = [{ ...januaryShift(), id: "april-shift", date: "2027-04-04" }];

    const analysis = await render(<AnalysisScreen />);
    expect(analysis.getByRole("button", { name: /^Gehalt, 3\.450,50/ })).toBeTruthy();

    const salary = await render(<SalaryScreen />);
    mockAnnualSection = "components";
    await salary.rerender(<SalaryDetailsScreen />);
    expect(salary.queryByText("Diagnosecode: RULE_PACKAGE_NOT_FOUND")).toBeNull();
    expect(salary.getByLabelText(/^Gesamtbrutto:/)).toBeTruthy();
    expect(salary.getByText("Monatsbrutto")).toBeTruthy();
    expect(salary.getByText("Manuell hinterlegt")).toBeTruthy();
    expect(salary.queryByText("Zeitzuschläge")).toBeNull();
  });

  it("does not present missing absence credits as exact zero hours", async () => {
    mockEntries = [
      {
        ...januaryShift(),
        id: "january-vacation",
        type: "VACATION",
        title: "Urlaub",
        startTime: null,
        endTime: null,
        breakMinutes: 0,
      },
    ];

    const screen = await render(<AnalysisScreen />);

    await expectShiftCount(1);
    expect(screen.queryByLabelText("Stunden pro Schicht, Gesamt 0:00 h")).toBeNull();
    expect(
      screen.getByText(
        "Soll und Zeitgutschriften sind noch offen. Tippe für die Berechnungsgrundlagen.",
      ),
    ).toBeTruthy();
  });

  it("keeps the full April 2027 analysis and marks only expired TVöD pay unavailable", async () => {
    mockRouteMonth = "2027-04";
    mockRuleResolver = FUTURE_HOLIDAY_TARIFF_EXPIRY_RESOLVER;
    mockEntries = [
      {
        ...januaryShift(),
        id: "april-shift",
        date: "2027-04-04",
        title: "Aprildienst",
      },
    ];

    const screen = await render(<AnalysisScreen />);

    expect(screen.getByTestId("analysis-month-toolbar")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gehalt, Nicht verfügbar/ })).toBeTruthy();
    expect(screen.getByLabelText("Soll: 169:24 h")).toBeTruthy();
    expect(screen.getByLabelText("Ist: 7:30 h")).toBeTruthy();
    expect(screen.getByLabelText("Stundensaldo: −161:54 h")).toBeTruthy();
    await expectShiftCount(1);
    expect(
      (await render(<WorktimeDetailsScreen />)).getByLabelText("Gesamt, Anzahl 1, Stunden 7:30 h"),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps missing rule coverage local in SalaryScreen", async () => {
    await expectRuleCoverageDiagnostic(<SalaryScreen />);
  });

  it("keeps missing rule coverage local in PremiumDetailsScreen", async () => {
    await expectRuleCoverageDiagnostic(<PremiumDetailsScreen />);
  });

  it("keeps allowance review self-contained without employment edits or partial save", async () => {
    mockSaveEmployment.mockClear();
    const screen = await render(<TariffAssessmentScreen />);
    expect(mockSaveEmployment).not.toHaveBeenCalled();
    expect(screen.queryByText("Änderung gilt für")).toBeNull();
    expect(screen.queryByText("Arbeitsmodell bearbeiten")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Schichtzulage selbst festlegen" }));
    expect(
      screen.getByRole("radio", {
        name: "Schichtzulage selbst festlegen: Ständige Wechselschicht",
      }),
    ).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(mockSaveEmployment).not.toHaveBeenCalled();
  });

  it("keeps tariff assessment independent from missing holiday rules", async () => {
    mockEntries = [januaryShift()];
    const screen = await render(<TariffAssessmentScreen />);

    expect(screen.queryByText("Diagnosecode: RULE_PACKAGE_NOT_FOUND")).toBeNull();
    expect(screen.getByRole("button", { name: "Schichtzulage selbst festlegen" })).toBeTruthy();
  });

  it("explains real entries on demand and closes details for a new month", async () => {
    mockRouteMonth = "2026-09";
    mockEntries = ["02", "23", "24"].map((day) => ({
      ...januaryShift(),
      id: day,
      date: `2026-09-${day}`,
      startTime: "21:00",
      endTime: "07:00",
    }));
    const screen = await render(<TariffAssessmentScreen />);
    const name = "Einschätzung erklären";
    expect(screen.getByRole("button", { name, expanded: false })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name }));
    expect(screen.getByText("Passende Nachtdienstfolge gefunden")).toBeTruthy();
    mockEntries = [];
    await screen.rerender(<TariffAssessmentScreen />);
    expect(screen.getByText("Noch keine passende Nachtdienstfolge erkennbar")).toBeTruthy();
    mockRouteMonth = "2026-10";
    await screen.rerender(<TariffAssessmentScreen />);
    expect(screen.getByRole("button", { name, expanded: false })).toBeTruthy();
  });

  it("does not apply the BT-K explanation to another tariff sector", async () => {
    mockProfile = {
      ...MOCK_TARIFF_PROFILE,
      tariff: { ...MOCK_TARIFF_PROFILE.tariff!, sector: "BT_B" },
    };
    const screen = await render(<TariffAssessmentScreen />);
    expect(screen.queryByText("Einschätzung erklären")).toBeNull();
  });

  it("keeps core, salary and holiday worktime independent from missing legal rules", async () => {
    mockRuleResolver = FUTURE_HOLIDAY_MISSING_LEGAL_RESOLVER;
    mockEntries = [januaryShift()];

    const analysis = await render(<AnalysisScreen />);
    expect(analysis.getByLabelText("Ist: 7:30 h")).toBeTruthy();
    expect(analysis.getByLabelText(/^Soll: (?!Nicht verfügbar)/)).toBeTruthy();
    expect(analysis.getByRole("button", { name: /^Gehalt, \d/ })).toBeTruthy();
    expect(analysis.getByText("Für die Prüfung fehlen Berechnungsdaten.")).toBeTruthy();

    const salary = await render(<SalaryScreen />);
    mockAnnualSection = "components";
    await salary.rerender(<SalaryDetailsScreen />);
    expect(salary.queryByText("Diagnosecode: RULE_PACKAGE_NOT_FOUND")).toBeNull();
    expect(salary.getByText("Grundentgelt")).toBeTruthy();
  });

  it("shows expired tariff detail paths as unavailable without zero pseudo-results", async () => {
    mockRouteMonth = "2027-04";
    mockRuleResolver = FUTURE_HOLIDAY_TARIFF_EXPIRY_RESOLVER;
    mockEntries = [{ ...januaryShift(), id: "april-shift", date: "2027-04-04" }];

    const premiums = await render(<PremiumDetailsScreen />);
    expect(premiums.getByText("Für diesen Zeitraum fehlen geprüfte Tarifdaten.")).toBeTruthy();
    expect(premiums.queryByText("0,00 €")).toBeNull();

    const assessment = await render(<TariffAssessmentScreen />);
    expect(
      assessment.getByText("Schichtzulage nicht berechenbar: Tarifdaten fehlen."),
    ).toBeTruthy();
    expect(assessment.queryByLabelText("Schichtzulage selbst festlegen")).toBeNull();
    expect(assessment.queryByText("Einschätzung erklären")).toBeNull();
  });

  it.each([
    ["WORK", "/worktime-details"],
    ["CHECK", "/compliance-details"],
    ["PAY", "/salary"],
  ])(
    "opens annual %s month details without changing the parent year",
    async (section, pathname) => {
      mockAnnualSection = section;
      const core = buildAnnualCoreReport(2027, [januaryShift()], mockProfile);
      mockAnnualReportValue = {
        ...core,
        complianceCoverageComplete: true,
        criticalCount: 1,
        months: core.months.map((month, index) => ({
          ...month,
          criticalCount: index === 0 ? 1 : 0,
        })),
      };
      const screen = await render(<AnnualDetailsScreen />);
      await fireEvent.press(screen.getByRole("button", { name: /^Januar 2027,/ }));
      expect(router.push).toHaveBeenLastCalledWith({ pathname, params: { month: "2027-01" } });
      expect(mockActiveMonthCoordinator.setMonth).not.toHaveBeenCalled();
    },
  );

  it("opens employment from worktime for the selected month without moving the analysis period", async () => {
    mockRouteMonth = "2026-12";
    const screen = await render(<AnalysisScreen />);
    await fireEvent.press(screen.getByRole("button", { name: /^Stunden,/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/working-time-profile",
      params: { origin: "analysis", month: "2026-12" },
    });
    expect(mockActiveMonthCoordinator.setMonth).not.toHaveBeenCalled();
  });

  it("keeps shift counts and hours on the overview and supports existing deep links", async () => {
    mockRouteMonth = "2026-09";
    mockEntries = [{ ...januaryShift(), date: "2026-09-03" }];
    const overview = await render(<AnalysisScreen />);
    expect(overview.queryByRole("button", { name: "Schichten: Details öffnen" })).toBeNull();
    expect(overview.getByRole("button", { name: /^Stunden,/ })).toBeTruthy();
    expect(overview.getByLabelText("Gesamt: 7:30 h")).toBeTruthy();
    expect(overview.getByText("D")).toBeTruthy();
    expect(overview.getByLabelText("Sonntagsdienst: 7:30 h")).toBeTruthy();
    await fireEvent.press(overview.getByRole("tab", { name: "Schichten: Anzahl" }));
    expect(overview.getByLabelText("Gesamt: 1")).toBeTruthy();
    await overview.unmount();
    mockActiveMonthCoordinator.setMonth.mockClear();
    mockAnnualSection = "SHIFTS";
    const details = await render(<WorktimeDetailsScreen />);
    expect(details.getByText("Deine Schichten")).toBeTruthy();
    expect(details.getByLabelText("Tag, Anzahl 1, Stunden 7:30 h")).toBeTruthy();
    expect(details.queryByText("Arbeitszeit")).toBeNull();
    expect(details.queryByRole("tab", { name: "Schichten: Anzahl" })).toBeNull();
    expect(mockActiveMonthCoordinator.setMonth).not.toHaveBeenCalled();
  });

  it("keeps annual shift details and their month destination separate from worktime", async () => {
    mockAnnualSection = "SHIFTS";
    mockAnnualCoreValue = buildAnnualCoreReport(2027, [januaryShift()], mockProfile);
    const screen = await render(<AnnualDetailsScreen />);
    expect(screen.getByLabelText("Tag, Anzahl 1, Stunden 7:30 h")).toBeTruthy();
    expect(screen.queryByText("Arbeitszeit")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Januar 2027: 7:30 h" }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/worktime-details",
      params: { month: "2027-01", section: "SHIFTS" },
    });
    expect(mockActiveMonthCoordinator.setMonth).not.toHaveBeenCalled();
  });

  it("rejects incomplete annual links and allows closing", async () => {
    mockAnnualSection = "UNKNOWN";
    const screen = await render(<AnnualDetailsScreen />);
    expect(screen.getByText("Jahresdetails können nicht geöffnet werden")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    expect(router.back).toHaveBeenCalled();
  });

  it("keeps pending annual checks and salary out of detail results", async () => {
    mockAnnualCoreValue = buildAnnualCoreReport(2027, [januaryShift()], mockProfile);
    mockAnnualSection = "CHECK";
    const screen = await render(<AnnualDetailsScreen />);
    expect(screen.getByText("Die Jahresprüfung wird berechnet …")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zurück zur Auswertung" })).toBeVisible();
    expect(screen.queryByText(/keine Auffälligkeiten erkannt/)).toBeNull();
    mockAnnualSection = "PAY";
    await screen.rerender(<AnnualDetailsScreen />);
    expect(screen.getByText("Das Jahresgehalt wird berechnet …")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zur Auswertung" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockActiveMonthCoordinator.setMonth).not.toHaveBeenCalled();
    expect(screen.queryByText("0,00 €")).toBeNull();
  });

  it("retains a completed yearly report underneath a native detail page", async () => {
    mockAnnualCoreValue = buildAnnualCoreReport(2027, [januaryShift()], mockProfile);
    const screen = await render(<AnalysisScreen />);
    await openAnalysisMode(screen, "Jahresauswertung öffnen");
    expect(screen.queryByText("Jahresauswertung wird berechnet …")).toBeNull();
    mockFocused = false;
    mockAnnualCoreValue = null;
    await screen.rerender(<AnalysisScreen />);
    expect(screen.queryByText("Jahresauswertung wird berechnet …")).toBeNull();
    expect(screen.getByTestId("analysis-year-toolbar")).toBeTruthy();
  });
  it("keeps year navigation and return to month available while calculating", async () => {
    const screen = await render(<AnalysisScreen />);
    await openAnalysisMode(screen, "Jahresauswertung öffnen");
    expect(screen.getByText("Jahresauswertung wird berechnet …")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/Nächstes Jahr, aktuell/));
    expect(screen.getByTestId("analysis-year-toolbar")).toBeTruthy();
    await openAnalysisMode(screen, "Monatsauswertung öffnen");
    expect(screen.queryByText("Jahresauswertung wird berechnet …")).toBeNull();
  });

  it("renders current core content before the complete annual result", async () => {
    mockAnnualCoreValue = buildAnnualCoreReport(2027, [januaryShift()], mockProfile);
    const screen = await render(<AnalysisScreen />);
    await openAnalysisMode(screen, "Jahresauswertung öffnen");
    expect(screen.queryByText("Jahresauswertung wird berechnet …")).toBeNull();
    expect(screen.getByText("Arbeitszeit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prüfung, Wird geprüft …" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gehalt, Wird berechnet …" })).toBeTruthy();
    expect(screen.getByLabelText("Ist: 7:30 h")).toBeTruthy();
  });

  it("keeps annual rule coverage local after switching from a covered month", async () => {
    mockRouteMonth = "2026-08";
    const resolution = GENERATION_ONE_REVIEWED_RESOLVER.resolveHoliday("2027-01-01");
    if (resolution.ok) throw new Error("Expected missing 2027 holiday coverage.");
    const error = new RuleResolutionError(resolution.error);
    mockAnnualRuleFailure = { ok: false, error, failure: error.failure };
    const screen = await render(<AnalysisScreen />);

    await openAnalysisMode(screen, "Jahresauswertung öffnen");

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Jahresauswertung nicht verfügbar")).toBeTruthy();
    expect(screen.getByText("Diagnosecode: RULE_PACKAGE_NOT_FOUND")).toBeTruthy();
  });

  it("does not block annual core metrics when input optimization lacks legal rules", async () => {
    mockRuleResolver = FUTURE_HOLIDAY_MISSING_LEGAL_RESOLVER;
    mockEntries = [januaryShift()];
    const resolution = mockRuleResolver.resolveLegal("2027-01-01");
    if (resolution.ok) throw new Error("Expected missing 2027 legal coverage.");
    const error = new RuleResolutionError(resolution.error);
    mockAnnualInputFailure = { ok: false, error, failure: error.failure };
    mockAnnualReportValue = buildAnnualCoreReport(2027, mockEntries, mockProfile);
    const screen = await render(<AnalysisScreen />);

    await openAnalysisMode(screen, "Jahresauswertung öffnen");

    expect(await screen.findByTestId("analysis-year-toolbar")).toBeTruthy();
    expect(screen.getByLabelText("Ist: 7:30 h")).toBeTruthy();
    expect(screen.queryByText("Jahresauswertung nicht verfügbar")).toBeNull();
  });

  it("passes unexpected annual errors to the global boundary", async () => {
    mockRouteMonth = "2026-08";
    mockAnnualFatalError = new Error("unexpected annual render failure");
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const screen = await render(
      <AppErrorBoundary>
        <AnalysisScreen />
      </AppErrorBoundary>,
    );

    await openAnalysisMode(screen, "Jahresauswertung öffnen");

    expect(await screen.findByText("Diagnosecode: APP_RENDER_FAILED")).toBeTruthy();
    consoleError.mockRestore();
  });

  it("rethrows unexpected computation errors", async () => {
    const unexpectedFailure = "unexpected analysis computation failure";
    mockRuleResolver = {
      ...GENERATION_ONE_REVIEWED_RESOLVER,
      resolveHoliday: () => {
        throw new Error(unexpectedFailure);
      },
    };

    await expect(render(<AnalysisScreen />)).rejects.toThrow(unexpectedFailure);
  });
});

it("opens premiums only inside salary with the exact month", async () => {
  mockRouteMonth = "2026-09";
  mockRuleResolver = GENERATION_ONE_REVIEWED_RESOLVER;
  mockEntries = [];
  mockProfile = MOCK_TARIFF_PROFILE;
  const screen = await render(<AnalysisScreen />);
  expect(screen.queryByRole("button", { name: /^Zeitzuschläge:/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: /^Gehalt,/ }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/salary",
    params: { month: "2026-09" },
  });
  await screen.unmount();
  const salary = await render(<SalaryScreen />);
  await openSalaryComponents(salary, "2026-09");
  await openSalaryServicesFromOverview(salary, "2026-09");
});

async function openSalaryComponents(screen: Awaited<ReturnType<typeof render>>, month: string) {
  await fireEvent.press(screen.getByRole("button", { name: /^Gesamtbrutto:/ }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/salary-details",
    params: { month, section: "components" },
  });
  mockAnnualSection = "components";
  await screen.rerender(<SalaryDetailsScreen />);
  expect(screen.getByRole("header", { name: "Gehaltsbestandteile" })).toBeTruthy();
}

async function openSalaryServicesFromOverview(
  screen: Awaited<ReturnType<typeof render>>,
  month: string,
) {
  expect(screen.queryByRole("button", { name: /^Zeitzuschläge:/ })).toBeNull();
  await screen.rerender(<SalaryScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Aufteilung ansehen" }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/salary-details",
    params: { month, section: "premiums" },
  });
  mockAnnualSection = "premiums";
  await screen.rerender(<SalaryDetailsScreen />);
  expect(screen.getAllByRole("header", { name: "Zeitzuschläge" }).length).toBeGreaterThan(0);
  expect(screen.getByText("Netto-Aufteilung nicht verfügbar")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Zuschläge je Dienst" }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/salary-details",
    params: { month, section: "services" },
  });
  mockAnnualSection = "services";
  await screen.rerender(<SalaryDetailsScreen />);
  expect(screen.getByRole("header", { name: "Zuschläge je Dienst" })).toBeTruthy();
  expect(screen.getByTestId("net-pay-service-details")).toBeTruthy();
}

async function expectShiftCount(count: number) {
  const screen = await render(<WorktimeDetailsScreen />);
  expect(screen.getByLabelText(new RegExp("^Gesamt, Anzahl " + count + ", Stunden "))).toBeTruthy();
}
