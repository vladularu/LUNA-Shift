import type { AnnualReport } from "./annual-report";
import { withAnnualSalaryPayments } from "./annual-salary-payments";
import { useNetPayProfile } from "@/features/salary/use-net-pay-profile";
import { useAnnualSalaryForecast } from "@/features/salary/use-annual-salary-forecast";
import { useAnnualNetPay } from "./use-annual-net-pay";

function useOriginalAnnualSalaryPayments(
  report: AnnualReport,
  pending: boolean,
  testMonths: readonly string[],
  {
    salary: includeSalary = true,
    net: includeNet = true,
  }: {
    readonly salary?: boolean;
    readonly net?: boolean;
  } = {},
) {
  const enabled =
    includeSalary && !pending && !testMonths.some((month) => month.startsWith(`${report.year}-`));
  const data = useNetPayProfile(`${report.year}-12`, enabled || (!pending && includeNet));
  const net = useAnnualNetPay(report.year, data, !pending && includeNet, testMonths);
  const annual = useAnnualSalaryForecast(
    report.year,
    data.annualPayments,
    enabled && data.status === "ready",
    testMonths,
  );
  return {
    net,
    report:
      enabled && data.status === "ready"
        ? withAnnualSalaryPayments(report, data.timeline, annual.payments)
        : report,
    loading: enabled && data.status === "loading",
    error: enabled ? data.error : null,
  };
}

/** Same report and controls; the expensive annual forecast comes from Rust. */
export function useRustAnnualSalaryPayments(
  report: AnnualReport,
  pending: boolean,
  testMonths: readonly string[],
  {
    salary: includeSalary = true,
    net: includeNet = true,
  }: { readonly salary?: boolean; readonly net?: boolean } = {},
) {
  const enabled =
    includeSalary && !pending && !testMonths.some((month) => month.startsWith(`${report.year}-`));
  const data = useNetPayProfile(`${report.year}-12`, enabled || (!pending && includeNet));
  const prepared = useAnnualNetPay(
    report.year,
    data,
    !pending && (includeNet || enabled),
    testMonths,
  );
  const forecast = prepared.report?.salaryForecast;
  return {
    net: includeNet ? prepared : { report: null, loading: false, error: null },
    report:
      enabled && data.status === "ready" && forecast
        ? withAnnualSalaryPayments(report, data.timeline, forecast.payments)
        : report,
    loading: enabled && (data.status === "loading" || prepared.loading),
    error: enabled ? (data.error ?? prepared.error) : null,
  };
}
export const useAnnualSalaryPayments =
  process.env.EXPO_PUBLIC_RUST_ANNUAL_BRIDGE === "1"
    ? useRustAnnualSalaryPayments
    : useOriginalAnnualSalaryPayments;
