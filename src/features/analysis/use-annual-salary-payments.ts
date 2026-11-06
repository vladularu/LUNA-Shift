import type { AnnualReport } from "./annual-report";
import { withAnnualSalaryPayments } from "./annual-salary-payments";
import { useNetPayProfile } from "@/features/salary/use-net-pay-profile";
import { useAnnualSalaryForecast } from "@/features/salary/use-annual-salary-forecast";
import { useAnnualNetPay } from "./use-annual-net-pay";

export function useAnnualSalaryPayments(
  report: AnnualReport,
  pending: boolean,
  testMonths: readonly string[],
  includeNet = true,
) {
  const enabled = !pending && !testMonths.some((month) => month.startsWith(`${report.year}-`));
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
