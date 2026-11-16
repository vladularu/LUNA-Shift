import { renderHook } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { useRustAnnualSalaryPayments } from "./use-annual-salary-payments";
import { withAnnualSalaryPayments } from "./annual-salary-payments";
import type { AnnualReport } from "./annual-report";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { validateAnnualSalaryPayments } from "@/domain/annual-salary-payment";
import mockFixture from "./annual-rust-bridge.fixture.json";

jest.mock("@/features/salary/use-annual-salary-forecast", () => ({
  useAnnualSalaryForecast: () => {
    throw new Error("No TS annual salary calculation during rendering");
  },
}));
jest.mock("@/features/salary/use-net-pay-profile", () => ({
  useNetPayProfile: () => ({
    status: "ready",
    timeline: mockFixture.netRequest.timeline,
    error: null,
  }),
}));
jest.mock("./use-annual-net-pay", () => ({
  useAnnualNetPay: () => ({ report: mockFixture.net, loading: false, error: null }),
}));
const report = mockFixture.report as unknown as AnnualReport;
describe("annual Rust salary data with the original presentation contract", () => {
  it("adds the native forecast once and preserves the existing result shape", async () => {
    const hook = await renderHook(() => useRustAnnualSalaryPayments(report, false, []));
    const expected = withAnnualSalaryPayments(
      report,
      mockFixture.netRequest.timeline as unknown as readonly SavedMonthlyNetPaySettings[],
      validateAnnualSalaryPayments(mockFixture.net.salaryForecast.payments),
    );
    expect(hook.result.current.report).toEqual(expected);
    expect(hook.result.current.net.report).toEqual(mockFixture.net);
    await hook.rerender({});
    expect(hook.result.current.report).toEqual(expected);
  });
  it("keeps test-month salary restrictions and the existing hidden section behavior", async () => {
    const hook = await renderHook(() =>
      useRustAnnualSalaryPayments(report, false, [`${report.year}-01`], { net: false }),
    );
    expect(hook.result.current.report).toBe(report);
    expect(hook.result.current.net).toEqual({ report: null, loading: false, error: null });
  });
});
