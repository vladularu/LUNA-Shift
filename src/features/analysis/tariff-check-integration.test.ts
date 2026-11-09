import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import { work, shift } from "@/engine/remuneration-test-fixtures";
import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { bundledRuleResolver, RuleResolutionError } from "@/rules/rule-resolver";
import { buildReportSteps } from "@/features/report-export/report-data";
import type { UserProfile } from "@/domain/types";
import { classifyChecks, selectVisibleCompliance } from "./check-visibility";
import { monthlyComplianceKey } from "./analysis-compliance-cache";

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

function duties(first = "2026-11-02", count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const date = Temporal.PlainDate.from(first).add({ days: index }).toString();
    return shift({
      id: `duty-${date}`,
      date,
      type: "DAY",
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 30,
    });
  });
}

function checks(entries = duties(), profile: UserProfile = work) {
  return calculateMonthlyCompliance("2026-11", entries, profile.timeZone, {
    employmentProfile: profile,
    allEmploymentWorkRecorded: true,
    regularRotatingNightWork: true,
    sundayHolidayWorkEligible: true,
    referenceDate: "2026-11-30",
  });
}

describe("tariff rules integrated into the existing legal check", () => {
  it("checks seven duties in one calendar week against the selected tariff", () => {
    const tariff = checks().issues.filter((issue) => issue.rule === "TARIFF_WEEK_DAYS");
    expect(tariff).toHaveLength(1);
    expect(tariff[0]).toMatchObject({ kind: "LEGAL", tariff: { status: "REVIEW", count: 7 } });
  });

  it("does not confuse seven consecutive duties with seven days in one calendar week", () => {
    expect(
      checks(duties("2026-11-04")).issues.some((issue) => issue.rule === "TARIFF_WEEK_DAYS"),
    ).toBe(false);
  });

  it("keeps tariff findings visible and classified as legal when recommendations are off", () => {
    const result = checks();
    const tariff = result.issues.filter((issue) => issue.rule.startsWith("TARIFF_"));
    expect(tariff.length).toBeGreaterThan(0);
    const visible = selectVisibleCompliance(result, false);
    expect(visible.issues).toEqual(expect.arrayContaining(tariff));
    expect(visible.issues.some((issue) => issue.kind === "PLANNING")).toBe(false);
    expect(classifyChecks(tariff).planning).toMatchObject({
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
    });
    expect(classifyChecks(tariff).legal.infoCount).toBeGreaterThan(0);
  });

  it("resolves the same tariff for saved and derived forecast profiles without using forecast as proof", () => {
    const calculated = createWorkingTimeCalculationProfile(work, null, []);
    const select = (profile: UserProfile) =>
      checks(duties(), profile).issues.filter((issue) => issue.rule.startsWith("TARIFF_"));
    expect(select(calculated)).toEqual(select(work));
  });

  it("includes the same tariff rule in the exported monthly check", () => {
    const entries = duties();
    const result = checks(entries);
    const steps = buildReportSteps({
      period: "2026-11",
      entries,
      profile: work,
      tariffDecisions: [],
      workPatternSettings: { assignment: "UNKNOWN", workplaceCoverage: "UNKNOWN", updatedAt: null },
      ruleResolver: bundledRuleResolver,
      createdAt: "2026-11-30T12:00:00+01:00",
      referenceDate: "2026-11-30",
      youthProtection: false,
      testMonths: [],
    });
    let next = steps.next();
    while (!next.done) next = steps.next();
    const rows = next.value.rows.map((row) => row.value);
    for (const issue of result.issues.filter((issue) => issue.rule.startsWith("TARIFF_")))
      expect(rows).toContain(issue.rule);
    expect(rows).toContain("TARIFF_WEEK_DAYS");
  });

  it("does not reuse pre-tariff check cache entries for identical calendar inputs", () => {
    const entries = duties();
    const key = monthlyComplianceKey("2026-11", work, "2026-11-30", entries, false);
    const legacyKey = JSON.stringify(["2026-11", work, "2026-11-30", entries, false]);
    expect(key).not.toBe(legacyKey);
  });
});
