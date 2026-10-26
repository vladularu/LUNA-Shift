import type { ComplianceInterval } from "./compliance-sequences";
import { Temporal } from "@js-temporal/polyfill";
import { employmentMonthPeriods } from "@/domain/employment-history";
import type { MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import type { ComplianceOptions } from "./compliance";
type Steps = (
  month: string,
  shifts: readonly ShiftEntry[],
  timeZone: string,
  options?: ComplianceOptions,
) => Generator<number, MonthlyComplianceResult, void>;
export function createDatedComplianceCalculator(core: Steps) {
  /** Keep complete assessment windows; only dated input facts and displayed findings vary. */
  function* steps(
    month: string,
    shifts: readonly ShiftEntry[],
    timeZone: string,
    options: ComplianceOptions = {},
  ): Generator<number, MonthlyComplianceResult, void> {
    const history = options.employmentProfile?.employmentTimeline;
    if (!history?.some((item) => item.employment))
      return yield* core(month, shifts, timeZone, options);
    const start = Temporal.PlainDate.from(month + "-01");
    const periods = employmentMonthPeriods(
      options.employmentProfile!,
      month,
      start.with({ day: start.daysInMonth }).toString(),
    );
    const results: MonthlyComplianceResult[] = [];
    for (const period of periods) {
      const p = period.profile;
      const result = yield* core(month, shifts, p.timeZone, {
        ...options,
        employmentAssessmentPeriod: { from: period.from, until: period.until },
        federalState: p.federalState,
        holidayRegion: p.holidayRegion,
        weeklyMinutes: p.weeklyMinutes,
        regularRotatingNightWork: p.regularRotatingNightWork,
        sundayHolidayWorkEligible: p.sundayHolidayWorkEligible,
        allEmploymentWorkRecorded: p.allEmploymentWorkRecorded,
      });
      results.push({
        ...result,
        issues: result.issues.filter(
          (issue) => issue.date >= period.from && (!period.until || issue.date < period.until),
        ),
      });
    }
    const issues = [
      ...new Map(
        results.flatMap((result) => result.issues).map((issue) => [issue.id, issue]),
      ).values(),
    ];
    return {
      ...results[0],
      issues,
      criticalCount: issues.filter((i) => i.severity === "critical").length,
      warningCount: issues.filter((i) => i.severity === "warning").length,
      infoCount: issues.filter((i) => i.severity === "info").length,
      affectedDates: [...new Set(issues.map((i) => i.date))].sort(),
    };
  }

  function calculate(...args: Parameters<Steps>): MonthlyComplianceResult {
    const calculation = steps(...args);
    while (true) {
      const next = calculation.next();
      if (next.done) return next.value;
    }
  }
  return { steps, calculate };
}

export function employmentEvidenceIntervals(
  intervals: readonly ComplianceInterval[],
  options: ComplianceOptions,
) {
  const period = options.employmentAssessmentPeriod;
  return period
    ? intervals.filter(
        (item) =>
          item.shift.date >= period.from && (!period.until || item.shift.date < period.until),
      )
    : intervals;
}
