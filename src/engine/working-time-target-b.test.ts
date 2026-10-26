import { describe, expect, it, vi } from "vitest";

import type { TargetProfilePeriod, WorkingTimeTargetContext } from "@/domain/working-time-target";
import type { DatedRemunerationProfile } from "@/domain/remuneration-profile";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import { validateWorkingTimeTargetContext } from "@/domain/saved-working-time-target";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { calculateMonthlyWorkingTimeTarget } from "./working-time-target";
import { calculateMonthlySummary, calculateMonthlyTargetMinutes } from "./monthly-summary";
import { work, shift } from "./remuneration-test-fixtures";
import { bundledRuleResolver, RuleResolutionError } from "@/rules/rule-resolver";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { buildAnnualAvailableReportSteps } from "@/features/analysis/annual-core-report";
import { buildReportSteps } from "@/features/report-export/report-data";
import { reportToCsv, reportToHtml } from "@/features/report-export/report-formats";

vi.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (compute: () => unknown) => {
    try {
      return { ok: true, value: compute() };
    } catch (error) {
      if (error instanceof WorkingTimeTargetError)
        return {
          ok: false,
          error,
          failure: {
            kind: "WORKING_TIME",
            code: "WORKING_TIME_TARGET_UNAVAILABLE",
            message: error.message,
          },
        };
      if (error instanceof RuleResolutionError) return { ok: false, error, failure: error.failure };
      throw error;
    }
  },
}));

function finish<T>(steps: Generator<unknown, T, unknown>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

const profile = {
  ...work,
  federalState: "HE" as const,
  weeklyMinutes: 2340,
  sundayHolidayWorkEligible: true,
  tariff: { ...work.tariff!, sector: "BT_B" as const },
};
const period: TargetProfilePeriod = {
  validFrom: "2026-01-01",
  validTo: null,
  weeklyMinutes: 2340,
  federalState: "HE",
  holidayRegion: "NONE",
  model: {
    kind: "ROTATING_FIVE_IN_SEVEN",
    monthlyReference: "WEEKDAYS_ONE_FIFTH",
    sevenDayShiftPlanConfirmed: true,
  },
  tariff: { kind: "TVOED_B", version: "2026-01-01", scopeConfirmed: true },
};
const facts: WorkingTimeTargetContext["days"] = [24, 25, 26, 31].map((day) => ({
  date: "2026-12-" + day,
  rosterStatus: "FINAL",
  disposition: "ROSTER_FREE",
  lostMinutes: 468,
  mustWorkElsewhere: true,
}));
function forecast(
  month: string,
  periods: readonly TargetProfilePeriod[] = [period],
  days: WorkingTimeTargetContext["days"] = [],
) {
  const p = {
    ...profile,
    workingTimeTarget: {
      status: "ready" as const,
      mode: "FORECAST" as const,
      notices: [],
      context: { periods, days },
    },
  };
  return calculateMonthlyWorkingTimeTarget(month, p);
}
const snapshot = (periods: readonly TargetProfilePeriod[]): WorkingTimeTargetSnapshot => ({
  saved: null,
  context: { periods, days: [] },
  staleDates: [],
  planRevision: "plan",
});

describe("TVöD-B / BT-B, independent controls in docs/working-time-target-b.md", () => {
  it.each([
    ["2026-07", 10764, 0, 0, 10764],
    ["2026-10", 10296, 468, 0, 9828],
    ["2026-12", 10764, 936, 936, 8892],
    ["2027-05", 9828, 1872, 0, 7956],
    ["2027-07", 10296, 0, 0, 10296],
    ["2027-12", 10764, 468, 936, 9360],
  ])("calculates %s with its own reviewed rules", (month, base, statutory, special, target) => {
    const result = forecast(month);
    expect(result).toMatchObject({
      baseMinutes: base,
      statutoryReductionMinutes: statutory,
      tariffReductionMinutes: special,
      targetMinutes: target,
      status: "PROVISIONAL",
    });
    expect(result.adjustments.every((a) => a.ruleId.startsWith("tvoed-b-"))).toBe(true);
    expect(
      result.notices.some((n) =>
        ["TARIFF_UNSUPPORTED", "TARIFF_VERSION_UNREVIEWED"].includes(n.code),
      ),
    ).toBe(false);
    expect(new Set(result.adjustments.map((a) => a.date)).size).toBe(result.adjustments.length);
  });
  it.each([
    ["2026-12", 9360],
    ["2027-12", 9828],
  ])("distinguishes fixed weekdays in %s", (month, target) => {
    expect(
      forecast(month, [
        {
          ...period,
          model: { kind: "FIXED_WEEK", weekdayMinutes: [468, 468, 468, 468, 468, 0, 0] },
        },
      ]).targetMinutes,
    ).toBe(target);
  });
  it.each([
    ["2026-12", 6840],
    ["2027-12", 7200],
  ])("uses individual part-time hours in %s", (month, target) => {
    expect(forecast(month, [{ ...period, weeklyMinutes: 1800 }]).targetMinutes).toBe(target);
  });
  it("uses BT-B and the dated AT sources without relabelling BT-K", () => {
    for (const year of [2026, 2027]) {
      const result = forecast(year + "-12");
      expect(result.adjustments.every((a) => a.ruleId.startsWith("tvoed-b-" + year))).toBe(true);
      expect(
        result.adjustments
          .filter((a) => a.kind === "STATUTORY_HOLIDAY")
          .every((a) => a.legalBasis.includes("BT-B") && a.sourceUrl.includes("BT-B")),
      ).toBe(true);
      expect(result.adjustments.find((a) => a.kind === "TARIFF_SPECIAL_DAY")?.sourceUrl).toContain(
        year === 2026 ? "1-1-26.pdf" : "1-1-27.pdf",
      );
    }
    const k: TargetProfilePeriod = {
      ...period,
      weeklyMinutes: 2310,
      tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true },
    };
    expect(forecast("2026-12", [k]).targetMinutes).toBe(8778);
    expect(
      forecast("2026-12", [k]).adjustments.every((a) => a.ruleId.startsWith("tvoed-k-2026-")),
    ).toBe(true);
  });
  it("keeps qualified claims separate from automatic forecasts", () => {
    const result = calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, {
      periods: [period],
      days: facts,
    });
    expect(result).toMatchObject({ targetMinutes: 8892, status: "FINAL" });
    expect(result.adjustments.every((a) => a.status === "CONFIRMED")).toBe(true);
    expect(
      forecast("2026-12", [period], facts).adjustments.every(
        (a) => a.status === "PROFILE_ESTIMATE",
      ),
    ).toBe(true);
  });
  it("does not turn work on 24/31 December into a strict target deduction", () => {
    const days = facts.map((day) => ({ ...day, disposition: "WORK_REQUIRED" as const }));
    const result = calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, {
      periods: [period],
      days,
    });
    expect(result).toMatchObject({ targetMinutes: 9828, tariffReductionMinutes: 0 });
    expect(result.notices.filter((n) => n.code === "COMPENSATORY_LEAVE_SEPARATE")).toHaveLength(2);
    expect(forecast("2026-12", [period], days).targetMinutes).toBe(8892);
  });
  it.each([
    ["WORK_REQUIRED", undefined, 468],
    ["ROSTER_FREE", true, 468],
    ["ROSTER_FREE", false, 0],
  ] as const)(
    "handles the Saturday holiday: %s / %s",
    (disposition, mustWorkElsewhere, reduction) => {
      const result = calculateMonthlyWorkingTimeTarget("2026-10", profile, undefined, {
        periods: [period],
        days: [{ date: "2026-10-03", rosterStatus: "FINAL", disposition, mustWorkElsewhere }],
      });
      expect(result.statutoryReductionMinutes).toBe(reduction);
    },
  );
  it("does not add a Sunday fifth", () => {
    const result = forecast("2026-11", [{ ...period, federalState: "NW" }]);
    expect(result).toMatchObject({ targetMinutes: 9828, statutoryReductionMinutes: 0 });
  });
  it("uses confirmed actual lost minutes instead of a mandatory full reference day", () => {
    const days = facts.map((day) =>
      day.date.endsWith("-24") || day.date.endsWith("-31")
        ? { ...day, disposition: "RELEASED" as const, lostMinutes: 234 }
        : day,
    );
    expect(
      calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, { periods: [period], days })
        .targetMinutes,
    ).toBe(9360);
  });
  it("keeps unknown strict eligibility pending", () => {
    const result = calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, {
      periods: [period],
      days: [],
    });
    expect(result).toMatchObject({ targetMinutes: 10764, status: "PROVISIONAL" });
    expect(result.adjustments.every((a) => a.minutes === 0 && a.status === "PENDING")).toBe(true);
  });
  it.each(["2025-01-01", "unknown"])("keeps unreviewed version %s provisional", (version) => {
    const result = forecast("2026-12", [
      { ...period, tariff: { kind: "TVOED_B", version, scopeConfirmed: true } },
    ]);
    expect(result).toMatchObject({ targetMinutes: 10764, tariffReductionMinutes: 0 });
    expect(result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
  });
  it("does not extend its reviewed year window", () => {
    expect(forecast("2028-12").notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(
      true,
    );
  });
  it("does not overwrite an explicitly denied scope", () => {
    expect(
      forecast("2026-12", [
        { ...period, tariff: { kind: "TVOED_B", version: "2026-01-01", scopeConfirmed: false } },
      ]).targetMinutes,
    ).toBe(10764);
  });
  it("accepts explicit BT-B JSON while preserving legacy contexts", () => {
    expect(
      validateWorkingTimeTargetContext(
        JSON.parse(JSON.stringify({ periods: [period], days: facts })),
      ),
    ).toEqual({ periods: [period], days: facts });
    const old: TargetProfilePeriod = { ...period, tariff: { kind: "UNVERIFIED", id: "BT_B" } };
    expect(
      validateWorkingTimeTargetContext({ periods: [old], days: [] }).periods[0].tariff,
    ).toEqual(old.tariff);
    expect(() =>
      validateWorkingTimeTargetContext({
        periods: [{ ...period, tariff: { ...period.tariff, id: "BT_K" } }],
        days: [],
      }),
    ).toThrow();
  });
});

describe("BT-B reuse of existing employment data", () => {
  it("uses one result in monthly, yearly, CSV and PDF report data", () => {
    const p = createWorkingTimeCalculationProfile(profile, null, []);
    const pattern = {
      assignment: "UNKNOWN" as const,
      workplaceCoverage: "UNKNOWN" as const,
      updatedAt: null,
    };
    const yearly = finish(
      buildAnnualAvailableReportSteps(2026, [], p, [], pattern, "2026-12-31", bundledRuleResolver),
    );
    expect(yearly.months[11]).toMatchObject({ targetMinutes: 8892, targetStatus: "PROVISIONAL" });
    const exported = finish(
      buildReportSteps({
        period: "2026-12",
        profile: p,
        entries: [],
        tariffDecisions: [],
        workPatternSettings: pattern,
        ruleResolver: bundledRuleResolver,
        createdAt: "2026-12-31T12:00:00Z",
        referenceDate: "2026-12-31",
        youthProtection: false,
        testMonths: [],
      }),
    );
    expect(exported.workingTimeTargets?.[0].targetMinutes).toBe(
      calculateMonthlyTargetMinutes("2026-12", p),
    );
    expect(reportToCsv(exported)).toContain('"148:12"');
    expect(reportToHtml(exported)).toContain("148:12 h");
  });
  it("calculates automatically without adding or saving profile fields", () => {
    const before = JSON.stringify(profile);
    const p = createWorkingTimeCalculationProfile(profile, null, []);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8892);
    expect(calculateMonthlyTargetMinutes("2027-12", p)).toBe(9360);
    expect(p.workingTimeTarget?.context?.periods[0].tariff).toEqual({
      kind: "TVOED_B",
      version: "2026-01-01",
      scopeConfirmed: null,
    });
    expect(JSON.stringify(profile)).toBe(before);
    expect(calculateMonthlySummary("2026-12", [], p)).toMatchObject({
      targetMinutes: 8892,
      actualMinutes: 0,
    });
  });
  it("uses the existing no-Sunday answer as a fixed-week forecast", () => {
    const p = createWorkingTimeCalculationProfile(
      { ...profile, sundayHolidayWorkEligible: false },
      null,
      [],
    );
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(9360);
  });
  it("does not let recorded services change the forecast or actual work totals", () => {
    const entries = [24, 31].map((day) => shift({ id: String(day), date: "2026-12-" + day }));
    const p = createWorkingTimeCalculationProfile(profile, null, [], "ready", entries);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8892);
    expect(calculateMonthlySummary("2026-12", entries, p).actualMinutes).toBe(
      calculateMonthlySummary("2026-12", entries, profile).actualMinutes,
    );
  });
  it.each(["BT_B", "tvoed-vka-bt-k/BT_B"])(
    "recognizes the known historical marker %s without rewriting it",
    (id) => {
      const saved = snapshot([{ ...period, tariff: { kind: "UNVERIFIED", id } }]);
      const before = JSON.stringify(saved);
      expect(
        calculateMonthlyTargetMinutes(
          "2026-12",
          createWorkingTimeCalculationProfile(profile, saved, []),
        ),
      ).toBe(8892);
      expect(JSON.stringify(saved)).toBe(before);
    },
  );
  it("leaves an ambiguous historical salary marker unresolved", () => {
    const saved = snapshot([
      { ...period, tariff: { kind: "UNVERIFIED", id: "CURRENT_SALARY_SELECTION" } },
    ]);
    const p = createWorkingTimeCalculationProfile(profile, saved, []);
    expect(p.workingTimeTarget?.context?.periods[0].tariff.kind).toBe("UNVERIFIED");
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(10296);
  });
  it("applies a dated K-to-B switch without changing earlier days", () => {
    const saved = snapshot([
      {
        ...period,
        weeklyMinutes: 2310,
        tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true },
      },
    ]);
    const history: DatedRemunerationProfile[] = [
      {
        effectiveFrom: "2026-12-16",
        revision: 1,
        createdAt: "2026-12-01T12:00:00Z",
        updatedAt: "2026-12-01T12:00:00Z",
        data: {
          version: 1,
          weeklyMinutes: 2340,
          selection: {
            kind: "tariff",
            packageId: "tvoed-vka-bt-k",
            variant: "BT_B",
            region: "OTHER",
            group: "P8",
            level: "4",
            fullTimeWeeklyMinutes: 2340,
          },
        },
      },
    ];
    const p = createWorkingTimeCalculationProfile(profile, saved, history);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8826);
    expect(p.workingTimeTarget?.context?.periods.map((p) => p.tariff.kind)).toEqual([
      "TVOED_K",
      "TVOED_B",
    ]);
  });
  it("keeps own salary and conflicts outside automatic tariff claims", () => {
    for (const p of [
      { ...profile, tariff: null },
      { ...profile, salaryBasisConflict: { tariff: profile.tariff } },
    ]) {
      const result = calculateMonthlyWorkingTimeTarget(
        "2026-12",
        createWorkingTimeCalculationProfile(p, null, []),
      );
      expect(result.tariffReductionMinutes).toBe(0);
      expect(result.adjustments.some((a) => a.ruleId.startsWith("tvoed-b-"))).toBe(false);
    }
  });
});
