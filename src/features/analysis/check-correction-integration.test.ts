import { describe, expect, it, vi } from "vitest";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import { work, shift } from "@/engine/remuneration-test-fixtures";
import { buildReportSteps } from "@/features/report-export/report-data";
import { bundledRuleResolver, RuleResolutionError } from "@/rules/rule-resolver";
import { annualInputKey } from "./annual-core-report";
import { buildAnnualReportSteps } from "./annual-report";
import { monthlyComplianceKey } from "./analysis-compliance-cache";
import { classifyChecks, selectVisibleCompliance } from "./check-visibility";

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

// Reconstruct only the visible service intervals, not the user's legal applicability.
function screenshotPlan(december = false) {
  const late = [
    "10-26",
    "10-28",
    "10-29",
    "11-05",
    "11-06",
    "11-14",
    "11-15",
    "11-16",
    "11-21",
    "11-22",
  ];
  const day = ["10-27", "11-10", "11-11", "11-12", "11-24", "11-25", "11-26"];
  const early = ["11-19", "11-20"];
  const night = ["10-31", "11-01", "11-02", "11-27", "11-28", "11-29"];
  const entries = [
    ...late.map((date) =>
      shift({
        id: date,
        date: `2026-${date}`,
        type: "LATE",
        startTime: "13:18",
        endTime: "21:30",
        breakMinutes: 30,
      }),
    ),
    ...day.map((date) =>
      shift({
        id: date,
        date: `2026-${date}`,
        type: "DAY",
        startTime: "08:00",
        endTime: "16:12",
        breakMinutes: 30,
      }),
    ),
    ...early.map((date) =>
      shift({
        id: date,
        date: `2026-${date}`,
        type: "EARLY",
        startTime: "07:00",
        endTime: "15:12",
        breakMinutes: 30,
      }),
    ),
    ...night.map((date) =>
      shift({
        id: date,
        date: `2026-${date}`,
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:30",
        breakMinutes: 45,
      }),
    ),
  ];
  if (december)
    for (const date of ["12-02", "12-03", "12-04", "12-05", "12-06"])
      entries.push(
        shift({
          id: date,
          date: `2026-${date}`,
          type: "LATE",
          startTime: "13:18",
          endTime: "21:30",
          breakMinutes: 30,
        }),
      );
  return entries;
}

function calculate(month = "2026-11", entries = screenshotPlan()) {
  return calculateMonthlyCompliance(month, entries, work.timeZone, {
    employmentProfile: work,
    allEmploymentWorkRecorded: true,
    regularRotatingNightWork: true,
    sundayHolidayWorkEligible: true,
    referenceDate: "2026-11-08",
  });
}

describe("correction of the photographed November checks", () => {
  it("keeps the service-series recommendation without six-day tariff cards", () => {
    const result = calculate();
    expect(result.issues.filter((issue) => issue.rule === "TARIFF_WEEK_DAYS")).toHaveLength(0);
    const series = result.issues.filter((issue) => issue.rule === "PLANNING_7_DAYS");
    expect(series).toHaveLength(1);
    expect(series[0].facts).toMatchObject({ count: 6 });
  });

  it("replaces three-weekend guidance with a separate four-week assessment and monthly counts", () => {
    const result = calculate();
    expect(result.issues.some((issue) => issue.rule === "PLANNING_WEEKENDS")).toBe(false);
    expect(result.weekendAssessment).toMatchObject({
      totalCount: 5,
      occupiedCount: 4,
      freeCount: 1,
      unknownCount: 0,
    });
    const weekends = result.issues.filter((issue) => issue.rule === "PLANNING_WEEKEND_RECOVERY");
    expect(weekends).toHaveLength(1);
    expect(weekends[0]).toMatchObject({
      kind: "PLANNING",
      facts: { rule: "PLANNING_WEEKEND_RECOVERY", assessment: { month: "2026-11" } },
    });
    expect(classifyChecks(weekends).legal.infoCount).toBe(0);
    expect(
      selectVisibleCompliance(result, false).issues.some((issue) => issue.kind === "PLANNING"),
    ).toBe(false);
    expect(selectVisibleCompliance(result, false).weekendAssessment).toEqual(
      result.weekendAssessment,
    );
    expect(selectVisibleCompliance(result, false).issues).toEqual(
      result.issues.filter((issue) => issue.kind !== "PLANNING"),
    );
  });

  it("keeps November statistics stable while assessing December windows across the month boundary", () => {
    const entries = screenshotPlan(true);
    const novemberResult = calculate("2026-11", entries);
    const decemberResult = calculate("2026-12", entries);
    expect(novemberResult.weekendAssessment).toEqual(calculate().weekendAssessment);
    expect(decemberResult.weekendAssessment).toMatchObject({
      totalCount: 4,
      occupiedCount: 1,
      freeCount: 3,
      unknownCount: 0,
    });
    expect(decemberResult.weekendAssessment!.windows[0]).toMatchObject({
      from: "2026-11-09",
      until: "2026-12-06",
      assessmentComplete: true,
      freeCount: 0,
    });
    const november = novemberResult.issues.filter(
      (issue) => issue.rule === "PLANNING_WEEKEND_RECOVERY",
    );
    const december = decemberResult.issues.filter(
      (issue) => issue.rule === "PLANNING_WEEKEND_RECOVERY",
    );
    expect(november).toHaveLength(1);
    expect(december).toHaveLength(1);
    expect(november[0].date.startsWith("2026-11-")).toBe(true);
    expect(december[0].date.startsWith("2026-12-")).toBe(true);
    expect(november[0].id).not.toBe(december[0].id);
  });

  it("exports the four-week evidence with readable labels and without the retired rule", () => {
    const steps = buildReportSteps({
      period: "2026-11",
      entries: screenshotPlan(),
      profile: work,
      tariffDecisions: [],
      workPatternSettings: { assignment: "UNKNOWN", workplaceCoverage: "UNKNOWN", updatedAt: null },
      ruleResolver: bundledRuleResolver,
      createdAt: "2026-11-08T12:00:00+01:00",
      referenceDate: "2026-11-08",
      youthProtection: false,
      testMonths: [],
    });
    let next = steps.next();
    while (!next.done) next = steps.next();
    const rows = next.value.rows.map((row) => row.value);
    expect(rows).toContain("PLANNING_WEEKEND_RECOVERY");
    expect(rows).not.toContain("PLANNING_WEEKENDS");
    expect(rows).not.toContain("TARIFF_WEEK_DAYS");
    const periodLabel = next.value.rows.find((row) =>
      row.field.endsWith("assessment.windows.0.assessmentComplete"),
    )?.label;
    expect(periodLabel).toContain("Wochenendprüfung");
    expect(periodLabel).toContain("Vier-Wochen-Zeiträume");
    expect(periodLabel).toContain("Vollständig prüfbar");
  });

  it("retains the distinct November and December observations in the actual annual report", () => {
    const profile = {
      ...work,
      allEmploymentWorkRecorded: true,
      regularRotatingNightWork: true,
      sundayHolidayWorkEligible: true,
    };
    const steps = buildAnnualReportSteps(
      2026,
      screenshotPlan(true),
      profile,
      [],
      undefined,
      undefined,
      "2026-11-08",
      bundledRuleResolver,
    );
    let next = steps.next();
    while (!next.done) next = steps.next();
    const report = next.value;
    const count = (month: string) => {
      const checks = report.months.find((item) => item.month === month)?.checkCounts?.planning;
      return (checks?.criticalCount ?? 0) + (checks?.warningCount ?? 0) + (checks?.infoCount ?? 0);
    };
    expect(count("2026-11")).toBe(2);
    expect(count("2026-12")).toBe(1);
  });

  it("invalidates pre-correction monthly and annual cache namespaces", () => {
    for (const previous of [
      "2026-11-08-tariff-1",
      "2026-11-08-weekends-compact-2",
      "2026-11-09-night-series-four",
    ]) {
      expect(
        JSON.parse(monthlyComplianceKey("2026-11", work, "2026-11-08", screenshotPlan(), false))[0],
      ).not.toBe(previous);
      expect(JSON.parse(annualInputKey({ year: 2026 }))[0]).not.toBe(previous);
    }
  });
});
