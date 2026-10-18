import { annualSalaryGrossCents, type AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import {
  collectAnnualSalaryPayments,
  type SavedMonthlyNetPaySettings,
} from "@/domain/net-pay-profile";
import type { AnnualReport } from "./annual-report";

/** Applied once to the base report. Unavailable base months stay unavailable. */
export function withAnnualSalaryPayments(
  report: AnnualReport,
  timeline: readonly SavedMonthlyNetPaySettings[],
  payments: readonly AnnualSalaryPayment[] = collectAnnualSalaryPayments(timeline),
): AnnualReport {
  let addedCents = 0;
  let totalCents = 0;
  const months = report.months.map((month) => {
    if (month.estimatedGrossAmount === null) return month;
    const amount = annualSalaryGrossCents(month.month, payments);
    const previous = Math.round((month.annualPaymentAmount ?? 0) * 100);
    addedCents += amount - previous;
    totalCents += amount;
    return amount !== previous
      ? {
          ...month,
          annualPaymentAmount: amount / 100,
          estimatedGrossAmount:
            Math.round(month.estimatedGrossAmount * 100 + amount - previous) / 100,
        }
      : month;
  });
  return addedCents
    ? {
        ...report,
        months,
        annualPaymentAmount: totalCents / 100,
        estimatedGrossAmount: Math.round(report.estimatedGrossAmount * 100 + addedCents) / 100,
      }
    : report;
}
