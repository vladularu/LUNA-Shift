import { renderHook } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { forecastProfile as mockProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS as mockPattern } from "@/engine/simple-pay";
import { bundledRuleResolver as mockResolver } from "@/rules/rule-resolver";
import { annualSalaryForecast } from "@/features/salary/annual-salary-forecast";
import { useAnnualNetPay } from "./use-annual-net-pay";
import { useNetPayProfile } from "@/features/salary/use-net-pay-profile";
import { buildAnnualCoreReport } from "./annual-core-report";
import { useAnnualSalaryPayments } from "./use-annual-salary-payments";

jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
  usePflegeShiftEntries: () => ({ entries: [] }),
  usePflegeShiftTariff: () => ({ tariffDecisions: [], workPatternSettings: mockPattern }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockResolver }),
}));
jest.mock("@/features/salary/use-net-pay-profile", () => ({
  useNetPayProfile: jest.fn(() => ({
    status: "ready",
    timeline: [],
    annualPayments: [],
    error: null,
  })),
}));
jest.mock("./use-annual-net-pay", () => ({
  useAnnualNetPay: jest.fn(() => ({ report: null, loading: false, error: null })),
}));
jest.mock("@/features/salary/annual-salary-forecast", () => ({
  annualSalaryForecast: jest.fn(() => ({ payments: [], proposal: null, automatic: false })),
}));
const report = buildAnnualCoreReport(2026, [], mockProfile);
beforeEach(() => {
  jest.clearAllMocks();
});

describe("annual financial preparation selection", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("salary=%s, net=%s only activates the requested work", async (salary, net) => {
    await renderHook(() => useAnnualSalaryPayments(report, false, [], { salary, net }));
    expect(useNetPayProfile).toHaveBeenCalledWith("2026-12", salary || net);
    expect(annualSalaryForecast).toHaveBeenCalledTimes(salary ? 1 : 0);
    expect(useAnnualNetPay).toHaveBeenLastCalledWith(2026, expect.anything(), net, []);
  });
  it("keeps all financial work disabled while the base report is pending", async () => {
    await renderHook(() => useAnnualSalaryPayments(report, true, []));
    expect(useNetPayProfile).toHaveBeenCalledWith("2026-12", false);
    expect(annualSalaryForecast).not.toHaveBeenCalled();
    expect(useAnnualNetPay).toHaveBeenLastCalledWith(2026, expect.anything(), false, []);
  });
  it("preserves test-month protection for salary while net receives the restrictions", async () => {
    const months = ["2026-08"];
    await renderHook(() => useAnnualSalaryPayments(report, false, months));
    expect(useNetPayProfile).toHaveBeenCalledWith("2026-12", true);
    expect(annualSalaryForecast).not.toHaveBeenCalled();
    expect(useAnnualNetPay).toHaveBeenLastCalledWith(2026, expect.anything(), true, months);
  });
});
