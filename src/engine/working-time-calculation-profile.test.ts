import { resolveProfileHolidayMapForMonth } from "./holidays";
import { employmentDataFromProfile } from "@/domain/employment-history";
import { describe, expect, it, vi } from "vitest";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { calculateMonthlyWorkingTimeTarget } from "./working-time-target";
import { calculateMonthlySummary } from "./monthly-summary";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import { work, history, shift } from "./remuneration-test-fixtures";
import { calculateMonthlyAnalysis } from "@/features/analysis/monthly-analysis";
import { buildMonthlyHoursSeries } from "@/features/calendar/calendar-metrics";
import {
  buildAnnualAvailableReportSteps,
  createAnnualAvailableReportCache,
} from "@/features/analysis/annual-core-report";
import { buildReportSteps } from "@/features/report-export/report-data";
import { reportToCsv, reportToHtml } from "@/features/report-export/report-formats";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { bundledRuleResolver, RuleResolutionError } from "@/rules/rule-resolver";
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
const profile = { ...work, federalState: "HE" as const };
const snapshot: WorkingTimeTargetSnapshot = {
  saved: null,
  context: decemberTargetContext,
  staleDates: [],
  planRevision: "plan",
};
const pattern = {
  assignment: "UNKNOWN" as const,
  workplaceCoverage: "UNKNOWN" as const,
  updatedAt: null,
};
function finish<T>(steps: Generator<unknown, T, unknown>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
function annual(
  calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, []),
  cache = createAnnualAvailableReportCache(),
  entries: ReturnType<typeof shift>[] = [],
) {
  return finish(
    buildAnnualAvailableReportSteps(
      2026,
      entries,
      calculationProfile,
      [],
      pattern,
      "2026-12-31",
      bundledRuleResolver,
      { cache },
    ),
  );
}
function report(
  calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, []),
  entries: ReturnType<typeof shift>[] = [],
) {
  return finish(
    buildReportSteps({
      period: "2026-12",
      profile: calculationProfile,
      entries,
      tariffDecisions: [],
      workPatternSettings: pattern,
      ruleResolver: bundledRuleResolver,
      createdAt: "2026-12-31T12:00:00Z",
      referenceDate: "2026-12-31",
      youthProtection: false,
      testMonths: [],
    }),
  );
}

describe("shared working-time calculation profile", () => {
  it("uses a dated workplace in the calendar without changing earlier holidays", () => {
    const old = {
      ...history(),
      effectiveFrom: null,
      employment: employmentDataFromProfile(profile),
    };
    const next = {
      ...history("2026-11-01"),
      employment: employmentDataFromProfile({ ...profile, federalState: "NW" }),
    };
    const p = { ...profile, federalState: "NW" as const, employmentTimeline: [old, next] };
    expect(resolveProfileHolidayMapForMonth("2026-11", p).holidays.has("2026-11-01")).toBe(true);
    expect(resolveProfileHolidayMapForMonth("2026-06", p).holidays.has("2026-06-04")).toBe(true);
    expect(resolveProfileHolidayMapForMonth("2026-01", p).holidays.has("2026-01-06")).toBe(false);
  });
  it("does not replace a confirmed working-time tariff when only a salary amount is corrected", () => {
    const own = { ...profile, tariff: null, manualMonthlyGrossCents: 300000 };
    const base = {
      ...history(),
      effectiveFrom: null,
      employmentOverrides: { manualMonthlyGrossCents: "2026-10-25" },
      data: {
        version: 1 as const,
        weeklyMinutes: profile.weeklyMinutes,
        selection: { kind: "own-monthly" as const, monthlyGrossCents: 300000 },
      },
      employment: employmentDataFromProfile(own),
    };
    const calculation = createWorkingTimeCalculationProfile(own, snapshot, [base]);
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(8778);
  });
  it.each([
    { fields: ["weeklyMinutes"], target: 7200 },
    { fields: ["weeklyMinutes", "sundayHolidayWorkEligible"], target: 6840 },
  ])(
    "keeps old fixed days unless the Sunday answer is explicitly corrected: $fields",
    ({ fields, target }) => {
      const base = {
        ...history(),
        effectiveFrom: null,
        employmentOverrides: Object.fromEntries(fields.map((field) => [field, "2026-10-25"])),
        data: { ...history().data, weeklyMinutes: 1800 },
        employment: employmentDataFromProfile({
          ...profile,
          weeklyMinutes: 1800,
          sundayHolidayWorkEligible: true,
        }),
      };
      const fixed = {
        ...snapshot,
        context: {
          ...decemberTargetContext,
          periods: decemberTargetContext.periods.map((period) => ({
            ...period,
            model: {
              kind: "FIXED_WEEK" as const,
              weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] as const,
            },
          })),
        },
      };
      const calculation = createWorkingTimeCalculationProfile(
        { ...profile, weeklyMinutes: 1800 },
        fixed,
        [base],
      );
      expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(target);
    },
  );
  it.each(["2026-10-26T12:00:00Z", "2027-02-01T12:00:00Z"])(
    "retains a legacy future hours change regardless of later viewing date %s",
    (now) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      try {
        const base = {
          ...history(),
          effectiveFrom: null,
          employmentOverrides: { weeklyMinutes: "2026-10-25" },
          data: { ...history().data, weeklyMinutes: 1800 },
          employment: employmentDataFromProfile({ ...profile, weeklyMinutes: 1800 }),
        };
        const old = decemberTargetContext.periods[0];
        const legacy = {
          ...snapshot,
          context: {
            ...decemberTargetContext,
            periods: [
              { ...old, validFrom: "2026-01-01", validTo: "2026-11-30" },
              { ...old, validFrom: "2026-12-01", validTo: null, weeklyMinutes: 2100 },
            ],
          },
        };
        const calculation = createWorkingTimeCalculationProfile(
          { ...profile, weeklyMinutes: 1800 },
          legacy,
          [base],
        );
        expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(7980);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("preserves a planned legacy five-day model while carrying the corrected weekly basis", () => {
    const base = {
      ...history(),
      effectiveFrom: null,
      employmentOverrides: { weeklyMinutes: "2026-10-25", sundayHolidayWorkEligible: "2026-10-25" },
      data: { ...history().data, weeklyMinutes: 1800 },
      employment: employmentDataFromProfile({
        ...profile,
        weeklyMinutes: 1800,
        sundayHolidayWorkEligible: true,
      }),
    };
    const old = decemberTargetContext.periods[0];
    const legacy = {
      ...snapshot,
      context: {
        ...decemberTargetContext,
        periods: [
          { ...old, validFrom: "2026-01-01", validTo: "2026-11-30" },
          {
            ...old,
            validFrom: "2026-12-01",
            validTo: null,
            model: {
              kind: "FIXED_WEEK" as const,
              weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] as const,
            },
          },
        ],
      },
    };
    const calculation = createWorkingTimeCalculationProfile(
      { ...profile, weeklyMinutes: 1800 },
      legacy,
      [base],
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(7200);
  });
  it("shares an explicit corrected baseline across old target setup, calendar, month, year and export", () => {
    const base = {
      ...history(),
      effectiveFrom: null,
      employmentOverrides: { weeklyMinutes: "2026-10-25" },
      data: { ...history().data, weeklyMinutes: 1800 },
      employment: employmentDataFromProfile({ ...profile, weeklyMinutes: 1800 }),
    };
    const calculation = createWorkingTimeCalculationProfile(
      { ...profile, weeklyMinutes: 1800 },
      snapshot,
      [base],
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(6840);
    expect(calculateMonthlySummary("2026-12", [], calculation).targetMinutes).toBe(6840);
    expect(annual(calculation).months[11].targetMinutes).toBe(6840);
    expect(report(calculation).workingTimeTargets?.[0].targetMinutes).toBe(6840);
  });
  it("shares a mid-month dated hours change across calendar, month, year and export", () => {
    const old = {
      ...history(),
      effectiveFrom: null,
      employment: employmentDataFromProfile(profile),
    };
    const next = {
      ...history("2026-12-16", "P5", 1155),
      employment: employmentDataFromProfile({ ...profile, weeklyMinutes: 1155 }),
    };
    const calculation = createWorkingTimeCalculationProfile(
      { ...profile, weeklyMinutes: 1155 },
      null,
      [old, next],
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(6930);
    expect(calculateMonthlySummary("2026-12", [], calculation).targetMinutes).toBe(6930);
    expect(annual(calculation).months[11].targetMinutes).toBe(6930);
    expect(report(calculation).workingTimeTargets?.[0].targetMinutes).toBe(6930);
    expect(JSON.stringify(report(calculation).rows)).not.toContain("employmentTimeline");
  });
  it("marks contractual forecasts explicitly and does not read calendar entries", () => {
    const entries = [
      shift({
        date: "2026-12-24",
        startTime: "22:00",
        endTime: "06:00",
        type: "NIGHT",
        breakMinutes: 0,
      }),
    ];
    const calculationProfile = createWorkingTimeCalculationProfile(
      profile,
      snapshot,
      [],
      "ready",
      entries,
    );
    expect(calculationProfile.workingTimeTarget?.mode).toBe("FORECAST");
    const result = calculateMonthlyWorkingTimeTarget("2026-12", calculationProfile);
    expect(result).toMatchObject({ targetMinutes: 8778, status: "PROVISIONAL" });
    expect(result.adjustments.every((line) => line.status === "PROFILE_ESTIMATE")).toBe(true);
    expect(result.adjustments.map((line) => line.ruleId)).toEqual([
      "tvoed-k-2026-at-6-3-forecast",
      "tvoed-k-2026-btk-49-2-forecast",
      "tvoed-k-2026-btk-49-2-forecast",
      "tvoed-k-2026-at-6-3-forecast",
    ]);
  });
  it("uses the contractual forecast for the independently documented 177:06 - four times 7:42 = 146:18 reference", () => {
    const before = JSON.stringify(profile);
    const calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, [history()]);
    const result = calculateMonthlyWorkingTimeTarget("2026-12", calculationProfile);
    expect(result.targetMinutes).toBe(8778);
    expect(result.status).toBe("PROVISIONAL");
    expect(result.adjustments).toHaveLength(4);
    expect(JSON.stringify(profile)).toBe(before);
    expect("workingTimeTarget" in profile).toBe(false);
  });
  it("agrees across monthly analysis, daily calendar accounting, annual report, PDF and CSV", () => {
    const entries = [24, 25, 26, 31].map((day) =>
      shift({
        id: String(day),
        date: `2026-12-${day}`,
        startTime: "08:00",
        endTime: "16:00",
        type: "DAY",
      }),
    );
    const calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, []);
    const monthly = calculateMonthlyAnalysis(
      "2026-12",
      entries,
      calculationProfile,
      [],
      pattern,
      bundledRuleResolver,
    );
    expect(monthly.summary.ok && monthly.summary.value.targetMinutes).toBe(8778);
    expect(
      buildMonthlyHoursSeries("2026-12", entries, calculationProfile).reduce(
        (sum, day) => sum + day.targetMinutes,
        0,
      ),
    ).toBe(8778);
    expect(annual(calculationProfile, undefined, entries).months[11]).toMatchObject({
      targetMinutes: 8778,
      targetStatus: "PROVISIONAL",
    });
    const exported = report(calculationProfile, entries);
    expect(
      exported.rows.find((row) => row.section === "Arbeitszeit" && row.field === "targetMinutes")
        ?.value,
    ).toBe("8778");
    expect(exported.workingTimeTargets?.[0].targetMinutes).toBe(8778);
    expect(reportToHtml(exported)).toContain("146:18 h");
    expect(reportToCsv(exported)).toContain('"146:18"');
    expect(exported.rows.some((row) => row.field.startsWith("workingTimeTarget."))).toBe(false);
  });
  it("uses profile flags for provisional planning without saving a personal seven-day confirmation", () => {
    const calculationProfile = createWorkingTimeCalculationProfile(profile, null, [history()]);
    expect(calculationProfile.workingTimeTarget?.context?.periods.at(-1)?.model).toMatchObject({
      kind: "ROTATING_FIVE_IN_SEVEN",
      sevenDayShiftPlanConfirmed: null,
    });
    const result = calculateMonthlyWorkingTimeTarget("2026-12", calculationProfile);
    expect(result.status).toBe("PROVISIONAL");
    expect(result.targetMinutes).toBe(8778); // 23 * 462 - four reference days, projected rather than confirmed.
    expect(result.adjustments.every((line) => line.status === "PROFILE_ESTIMATE")).toBe(true);
    expect(reportToHtml(report(calculationProfile))).toContain("Sollzeit vorläufig");
    expect(reportToCsv(report(calculationProfile))).toContain("Planwert aus Arbeitsprofil");
  });
  it("splits dated weekly hours and invalidates day evidence affected by a change", () => {
    const calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, [
      history("2026-12-15", "P5", 1800),
    ]);
    const periods = calculationProfile.workingTimeTarget?.context?.periods;
    expect(
      periods?.map((period) => [period.validFrom, period.validTo, period.weeklyMinutes]),
    ).toEqual([
      ["2026-12-01", "2026-12-14", 2310],
      ["2026-12-15", null, 1800],
    ]);
    const result = calculateMonthlyWorkingTimeTarget("2026-12", calculationProfile);
    expect(result.baseMinutes).toBe(9300); // 10 weekdays * 462 + 13 weekdays * 360
    expect(result.status).toBe("PROVISIONAL");
    expect(result.adjustments.every((line) => line.status === "PROFILE_ESTIMATE")).toBe(true);
    expect(result.targetMinutes).toBe(7860); // Mixed base 9300 - four new reference days of 360 minutes.
    expect(snapshot.context).toEqual(decemberTargetContext);
  });
  it("also uses dated weekly hours for the automatically inferred five-day forecast", () => {
    const calculationProfile = createWorkingTimeCalculationProfile(
      { ...profile, sundayHolidayWorkEligible: false },
      null,
      [history("2026-12-01", "P5", 1200)],
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculationProfile)).toMatchObject({
      targetMinutes: 4800,
      status: "PROVISIONAL",
    });
    expect(calculationProfile.workingTimeTarget?.context?.periods.at(-1)?.model).toMatchObject({
      kind: "FIXED_WEEK",
      weekdayMinutes: [240, 240, 240, 240, 240, 0, 0],
    });
  });
  it("does not change confirmed working-time rules when only a manual salary amount changes", () => {
    const dated = history("2026-12-15");
    for (const monthlyGrossCents of [400000, 500000]) {
      const salary = {
        ...dated,
        data: {
          version: 1 as const,
          weeklyMinutes: 2310,
          selection: { kind: "own-monthly" as const, monthlyGrossCents },
        },
      };
      const calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, [salary]);
      const result = calculateMonthlyWorkingTimeTarget("2026-12", calculationProfile);
      expect(result.targetMinutes).toBe(8778);
      expect(result.status).toBe("PROVISIONAL");
      expect(calculationProfile.workingTimeTarget?.context?.days).toEqual(
        decemberTargetContext.days,
      );
    }
    const fixed = {
      ...decemberTargetContext,
      periods: [
        {
          ...decemberTargetContext.periods[0],
          model: {
            kind: "FIXED_WEEK" as const,
            weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] as const,
          },
          tariff: { kind: "CUSTOM" as const },
        },
      ],
      days: [
        {
          date: "2026-12-25",
          rosterStatus: "FINAL" as const,
          disposition: "RELEASED" as const,
          lostMinutes: 462,
        },
      ],
    };
    const custom = createWorkingTimeCalculationProfile(profile, { ...snapshot, context: fixed }, [
      {
        ...dated,
        data: {
          version: 1,
          weeklyMinutes: 2310,
          selection: { kind: "own-monthly", monthlyGrossCents: 500000 },
        },
      },
    ]);
    expect(calculateMonthlyWorkingTimeTarget("2026-12", custom).targetMinutes).toBe(10164); // 22 * 462, no invented special days.
    expect(calculateMonthlyWorkingTimeTarget("2026-12", custom).status).toBe("PROVISIONAL");
  });
  it("does not apply BT-K deductions after a dated switch to another tariff", () => {
    const next = history("2026-12-15");
    if (next.data.selection.kind !== "tariff") throw new Error("fixture");
    const calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, [
      {
        ...next,
        data: {
          ...next.data,
          selection: { ...next.data.selection, packageId: "tvl-kr-tdl", variant: "GENERAL" },
        },
      },
    ]);
    const result = calculateMonthlyWorkingTimeTarget("2026-12", calculationProfile);
    expect(result.status).toBe("PROVISIONAL");
    expect(result.tariffReductionMinutes).toBe(0);
    expect(result.adjustments.some((line) => line.ruleId.startsWith("tvoed-k"))).toBe(false);
  });
  it("keeps an explicit historical location and gaps instead of overwriting them with today's profile", () => {
    const calculationProfile = createWorkingTimeCalculationProfile(
      { ...profile, federalState: "BY" },
      snapshot,
      [],
    );
    expect(calculationProfile.workingTimeTarget?.context?.periods[0].federalState).toBe("HE");
    expect(
      calculateMonthlyWorkingTimeTarget("2026-11", calculationProfile).targetMinutes,
    ).toBeNull();
    const monthly = calculateMonthlyAnalysis(
      "2026-11",
      [],
      calculationProfile,
      [],
      pattern,
      bundledRuleResolver,
    );
    expect(monthly.summary.ok).toBe(false);
    expect(annual(calculationProfile).targetMinutes).toBeNull();
  });
  it.each(["loading", "error"] as const)(
    "surfaces %s rather than silently using the legacy target",
    (status) => {
      const calculationProfile = createWorkingTimeCalculationProfile(profile, null, [], status);
      expect(() => calculateMonthlySummary("2026-12", [], calculationProfile)).toThrow(
        WorkingTimeTargetError,
      );
      expect(
        calculateMonthlyAnalysis(
          "2026-12",
          [],
          calculationProfile,
          [],
          pattern,
          bundledRuleResolver,
        ).summary.ok,
      ).toBe(false);
    },
  );
  it("turns ambiguous remuneration history into an explicit unavailable calculation", () => {
    const calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, [
      history(),
      history(),
    ]);
    expect(calculationProfile.workingTimeTarget?.status).toBe("error");
    expect(() => calculateMonthlyWorkingTimeTarget("2026-12", calculationProfile)).toThrow(
      WorkingTimeTargetError,
    );
  });
  it("refreshes annual caches when contractual weekly hours change", () => {
    const cache = createAnnualAvailableReportCache();
    expect(annual(undefined, cache).months[11].targetMinutes).toBe(8778);
    const changed = createWorkingTimeCalculationProfile(profile, snapshot, [
      history("2026-12-01", "P5", 1200),
    ]);
    expect(annual(changed, cache).months[11]).toMatchObject({
      targetStatus: "PROVISIONAL",
      targetMinutes: 4560,
    });
  });
  it("changes neither worked minutes nor pay and never creates worked Saturday hours", () => {
    const entries = [
      shift({ date: "2026-12-26", startTime: "08:00", endTime: "16:00", type: "DAY" }),
    ];
    const calculationProfile = createWorkingTimeCalculationProfile(profile, snapshot, []);
    const before = calculateMonthlyAnalysis(
      "2026-12",
      entries,
      profile,
      [],
      pattern,
      bundledRuleResolver,
    );
    const after = calculateMonthlyAnalysis(
      "2026-12",
      entries,
      calculationProfile,
      [],
      pattern,
      bundledRuleResolver,
    );
    expect(after.pay).toEqual(before.pay);
    expect(after.summary.ok && after.summary.value.actualMinutes).toBe(
      before.summary.ok && before.summary.value.actualMinutes,
    );
    expect(calculateMonthlySummary("2026-12", [], calculationProfile).actualMinutes).toBe(0);
  });
});
