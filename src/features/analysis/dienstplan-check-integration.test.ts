import { describe, expect, it, vi } from "vitest";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import { work, shift } from "@/engine/remuneration-test-fixtures";
import { bundledRuleResolver, RuleResolutionError } from "@/rules/rule-resolver";
import { buildReportSteps } from "@/features/report-export/report-data";
import { buildAnnualReportSteps } from "./annual-report";
import { classifyChecks, selectVisibleCompliance } from "./check-visibility";
import { groupCheckDisplayIssues } from "./check-display-groups";

vi.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (compute: () => unknown) => {
    try {
      return { ok: true, value: compute() };
    } catch (error) {
      if (!(error instanceof RuleResolutionError)) throw error;
      return { ok: false, error, failure: error.failure };
    }
  },
}));

const nights = Array.from({ length: 6 }, (_, index) => ({
  ...shift({ id: "night-" + index, date: "2026-11-0" + (index + 1) }),
  type: "NIGHT" as const,
  startTime: "21:00",
  endTime: "07:00",
  breakMinutes: 60,
}));
const profile = {
  ...work,
  allEmploymentWorkRecorded: true,
  regularRotatingNightWork: true,
  sundayHolidayWorkEligible: true,
};
const calculate = () =>
  calculateMonthlyCompliance("2026-11", nights, profile.timeZone, {
    federalState: profile.federalState,
    holidayRegion: profile.holidayRegion,
    employmentProfile: profile,
    allEmploymentWorkRecorded: true,
    regularRotatingNightWork: true,
    sundayHolidayWorkEligible: true,
    referenceDate: "2026-11-09",
  });

describe("Dienstplan-Check display integration", () => {
  it("combines two original observations while retaining monthly counts and original values", () => {
    const result = calculate();
    const before = JSON.stringify(result);
    const planning = selectVisibleCompliance(result, true).issues.filter(
      (issue) => issue.kind === "PLANNING",
    );
    expect(planning.map((issue) => issue.rule).sort()).toEqual([
      "PLANNING_7_DAYS",
      "PLANNING_NIGHT_SERIES",
    ]);
    const groups = groupCheckDisplayIssues(planning, nights);
    expect(groups).toHaveLength(1);
    expect([groups[0].primary, ...groups[0].relatedIssues]).toHaveLength(2);
    expect(
      new Set([groups[0].primary.id, ...groups[0].relatedIssues.map((issue) => issue.id)]),
    ).toEqual(new Set(planning.map((issue) => issue.id)));
    const count = classifyChecks(result.issues).planning;
    expect(count.criticalCount + count.warningCount + count.infoCount).toBe(2);
    expect(
      selectVisibleCompliance(result, false).issues.some((issue) => issue.kind === "PLANNING"),
    ).toBe(false);
    expect(JSON.stringify(result)).toBe(before);
  });

  it("keeps the same two planning observations in the actual yearly calculation", () => {
    const steps = buildAnnualReportSteps(
      2026,
      nights,
      profile,
      [],
      undefined,
      undefined,
      "2026-11-09",
      bundledRuleResolver,
    );
    let next = steps.next();
    while (!next.done) next = steps.next();
    const counts = next.value.months.find((month) => month.month === "2026-11")?.checkCounts
      ?.planning;
    expect(counts).toBeDefined();
    expect(
      (counts?.criticalCount ?? 0) + (counts?.warningCount ?? 0) + (counts?.infoCount ?? 0),
    ).toBe(2);
  });

  it("preserves both underlying observations in the actual monthly export", () => {
    const steps = buildReportSteps({
      period: "2026-11",
      entries: nights,
      profile,
      tariffDecisions: [],
      workPatternSettings: { assignment: "UNKNOWN", workplaceCoverage: "UNKNOWN", updatedAt: null },
      ruleResolver: bundledRuleResolver,
      createdAt: "2026-11-09T02:00:00+01:00",
      referenceDate: "2026-11-09",
      youthProtection: false,
      testMonths: [],
    });
    let next = steps.next();
    while (!next.done) next = steps.next();
    const values = next.value.rows.map((row) => row.value);
    expect(values).toContain("PLANNING_7_DAYS");
    expect(values).toContain("PLANNING_NIGHT_SERIES");
  });
});
