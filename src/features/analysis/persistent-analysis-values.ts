import type { MonthlyComplianceResult } from "@/domain/types";
import type { MonthlyAnalysisCalculation } from "./monthly-analysis";
import type { PreparedAnalysisSalary } from "./analysis-salary";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const numbers = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
const success = (value: unknown): value is { ok: true; value: Record<string, unknown> } =>
  record(value) && value.ok === true && record(value.value);

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
  return (
    record(value) &&
    typeof value.month === "string" &&
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
        ["critical", "warning", "info"].includes(String(issue.severity)),
    )
  );
}
export function persistentSalaryValue(value: unknown): value is PreparedAnalysisSalary {
  if (
    !record(value) ||
    !record(value.annual) ||
    !record(value.annual.proposal) ||
    !Array.isArray(value.annual.payments) ||
    typeof value.annual.automatic !== "boolean"
  )
    return false;
  if (
    !numbers(value.annual.proposal, ["grossCents", "basisCents", "rateBasisPoints"]) ||
    !Array.isArray(value.annual.proposal.referenceMonths)
  )
    return false;
  return (
    value.forecast === null ||
    (record(value.forecast) &&
      record(value.forecast.result) &&
      value.forecast.result.status === "available" &&
      record(value.forecast.result.pay))
  );
}
