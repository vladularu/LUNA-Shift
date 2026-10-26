import { describe, expect, it, vi } from "vitest";
import type { TargetProfilePeriod, WorkingTimeTargetContext } from "@/domain/working-time-target";
import type { UserProfile } from "@/domain/types";
import { employmentDataFromProfile, employmentProfileAt } from "@/domain/employment-history";
import { validateWorkingTimeTargetContext } from "@/domain/saved-working-time-target";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { RuleResolutionError, bundledRuleResolver } from "@/rules/rule-resolver";
import { resolveCalendarSpecialDays } from "@/features/calendar/calendar-special-days";
import { employmentTargetTariff } from "@/features/settings/working-time-target-form-model";
import { buildAnnualAvailableReportSteps } from "@/features/analysis/annual-core-report";
import { buildReportSteps } from "@/features/report-export/report-data";
import { reportToCsv, reportToHtml } from "@/features/report-export/report-formats";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { calculateMonthlySummary, calculateMonthlyTargetMinutes } from "./monthly-summary";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import { calculateMonthlyWorkingTimeTarget } from "./working-time-target";
import { history, shift, work } from "./remuneration-test-fixtures";

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

const profile: UserProfile = {
  ...work,
  tariff: null,
  federalState: "HE",
  weeklyMinutes: 2310,
  tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
  sundayHolidayWorkEligible: true,
};
const period = {
  validFrom: "2026-01-01",
  validTo: null,
  weeklyMinutes: 2310,
  federalState: "HE",
  holidayRegion: "NONE",
  model: {
    kind: "ROTATING_FIVE_IN_SEVEN",
    monthlyReference: "WEEKDAYS_ONE_FIFTH",
    sevenDayShiftPlanConfirmed: true,
  },
  tariff: { kind: "TVH_KR", version: "2026-03-27", scopeConfirmed: true },
} satisfies TargetProfilePeriod;
const facts: WorkingTimeTargetContext["days"] = [24, 25, 26, 31].map((day) => ({
  date: "2026-12-" + day,
  rosterStatus: "FINAL",
  disposition: "ROSTER_FREE",
  lostMinutes: 462,
  mustWorkElsewhere: true,
}));
const confirmed = (
  month: string,
  days: WorkingTimeTargetContext["days"],
  p: TargetProfilePeriod = period,
) => calculateMonthlyWorkingTimeTarget(month, profile, undefined, { periods: [p], days });
const forecast = (
  month: string,
  periods: readonly TargetProfilePeriod[] = [period],
  days: WorkingTimeTargetContext["days"] = [],
) =>
  calculateMonthlyWorkingTimeTarget(month, {
    ...profile,
    workingTimeTarget: {
      status: "ready",
      mode: "FORECAST",
      notices: [],
      context: { periods, days },
    },
  });
function finish<T>(steps: Generator<unknown, T, unknown>): T {
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

describe("TV-H prison nursing: own sources and independent hand controls", () => {
  // Calendar counts and 2310 / 5 = 462; see docs/working-time-target-tvh.md.
  it.each([
    ["2026-04", 10164, 924, 0, 9240],
    ["2026-07", 10626, 0, 0, 10626],
    ["2026-10", 10164, 462, 0, 9702],
    ["2026-11", 9702, 0, 0, 9702],
    ["2026-12", 10626, 924, 924, 8778],
    ["2027-05", 9702, 1848, 0, 7854],
    ["2027-07", 10164, 0, 0, 10164],
    ["2027-12", 10626, 462, 924, 9240],
  ])("keeps %s a conditional reference", (month, base, statutory, special, target) => {
    const result = forecast(month);
    expect(result).toMatchObject({
      baseMinutes: base,
      statutoryReductionMinutes: statutory,
      tariffReductionMinutes: special,
      targetMinutes: target,
      status: "PROVISIONAL",
    });
    expect(result.notices.some((n) => n.code === "CONDITIONAL_ROSTER_FREE_FORECAST")).toBe(
      statutory > 0,
    );
    for (const adjustment of result.adjustments) {
      expect(adjustment.ruleId).toMatch(/^tvh-kr-202[67]-43-/);
      expect(adjustment.sourceUrl).toContain("innen.hessen.de");
      expect(adjustment.legalBasis).toContain("TV-H");
      expect(adjustment.status).toBe("PROFILE_ESTIMATE");
    }
  });
  it("grants 146:18 only with explicit scope, plan-free holidays and special-day losses", () => {
    expect(confirmed("2026-12", facts)).toMatchObject({
      targetMinutes: 8778,
      statutoryReductionMinutes: 924,
      tariffReductionMinutes: 924,
      status: "FINAL",
    });
  });
  it("keeps worked Saturday holidays separate from the fifth reduction", () => {
    const result = confirmed("2026-10", [
      { date: "2026-10-03", rosterStatus: "FINAL", disposition: "WORK_REQUIRED" },
    ]);
    expect(result).toMatchObject({ targetMinutes: 10164, statutoryReductionMinutes: 0 });
    expect(result.notices.find((n) => n.code === "HOLIDAY_TIME_OFF_SEPARATE")?.message).toContain(
      "TV-H",
    );
  });
  it.each([
    [true, 9702, 462],
    [false, 10164, 0],
  ])("checks whether plan-free Saturday entails work elsewhere: %s", (elsewhere, target, loss) => {
    expect(
      confirmed("2026-10", [
        {
          date: "2026-10-03",
          rosterStatus: "FINAL",
          disposition: "ROSTER_FREE",
          mustWorkElsewhere: elsewhere,
        },
      ]),
    ).toMatchObject({ targetMinutes: target, statutoryReductionMinutes: loss });
  });
  it("does not grant an unproven plan-free entitlement", () => {
    const result = confirmed("2026-10", [
      { date: "2026-10-03", rosterStatus: "FINAL", disposition: "ROSTER_FREE" },
    ]);
    expect(result).toMatchObject({ targetMinutes: 10164, status: "PROVISIONAL" });
    expect(result.adjustments[0]).toMatchObject({ minutes: 0, status: "PENDING" });
  });
  it("never treats a Sunday holiday as an additional working-day deduction", () => {
    const result = forecast("2027-12");
    expect(result.adjustments.some((a) => a.date === "2027-12-26")).toBe(false);
    expect(result.targetMinutes).toBe(9240);
  });
  it("keeps work on both special days in the separate compensation path", () => {
    const result = confirmed(
      "2026-12",
      facts.map((d) => ({ ...d, disposition: "WORK_REQUIRED" })),
    );
    expect(result).toMatchObject({ targetMinutes: 10626, tariffReductionMinutes: 0 });
    expect(result.notices.filter((n) => n.code === "COMPENSATORY_LEAVE_SEPARATE")).toHaveLength(2);
    expect(result.notices.filter((n) => n.code === "HOLIDAY_TIME_OFF_SEPARATE")).toHaveLength(2);
  });
  it("uses actual lost special-day minutes without turning worked holidays into losses", () => {
    const result = confirmed(
      "2026-12",
      facts.map((d) => ({
        ...d,
        disposition:
          d.date.endsWith("-25") || d.date.endsWith("-26") ? "WORK_REQUIRED" : "RELEASED",
      })),
    );
    expect(result).toMatchObject({ targetMinutes: 9702, tariffReductionMinutes: 924 });
  });
  it.each([
    [1800, 6840, 0],
    [2400, 9120, 0],
    [2311, 8782, -1],
  ])("uses %i personal minutes, including a non-integral fifth", (minutes, target, rounding) => {
    const result = forecast("2026-12", [{ ...period, weeklyMinutes: minutes }]);
    expect(result.targetMinutes).toBe(target);
    expect(result.roundingMinutes).toBe(rounding);
    expect(result.adjustments.every((a) => Number.isInteger(a.minutes))).toBe(true);
    expect(
      result.baseMinutes -
        result.statutoryReductionMinutes -
        result.tariffReductionMinutes +
        result.roundingMinutes,
    ).toBe(target);
  });
  it("uses the fixed Monday-Friday model from the existing no-Sunday answer", () => {
    const p = createWorkingTimeCalculationProfile(
      { ...profile, sundayHolidayWorkEligible: false },
      null,
      [],
    );
    const result = calculateMonthlyWorkingTimeTarget("2026-12", p);
    expect(result.targetMinutes).toBe(9240);
    expect(result.adjustments.some((a) => a.date === "2026-12-26")).toBe(false);
    expect(result.notices.some((n) => n.code === "CONDITIONAL_ROSTER_FREE_FORECAST")).toBe(false);
  });
  it("does not derive a seven-day model from an unknown answer", () => {
    const p = createWorkingTimeCalculationProfile(
      { ...profile, sundayHolidayWorkEligible: null },
      null,
      [],
    );
    expect(p.workingTimeTarget?.context?.periods[0].model.kind).toBe("UNKNOWN");
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(10164);
  });
  it.each([false, null])("requires explicit scope in the confirmed calculation: %s", (scope) => {
    const result = confirmed("2026-12", facts, {
      ...period,
      tariff: { ...period.tariff, scopeConfirmed: scope },
    });
    expect(result.tariffReductionMinutes).toBe(0);
    expect(result.adjustments.every((a) => a.status !== "CONFIRMED")).toBe(true);
  });
  it("does not project an explicitly excluded scope", () => {
    expect(
      forecast("2026-12", [{ ...period, tariff: { ...period.tariff, scopeConfirmed: false } }]),
    ).toMatchObject({ targetMinutes: 10626, tariffReductionMinutes: 0 });
  });
  it("retains legacy references before coverage, without claims or profile writes", () => {
    const p = createWorkingTimeCalculationProfile(profile, null, []);
    expect(calculateMonthlyWorkingTimeTarget("2025-12", p)).toMatchObject({
      targetMinutes: 9702,
      tariffReductionMinutes: 0,
      status: "PROVISIONAL",
    });
  });
  it.each(["2028-12", "2026-12"])("rejects unreviewed dates or versions for %s", (month) => {
    const p =
      month === "2026-12"
        ? { ...period, tariff: { ...period.tariff, version: "unknown" } }
        : period;
    const result = forecast(month, [p]);
    expect(result.tariffReductionMinutes).toBe(0);
    expect(result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
    expect(result.adjustments.every((a) => a.status !== "CONFIRMED")).toBe(true);
  });
  it("keeps a dated TVöD-K to TV-H switch and their different holiday-work consequences", () => {
    const result = calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, {
      periods: [
        {
          ...period,
          validTo: "2026-12-25",
          tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true },
        },
        { ...period, validFrom: "2026-12-26" },
      ],
      days: facts.map((d) => ({
        ...d,
        disposition: ["2026-12-25", "2026-12-26"].includes(d.date) ? "WORK_REQUIRED" : "RELEASED",
      })),
    });
    expect(result.targetMinutes).toBe(9240);
    expect(result.adjustments.find((a) => a.date === "2026-12-25")?.ruleId).toContain("tvoed-k");
    expect(result.adjustments.some((a) => a.date === "2026-12-26")).toBe(false);
    expect(result.adjustments.find((a) => a.date === "2026-12-31")?.ruleId).toContain("tvh-kr");
  });
  it("resolves holidays using the dated work state", () => {
    expect(
      forecast("2026-10", [
        { ...period, validTo: "2026-10-15" },
        { ...period, validFrom: "2026-10-16", federalState: "HB" },
      ]),
    ).toMatchObject({ targetMinutes: 9240, statutoryReductionMinutes: 924 });
  });
  it("validates exact JSON and prevents duplicate facts and deductions", () => {
    const context = { periods: [period], days: facts };
    expect(validateWorkingTimeTargetContext(context)).toEqual(context);
    expect(() =>
      validateWorkingTimeTargetContext({ ...context, days: [...facts, facts[0]] }),
    ).toThrow();
    expect(() =>
      validateWorkingTimeTargetContext({
        ...context,
        periods: [{ ...period, tariff: { ...period.tariff, fabricated: true } }],
      }),
    ).toThrow();
    const result = confirmed("2026-12", facts);
    expect(new Set(result.adjustments.map((a) => a.date)).size).toBe(4);
  });
  it("reuses existing KR and Sunday data without confirming scope or changing stored values", () => {
    const before = JSON.stringify(profile);
    const p = createWorkingTimeCalculationProfile(profile, null, []);
    expect(employmentTargetTariff(profile)).toEqual({
      kind: "TVH_KR",
      version: "2026-03-27",
      scopeConfirmed: null,
    });
    expect(p.workingTimeTarget?.context?.periods[0]).toMatchObject({
      tariff: { kind: "TVH_KR", version: "2026-03-27", scopeConfirmed: null },
      model: { kind: "ROTATING_FIVE_IN_SEVEN", sevenDayShiftPlanConfirmed: null },
    });
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
    expect(JSON.stringify(profile)).toBe(before);
  });
  it("ignores entered duties and old day confirmations in the contractual forecast", () => {
    const days = facts.map((d) => ({ ...d, disposition: "WORK_REQUIRED" as const }));
    expect(forecast("2026-12", [period], days).adjustments).toEqual(
      forecast("2026-12").adjustments,
    );
    const snapshot = {
      context: { periods: [period], days },
      saved: null,
      staleDates: [],
      planRevision: "plan",
    };
    const before = JSON.stringify(snapshot);
    const entries = [24, 25, 26, 31].map((d) => shift({ id: String(d), date: "2026-12-" + d }));
    const p = createWorkingTimeCalculationProfile(profile, snapshot, [], "ready", entries);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
    expect(calculateMonthlySummary("2026-12", entries, p).actualMinutes).toBe(
      calculateMonthlySummary("2026-12", entries, profile).actualMinutes,
    );
    expect(calculateMonthlyPayEstimate("2026-12", entries, p, null)).toEqual(
      calculateMonthlyPayEstimate("2026-12", entries, profile, null),
    );
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("uses dated employment for part-time and step changes while preserving earlier employment", () => {
    const next = {
      ...profile,
      weeklyMinutes: 1800,
      tvhKrTariff: { ...profile.tvhKrTariff!, payLevel: 5 as const },
    };
    const timeline = [
      { ...history(), effectiveFrom: null, employment: employmentDataFromProfile(profile) },
      { ...history("2026-12-16", "P5", 1800), employment: employmentDataFromProfile(next) },
    ];
    const before = JSON.stringify(timeline);
    const p = createWorkingTimeCalculationProfile(next, null, timeline);
    expect(
      employmentProfileAt({ ...next, employmentTimeline: timeline }, "2026-12-01").tvhKrTariff
        ?.payLevel,
    ).toBe(4);
    expect(p.workingTimeTarget?.context?.periods.map((p) => p.tariff.kind)).toEqual([
      "TVH_KR",
      "TVH_KR",
    ]);
    // Eleven early weekdays * 462 + (twelve late weekdays - four holidays/specials) * 360.
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(7962);
    expect(JSON.stringify(timeline)).toBe(before);
  });
  it("keeps ambiguous historical TV_H markers and salary conflicts unverified", () => {
    const snapshot = {
      saved: null,
      staleDates: [],
      planRevision: "plan",
      context: {
        periods: [{ ...period, tariff: { kind: "UNVERIFIED" as const, id: "TV_H" } }],
        days: [],
      },
    };
    expect(
      createWorkingTimeCalculationProfile(profile, snapshot, []).workingTimeTarget?.context
        ?.periods[0].tariff,
    ).toEqual({ kind: "UNVERIFIED", id: "TV_H" });
    for (const p of [
      { ...profile, tariff: work.tariff },
      {
        ...profile,
        tvlKrTariff: {
          payGroup: "KR8" as const,
          payLevel: 4 as const,
          universityRegion: "WEST" as const,
        },
      },
      { ...profile, salaryBasisConflict: { tvhKrTariff: profile.tvhKrTariff } },
    ]) {
      expect(
        createWorkingTimeCalculationProfile(p, null, []).workingTimeTarget?.context?.periods[0]
          .tariff.kind,
      ).toBe("UNVERIFIED");
      expect(employmentTargetTariff(p).kind).toBe("UNVERIFIED");
    }
  });
  it("shares one result with annual reports, calendar, CSV and both PDF layouts", () => {
    const p = createWorkingTimeCalculationProfile(profile, null, []);
    const pattern = {
      assignment: "UNKNOWN" as const,
      workplaceCoverage: "UNKNOWN" as const,
      updatedAt: null,
    };
    const annual = finish(
      buildAnnualAvailableReportSteps(2026, [], p, [], pattern, "2026-12-31", bundledRuleResolver),
    );
    expect(annual.months[11]).toMatchObject({ targetMinutes: 8778, targetStatus: "PROVISIONAL" });
    for (const month of ["2026-12", "2026"]) {
      const report = finish(
        buildReportSteps({
          period: month,
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
      expect(report.workingTimeTargets?.find((t) => t.month === "2026-12")?.targetMinutes).toBe(
        8778,
      );
      expect(reportToCsv(report)).toContain('"146:18"');
      for (const layout of ["standard", "compact"] as const) {
        const html = reportToHtml(report, { layout, includeSalary: true });
        expect(html).toContain("146:18 h");
        expect(html.match(/TV-H \(Justizvollzug\): Planwert/g)).toHaveLength(1);
      }
    }
    const calendar = resolveCalendarSpecialDays("2026-12", p, bundledRuleResolver);
    expect([...calendar.days.keys()]).toEqual(["2026-12-24", "2026-12-31"]);
    expect([...calendar.days.values()].every((d) => d.ruleId.startsWith("tvh-kr-"))).toBe(true);
  });
});
