import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { MonthlyComplianceResult, UserProfile } from "@/domain/types";
import { ComplianceDetailsScreen } from "./compliance-details-screen";

const mockSaved: UserProfile = {
  regularRotatingNightWork: null,
  sundayHolidayWorkEligible: null,
  allEmploymentWorkRecorded: null,
  federalState: "NW",
  weeklyMinutes: 2310,
  holidayRegion: "NONE",
  timeZone: "Europe/Berlin",
  tariff: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const mockCalculated: UserProfile = {
  ...mockSaved,
  weeklyMinutes: 2400,
  tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
};
let mockCalculationProfile: UserProfile | undefined = mockCalculated;
const mockResult: MonthlyComplianceResult = {
  month: "2026-11",
  issues: [],
  criticalCount: 0,
  warningCount: 0,
  infoCount: 0,
  affectedDates: [],
};
const mockCheck = jest.fn((_input: unknown) => ({
  result: mockResult,
  error: null,
  retry: jest.fn(),
}));

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ month: "2026-11" }),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockSaved, calculationProfile: mockCalculationProfile }),
  usePflegeShiftEntries: () => ({ entries: [] }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => {
  const { bundledRuleResolver } =
    jest.requireActual<typeof import("@/rules/rule-resolver")>("@/rules/rule-resolver");
  return { useRuleCatalogRuntime: () => ({ resolver: bundledRuleResolver }) };
});
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({ enabled: true, youthEnabled: false, error: null }),
}));
jest.mock("./use-monthly-compliance", () => ({
  useDeferredMonthlyCompliance: (input: unknown) => mockCheck(input),
}));
jest.mock("./compliance-day-list", () => ({ ComplianceDayList: () => null }));

describe("detail/overview tariff profile consistency", () => {
  beforeEach(() => {
    mockCheck.mockClear();
    mockCalculationProfile = mockCalculated;
  });

  it("passes the same corrected calculation profile used by the overview", async () => {
    await render(<ComplianceDetailsScreen />);
    expect(mockCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ profile: mockCalculated }),
    );
  });

  it("falls back to the saved profile while no calculation profile is available", async () => {
    mockCalculationProfile = undefined;
    await render(<ComplianceDetailsScreen />);
    expect(mockCheck).toHaveBeenLastCalledWith(expect.objectContaining({ profile: mockSaved }));
  });
});
