import type { AnnualReport } from "./annual-report";
import { withAnnualSalaryPayments } from "./annual-salary-payments";
import { useNetPayProfile } from "@/features/salary/use-net-pay-profile";
import { useAnnualSalaryForecast } from "@/features/salary/use-annual-salary-forecast";

export function useAnnualSalaryPayments(
  report: AnnualReport,
  pending: boolean,
  testMonths: readonly string[],
) {
  const enabled = !pending && !testMonths.some((month) => month.startsWith(`${report.year}-`));
  const data = useNetPayProfile(`${report.year}-12`, enabled);
  const annual = useAnnualSalaryForecast(
    report.year,
    data.annualPayments,
    enabled && data.status === "ready",
    testMonths,
  );
  return {
    report:
      enabled && data.status === "ready"
        ? withAnnualSalaryPayments(report, data.timeline, annual.payments)
        : report,
    loading: enabled && data.status === "loading",
    error: enabled ? data.error : null,
  };
}
