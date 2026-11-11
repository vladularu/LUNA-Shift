import type { MonthlyComplianceResult } from "@/domain/types";
import type { MonthlyAnalysisCalculation } from "./monthly-analysis";
import type { AnnualReport } from "./annual-report";
import { SHIFT_TYPES } from "@/domain/types";
import { validTariffComplianceEvidence } from "@/domain/tariff-compliance-validation";
import { validPlanningWeekendAssessment } from "@/domain/planning-weekend-policy";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";

export { persistentSalaryValue } from "./persistent-salary-value";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const numbers = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
const success = (value: unknown): value is { ok: true; value: Record<string, unknown> } =>
  record(value) && value.ok === true && record(value.value);

/** Finished coverage may be unavailable; an unfinished core has no monthly coverage flags. */
export function persistentAnnualValue(value: unknown): value is AnnualReport {
  if (
    !record(value) ||
    !numbers(value, [
      "year",
      "actualMinutes",
      "workMinutes",
      "trainingMinutes",
      "vacationDays",
      "sickDays",
      "freeDays",
      "entryCount",
      "activeMonthCount",
      "availablePayMonthCount",
      "estimatedGrossAmount",
      "premiumAmount",
      "overtimeAmount",
      "allowanceAmount",
      "criticalCount",
      "warningCount",
    ]) ||
    !Number.isInteger(value.year) ||
    Number(value.year) < 1900 ||
    Number(value.year) > 4099 ||
    typeof value.worktimeCoverageComplete !== "boolean" ||
    typeof value.complianceCoverageComplete !== "boolean" ||
    ![value.targetMinutes, value.balanceMinutes].every(
      (item) => item === null || (typeof item === "number" && Number.isFinite(item)),
    ) ||
    !Number.isInteger(value.availablePayMonthCount) ||
    Number(value.availablePayMonthCount) < 0 ||
    Number(value.availablePayMonthCount) > 12 ||
    !(value.distribution instanceof Map) ||
    ![...value.distribution].every(
      ([type, count]) =>
        SHIFT_TYPES.includes(type) &&
        typeof count === "number" &&
        Number.isFinite(count) &&
        count >= 0,
    ) ||
    !Array.isArray(value.months) ||
    value.months.length !== 12
  )
    return false;
  return (
    value.months.every(
      (month: unknown, index: number) =>
        record(month) &&
        month.month === value.year + "-" + String(index + 1).padStart(2, "0") &&
        typeof month.complianceComplete === "boolean" &&
        [month.targetMinutes, month.balanceMinutes].every(
          (item) => item === null || (typeof item === "number" && Number.isFinite(item)),
        ) &&
        (month.estimatedGrossAmount === null ||
          (typeof month.estimatedGrossAmount === "number" &&
            Number.isFinite(month.estimatedGrossAmount))) &&
        numbers(month, [
          "entryCount",
          "actualMinutes",
          "premiumAmount",
          "criticalCount",
          "warningCount",
        ]),
    ) &&
    value.months.every((month: Record<string, unknown>) => month.complianceComplete === true) ===
      value.complianceCoverageComplete &&
    value.months.every((month: Record<string, unknown>) => month.targetMinutes !== null) ===
      value.worktimeCoverageComplete &&
    (value.worktimeCoverageComplete
      ? value.targetMinutes !== null
      : value.targetMinutes === null) &&
    (value.balanceMinutes === null ||
      value.months.every((month: Record<string, unknown>) => month.balanceMinutes !== null)) &&
    value.months.filter(
      (month: unknown) => record(month) && typeof month.estimatedGrossAmount === "number",
    ).length === value.availablePayMonthCount
  );
}

/** Checksums and bundle/catalog versions protect the producer-owned JSON; these guard its shape. */
export function persistentMonthValue(value: unknown): value is MonthlyAnalysisCalculation {
  if (
    !record(value) ||
    !success(value.summary) ||
    !success(value.pay) ||
    !record(value.complianceShifts) ||
    value.complianceShifts.ok !== true
  )
    return false;
  const summary = value.summary.value,
    pay = value.pay.value,
    analysis = value.shiftTypeAnalysis;
  return (
    Array.isArray(value.complianceShifts.value) &&
    Array.isArray(value.monthShifts) &&
    typeof summary.month === "string" &&
    summary.month === pay.month &&
    numbers(summary, ["targetMinutes", "actualMinutes", "balanceMinutes", "overlapMinutes"]) &&
    ["work", "training", "vacation", "sick", "free"].every(
      (key) => record(summary[key]) && numbers(summary[key], ["minutes", "entryCount"]),
    ) &&
    pay.available === true &&
    numbers(pay, ["timePremiumAmount", "overtimeAmount", "allowanceAmount"]) &&
    Array.isArray(pay.shiftBreakdowns) &&
    record(pay.assessment) &&
    record(analysis) &&
    Array.isArray(analysis.items) &&
    numbers(analysis, ["totalCount", "totalMinutes"])
  );
}
export function persistentCheckValue(value: unknown): value is MonthlyComplianceResult {
  const validWeekendFinding = (
    issue: Record<string, unknown>,
    month: unknown,
    assessment: unknown,
  ) => {
    if (issue.rule !== "PLANNING_WEEKEND_RECOVERY") return true;
    const facts = validComplianceIssueFacts(issue.facts, "PLANNING_WEEKEND_RECOVERY");
    // Both copies originate in the same producer and retain JSON property order on persistence.
    // Reject disagreement and recalculate instead of presenting conflicting counts and details.
    return (
      facts?.rule === "PLANNING_WEEKEND_RECOVERY" &&
      facts.assessment.month === month &&
      (assessment === undefined || JSON.stringify(facts.assessment) === JSON.stringify(assessment))
    );
  };
  return (
    record(value) &&
    typeof value.month === "string" &&
    (value.weekendAssessment === undefined ||
      (validPlanningWeekendAssessment(value.weekendAssessment) &&
        value.weekendAssessment.month === value.month)) &&
    numbers(value, ["criticalCount", "warningCount", "infoCount"]) &&
    Array.isArray(value.affectedDates) &&
    value.affectedDates.every((date) => typeof date === "string") &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue: unknown) =>
        record(issue) &&
        typeof issue.id === "string" &&
        typeof issue.title === "string" &&
        typeof issue.description === "string" &&
        typeof issue.rule === "string" &&
        Array.isArray(issue.relatedShiftIds) &&
        ["critical", "warning", "info"].includes(String(issue.severity)) &&
        validWeekendFinding(issue, value.month, value.weekendAssessment) &&
        (issue.tariff === undefined || validTariffComplianceEvidence(issue.tariff, issue.rule)),
    ) &&
    [value.prerequisites, value.scopeNotes].every(
      (items) =>
        items === undefined ||
        (Array.isArray(items) &&
          items.every(
            (item: unknown) =>
              record(item) &&
              validWeekendFinding(item, value.month, value.weekendAssessment) &&
              (item.tariff === undefined ||
                validTariffComplianceEvidence(
                  item.tariff,
                  typeof item.rule === "string" ? item.rule : undefined,
                )),
          )),
    )
  );
}
