import type { ComplianceIssue, MonthlyComplianceResult } from "@/domain/types";
import type { AnnualReport } from "./annual-report";

export interface CheckCounts {
  readonly scopeCount?: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly prerequisiteCount?: number;
  readonly tariffPrerequisiteCount?: number;
}
export interface ClassifiedCheckCounts {
  readonly legal: CheckCounts;
  readonly planning: CheckCounts;
}
const emptyCounts = (): CheckCounts => ({ criticalCount: 0, warningCount: 0, infoCount: 0 });
const isRetiredPlanningIssue = (issue: ComplianceIssue) =>
  issue.kind === "PLANNING" && issue.rule === "PLANNING_WEEKENDS";

export function isCheckScopeNotice(issue: ComplianceIssue): boolean {
  return issue.rule === "SPECIAL_DUTY_REVIEW" && issue.severity !== "critical";
}

export function isCheckLimited(counts: Pick<CheckCounts, "prerequisiteCount" | "scopeCount">) {
  return (counts.prerequisiteCount ?? 0) > 0 || (counts.scopeCount ?? 0) > 0;
}

// Only known prerequisites are separated. Critical findings and unfamiliar rules stay visible.
export function isCheckPrerequisite(issue: ComplianceIssue): boolean {
  return (
    issue.severity !== "critical" &&
    [
      "ARBZG_DATA_ALL_EMPLOYMENT",
      "ARBZG_6_NIGHT_STATUS_UNKNOWN",
      "HOLIDAY_REGION_UNKNOWN",
      "ARBZG_10_ELIGIBILITY",
      "TARIFF_SCOPE",
    ].includes(issue.rule)
  );
}

export function countChecks(issues: readonly ComplianceIssue[]): CheckCounts {
  const findings = issues.filter(
    (issue) =>
      !isRetiredPlanningIssue(issue) && !isCheckPrerequisite(issue) && !isCheckScopeNotice(issue),
  );
  const prerequisiteCount = issues.filter(isCheckPrerequisite).length;
  const tariffPrerequisiteCount = issues.filter(
    (issue) => issue.rule === "TARIFF_SCOPE" && isCheckPrerequisite(issue),
  ).length;
  const scopeCount = issues.some(isCheckScopeNotice) ? 1 : 0;
  return {
    criticalCount: findings.filter((issue) => issue.severity === "critical").length,
    warningCount: findings.filter((issue) => issue.severity === "warning").length,
    infoCount: findings.filter((issue) => issue.severity === "info").length,
    ...(prerequisiteCount ? { prerequisiteCount } : {}),
    ...(tariffPrerequisiteCount ? { tariffPrerequisiteCount } : {}),
    ...(scopeCount ? { scopeCount } : {}),
  };
}
export function classifyChecks(issues: readonly ComplianceIssue[]): ClassifiedCheckCounts {
  return {
    legal: countChecks(issues.filter((issue) => issue.kind !== "PLANNING")),
    planning: countChecks(issues.filter((issue) => issue.kind === "PLANNING")),
  };
}
export function addCheckCounts(a: CheckCounts, b: CheckCounts): CheckCounts {
  const prerequisiteCount = (a.prerequisiteCount ?? 0) + (b.prerequisiteCount ?? 0);
  const tariffPrerequisiteCount =
    (a.tariffPrerequisiteCount ?? 0) + (b.tariffPrerequisiteCount ?? 0);
  const scopeCount = (a.scopeCount ?? 0) + (b.scopeCount ?? 0);
  return {
    criticalCount: a.criticalCount + b.criticalCount,
    warningCount: a.warningCount + b.warningCount,
    infoCount: a.infoCount + b.infoCount,
    ...(prerequisiteCount ? { prerequisiteCount } : {}),
    ...(tariffPrerequisiteCount ? { tariffPrerequisiteCount } : {}),
    ...(scopeCount ? { scopeCount } : {}),
  };
}
export function selectVisibleCompliance(
  result: MonthlyComplianceResult,
  showPlanning: boolean,
): MonthlyComplianceResult {
  // Re-project safely even if a previously separate note becomes a real finding.
  const originalIssues = [
    ...new Map(
      [...(result.scopeNotes ?? []), ...result.issues].map((issue) => [issue.id, issue]),
    ).values(),
  ].filter((issue) => !isRetiredPlanningIssue(issue));
  const scopeNotes = [
    ...new Map(
      originalIssues.filter(isCheckScopeNotice).map((issue) => [issue.id, issue]),
    ).values(),
  ];
  const prerequisites = [
    ...new Map(
      [...(result.prerequisites ?? []), ...originalIssues.filter(isCheckPrerequisite)]
        .filter((issue) => !isRetiredPlanningIssue(issue))
        .map((issue) => [issue.id, issue]),
    ).values(),
  ];
  const issues = originalIssues.filter(
    (issue) =>
      !isCheckPrerequisite(issue) &&
      !isCheckScopeNotice(issue) &&
      (showPlanning || issue.kind !== "PLANNING"),
  );
  const {
    scopeNotes: _scopeNotes,
    scopeCount: _scopeCount,
    prerequisites: _prerequisites,
    prerequisiteCount: _prerequisiteCount,
    tariffPrerequisiteCount: _tariffPrerequisiteCount,
    ...base
  } = result as MonthlyComplianceResult & CheckCounts;
  const tariffPrerequisiteCount = prerequisites.filter(
    (issue) => issue.rule === "TARIFF_SCOPE" && isCheckPrerequisite(issue),
  ).length;
  return {
    ...base,
    issues,
    ...countChecks(issues),
    ...(prerequisites.length ? { prerequisites, prerequisiteCount: prerequisites.length } : {}),
    ...(tariffPrerequisiteCount ? { tariffPrerequisiteCount } : {}),
    ...(scopeNotes.length ? { scopeNotes, scopeCount: 1 } : {}),
    affectedDates: [...new Set(issues.map((issue) => issue.date))].sort(),
  };
}
export function selectAnnualCheckDisplay(
  report: AnnualReport,
  showPlanning: boolean,
): AnnualReport {
  const months = report.months.map((month) => {
    // Older/test reports without category metadata must never hide unknown legal findings.
    const counts = month.checkCounts
      ? showPlanning
        ? addCheckCounts(month.checkCounts.legal, month.checkCounts.planning)
        : month.checkCounts.legal
      : {
          criticalCount: month.criticalCount,
          warningCount: month.warningCount,
          infoCount: month.infoCount ?? 0,
        };
    return { ...month, ...counts };
  });
  const totals = months.reduce<CheckCounts>(
    (sum, month) => addCheckCounts(sum, month),
    emptyCounts(),
  );
  return { ...report, months, ...totals };
}
