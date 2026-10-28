import { Temporal } from "@js-temporal/polyfill";
import type { ComplianceIssue, MonthlyComplianceResult } from "@/domain/types";

/** Shared result assembly for full and empty-horizon checks; assessment ranges stay identical. */
export function finishMonthlyCompliance(
  month: string,
  issues: readonly ComplianceIssue[],
  start: string,
  end: string,
): MonthlyComplianceResult {
  const assessmentRange = {
    from: start,
    through: Temporal.PlainDate.from(end).add({ days: 1 }).toString(),
  };
  const monthIssues = issues
    .filter((item) => item.date.startsWith(`${month}-`))
    .map((finding) =>
      finding.kind === "LEGAL" &&
      finding.assessmentRanges === undefined &&
      [
        "ARBZG_5_REST_11H",
        "ARBZG_11_SUNDAY_REST",
        "ARBZG_11_HOLIDAY_REST",
        "ARBZG_11_REST_CONNECTION",
        "HOLIDAY_CATALOG_COVERAGE",
      ].includes(finding.rule)
        ? { ...finding, assessmentRanges: [assessmentRange] }
        : finding,
    );
  return {
    month,
    assessmentRange,
    issues: monthIssues,
    criticalCount: monthIssues.filter((item) => item.severity === "critical").length,
    warningCount: monthIssues.filter((item) => item.severity === "warning").length,
    infoCount: monthIssues.filter((item) => item.severity === "info").length,
    affectedDates: [...new Set(monthIssues.map((item) => item.date))].sort(),
  };
}
