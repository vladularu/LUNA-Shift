import { describe, expect, it, vi } from "vitest";
import type { TargetProfilePeriod, WorkingTimeTargetContext } from "@/domain/working-time-target";
import type { UserProfile } from "@/domain/types";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import { validateWorkingTimeTargetContext } from "@/domain/saved-working-time-target";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import {
  bundledRuleResolver,
  RuleResolutionError,
  createRuleResolver,
  type RuleResolver,
} from "@/rules/rule-resolver";
import holidayRegions from "../../rules/packages/reviewed/de-holidays/2026.json";
import type { RuleHolidayPackage } from "@/rules/contracts.generated";
import { resolveCalendarSpecialDays } from "@/features/calendar/calendar-special-days";
import { employmentTargetTariff } from "@/features/settings/working-time-target-form-model";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { calculateMonthlySummary, calculateMonthlyTargetMinutes } from "./monthly-summary";
import { work, shift } from "./remuneration-test-fixtures";
import { tvlProfile } from "./tvl-shift-work-test-fixtures";
import { buildAnnualAvailableReportSteps } from "@/features/analysis/annual-core-report";
import { buildReportSteps } from "@/features/report-export/report-data";
import { reportToCsv, reportToHtml } from "@/features/report-export/report-formats";
import { calculateMonthlyWorkingTimeTarget } from "./working-time-target";

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

const profile: UserProfile = {
  ...work,
  federalState: "HE",
  weeklyMinutes: 2310,
  tariff: null,
  tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
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
  tariff: { kind: "TVL_KR", version: "2026-02-14", scopeConfirmed: true },
} satisfies TargetProfilePeriod;

const facts: WorkingTimeTargetContext["days"] = [24, 25, 26, 31].map((day) => ({
  date: "2026-12-" + day,
  rosterStatus: "FINAL",
  disposition: "ROSTER_FREE",
  lostMinutes: 462,
  mustWorkElsewhere: true,
}));
const snapshot = (
  periods: readonly TargetProfilePeriod[],
  days: WorkingTimeTargetContext["days"] = [],
): WorkingTimeTargetSnapshot => ({
  saved: null,
  context: { periods, days },
  staleDates: [],
  planRevision: "plan",
});
const forecast = (
  month: string,
  periods: readonly TargetProfilePeriod[] = [period],
  days: WorkingTimeTargetContext["days"] = [],
  ruleResolver: RuleResolver = bundledRuleResolver,
) =>
  calculateMonthlyWorkingTimeTarget(
    month,
    {
      ...profile,
      workingTimeTarget: {
        status: "ready",
        mode: "FORECAST",
        notices: [],
        context: { periods, days },
      },
    },
    ruleResolver,
  );

describe("TV-L § 43 independent controls", () => {
  it.each([
    ["2026-07", 10626, 0, 0, 10626],
    ["2026-10", 10164, 462, 0, 9702],
    ["2026-12", 10626, 924, 924, 8778],
    ["2027-05", 9702, 1848, 0, 7854],
    ["2027-07", 10164, 0, 0, 10164],
    ["2027-12", 10626, 462, 924, 9240],
  ])(
    "keeps %s as an explicitly conditional planning reference",
    (month, base, statutory, special, target) => {
      const result = forecast(month);
      expect(result).toMatchObject({
        baseMinutes: base,
        statutoryReductionMinutes: statutory,
        tariffReductionMinutes: special,
        targetMinutes: target,
        status: "PROVISIONAL",
      });
      if (statutory === 0)
        expect(result.notices.some((n) => n.code === "CONDITIONAL_ROSTER_FREE_FORECAST")).toBe(
          false,
        );
      for (const adjustment of result.adjustments) {
        expect(adjustment.ruleId).toMatch(/^tvl-kr-202[67]-43-/);
        expect(adjustment.status).toBe("PROFILE_ESTIMATE");
        expect(adjustment.sourceUrl).toContain("tdl-online.de");
        if (adjustment.kind === "STATUTORY_HOLIDAY") {
          expect(adjustment.condition).toContain("dienstplanmäßig freie");
          expect(adjustment.condition).toContain("Kein bestätigter Tagesanspruch");
        }
      }
    },
  );
  it("keeps worked Saturday holidays outside the automatic fifth reduction", () => {
    const result = calculateMonthlyWorkingTimeTarget("2026-10", profile, undefined, {
      periods: [period],
      days: [{ date: "2026-10-03", rosterStatus: "FINAL", disposition: "WORK_REQUIRED" }],
    });
    expect(result).toMatchObject({
      targetMinutes: 10164,
      statutoryReductionMinutes: 0,
      status: "FINAL",
    });
    expect(result.notices.some((n) => n.code === "HOLIDAY_TIME_OFF_SEPARATE")).toBe(true);
  });
  it("reduces a qualified roster-free Saturday by a contractual fifth", () => {
    const result = calculateMonthlyWorkingTimeTarget("2026-10", profile, undefined, {
      periods: [period],
      days: [
        {
          date: "2026-10-03",
          rosterStatus: "FINAL",
          disposition: "ROSTER_FREE",
          mustWorkElsewhere: true,
        },
      ],
    });
    expect(result).toMatchObject({
      targetMinutes: 9702,
      statutoryReductionMinutes: 462,
      status: "FINAL",
    });
    expect(result.adjustments[0]).toMatchObject({
      ruleId: "tvl-kr-2026-43-6-3-8",
      status: "CONFIRMED",
    });
  });
  it.each([
    ["all qualified roster-free", facts, 8778, 0],
    [
      "both statutory holidays worked",
      facts.map((d) =>
        ["2026-12-25", "2026-12-26"].includes(d.date)
          ? { ...d, disposition: "WORK_REQUIRED" as const }
          : d,
      ),
      9702,
      2,
    ],
    [
      "all four days worked",
      facts.map((d) => ({ ...d, disposition: "WORK_REQUIRED" as const })),
      10626,
      4,
    ],
  ])("calculates confirmed December: %s", (_name, days, target, notices) => {
    const result = calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, {
      periods: [period],
      days,
    });
    expect(result).toMatchObject({ targetMinutes: target, status: "FINAL" });
    expect(
      result.notices.filter((n) =>
        ["HOLIDAY_TIME_OFF_SEPARATE", "COMPENSATORY_LEAVE_SEPARATE"].includes(n.code),
      ),
    ).toHaveLength(notices);
    expect(result.adjustments.every((a) => a.status === "CONFIRMED")).toBe(true);
  });
  it("does not infer a claim from missing, draft or released-only holiday facts", () => {
    for (const day of [
      undefined,
      {
        date: "2026-10-03",
        rosterStatus: "DRAFT" as const,
        disposition: "ROSTER_FREE" as const,
        mustWorkElsewhere: true,
      },
      {
        date: "2026-10-03",
        rosterStatus: "FINAL" as const,
        disposition: "RELEASED" as const,
        lostMinutes: 462,
      },
    ]) {
      const result = calculateMonthlyWorkingTimeTarget("2026-10", profile, undefined, {
        periods: [period],
        days: day ? [day] : [],
      });
      expect(result).toMatchObject({ targetMinutes: 10164, status: "PROVISIONAL" });
      expect(result.adjustments[0]).toMatchObject({ minutes: 0, status: "PENDING" });
    }
  });
  it("does not grant a fifth without the elsewhere-work condition", () => {
    const result = calculateMonthlyWorkingTimeTarget("2026-10", profile, undefined, {
      periods: [period],
      days: [
        {
          date: "2026-10-03",
          rosterStatus: "FINAL",
          disposition: "ROSTER_FREE",
          mustWorkElsewhere: false,
        },
      ],
    });
    expect(result).toMatchObject({ targetMinutes: 10164, status: "FINAL" });
    expect(result.adjustments).toEqual([]);
  });
  it("does not deduct a Sunday holiday", () => {
    expect(forecast("2026-11", [{ ...period, federalState: "NW" }])).toMatchObject({
      targetMinutes: 9702,
      statutoryReductionMinutes: 0,
    });
  });
  it("uses regional holidays independently of the salary region", () => {
    const ruleResolver = createRuleResolver(
      { tariff: [], legal: [], holiday: [holidayRegions as RuleHolidayPackage] },
      { tariff: "unused", legal: "unused", holiday: "de-holidays" },
    );
    // August 2026 has 21 weekdays; Saturday 15 August exists only in the selected region.
    const regular = forecast(
      "2026-08",
      [{ ...period, federalState: "BY", holidayRegion: "NONE" }],
      [],
      ruleResolver,
    );
    const regional = forecast(
      "2026-08",
      [{ ...period, federalState: "BY", holidayRegion: "BY_MARIA_HIMMELFAHRT" }],
      [],
      ruleResolver,
    );
    expect(regular.targetMinutes).toBe(9702);
    expect(regional.targetMinutes).toBe(9240);
    expect(regional.adjustments.map((a) => a.date)).toEqual(["2026-08-15"]);
    const missingCatalog = forecast("2026-08", [
      { ...period, federalState: "BY", holidayRegion: "BY_MARIA_HIMMELFAHRT" },
    ]);
    expect(missingCatalog.status).toBe("UNAVAILABLE");
    expect(missingCatalog.notices.some((n) => n.code === "HOLIDAY_REGION_UNSUPPORTED")).toBe(true);
  });
  it("keeps fixed weekdays distinct and applies actual special-day losses", () => {
    const fixed: TargetProfilePeriod = {
      ...period,
      model: { kind: "FIXED_WEEK", weekdayMinutes: [600, 480, 360, 600, 270, 0, 0] },
    };
    const days: WorkingTimeTargetContext["days"] = [24, 31].map((day) => ({
      date: "2026-12-" + day,
      rosterStatus: "FINAL",
      disposition: "RELEASED",
      lostMinutes: 600,
    }));
    const result = calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, {
      periods: [fixed],
      days,
    });
    expect(result).toMatchObject({
      targetMinutes: 9210,
      statutoryReductionMinutes: 270,
      tariffReductionMinutes: 1200,
      status: "FINAL",
    });
    expect(result.adjustments.some((a) => a.date === "2026-12-26")).toBe(false);
  });
  it.each([
    ["2026-12", 6840],
    ["2027-12", 7200],
  ])("uses individual part-time minutes in %s", (month, target) => {
    expect(forecast(month, [{ ...period, weeklyMinutes: 1800 }]).targetMinutes).toBe(target);
  });
  it("uses integer minutes and the shared cumulative rounding strategy", () => {
    const result = forecast("2026-12", [{ ...period, weeklyMinutes: 2311 }]);
    expect(result.targetMinutes).toBe(8782); // round(19 × 2311 / 5), independently calculated.
    expect(result.adjustments.every((a) => Number.isInteger(a.minutes))).toBe(true);
  });
  it("limits the forecast to explicit employment dates", () => {
    const p = {
      ...profile,
      workingTimeTarget: {
        status: "ready" as const,
        mode: "FORECAST" as const,
        notices: [],
        context: {
          periods: [period],
          days: [],
          employment: { from: "2026-12-16", to: "2026-12-31" },
        },
      },
    };
    expect(calculateMonthlyWorkingTimeTarget("2026-12", p).targetMinutes).toBe(3696);
  });
  it("preserves dated contractual changes across the year boundary", () => {
    const periods: TargetProfilePeriod[] = [
      { ...period, weeklyMinutes: 2400, validTo: "2026-12-31" },
      { ...period, weeklyMinutes: 2370, validFrom: "2027-01-01" },
    ];
    expect(forecast("2026-12", periods).targetMinutes).toBe(9120);
    expect(forecast("2027-12", periods).targetMinutes).toBe(9480);
  });
  it.each(["future", "2027-01-01"])(
    "does not accept an unreviewed TV-L source version %s",
    (version) => {
      const result = calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, {
        periods: [{ ...period, tariff: { ...period.tariff, version } }],
        days: facts,
      });
      expect(result).toMatchObject({
        targetMinutes: 10626,
        tariffReductionMinutes: 0,
        status: "PROVISIONAL",
      });
      expect(result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
      expect(result.adjustments.every((a) => a.status !== "CONFIRMED")).toBe(true);
    },
  );
  it("does not extend reviewed claims into 2028", () => {
    const result = forecast("2028-12");
    expect(result.tariffReductionMinutes).toBe(0);
    expect(result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
    expect(result.adjustments.every((a) => a.status !== "CONFIRMED")).toBe(true);
  });
  it("respects an explicitly denied scope", () => {
    expect(
      forecast("2026-12", [{ ...period, tariff: { ...period.tariff, scopeConfirmed: false } }]),
    ).toMatchObject({ targetMinutes: 10626, tariffReductionMinutes: 0, status: "PROVISIONAL" });
  });
  it("validates exact JSON fields and rejects duplicate day facts", () => {
    const context = { periods: [period], days: facts };
    expect(validateWorkingTimeTargetContext(context)).toEqual(context);
    expect(() =>
      validateWorkingTimeTargetContext({
        ...context,
        periods: [{ ...period, tariff: { ...period.tariff, extra: true } }],
      }),
    ).toThrow();
    expect(() =>
      validateWorkingTimeTargetContext({ ...context, days: [...facts, facts[0]] }),
    ).toThrow();
  });
  it("uses existing KR and Sunday answers without writing back or asking again", () => {
    expect(employmentTargetTariff(profile)).toEqual({
      kind: "TVL_KR",
      version: "2026-02-14",
      scopeConfirmed: null,
    });
    expect(employmentTargetTariff({ ...profile, tariff: work.tariff }).kind).toBe("UNVERIFIED");
    const before = JSON.stringify(profile);
    const p = createWorkingTimeCalculationProfile(profile, null, []);
    expect(p.workingTimeTarget?.context?.periods[0]).toMatchObject({
      model: { kind: "ROTATING_FIVE_IN_SEVEN", sevenDayShiftPlanConfirmed: null },
      tariff: { kind: "TVL_KR", version: "2026-02-14", scopeConfirmed: null },
    });
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
    expect(JSON.stringify(profile)).toBe(before);
    expect(calculateMonthlySummary("2026-12", [], p).actualMinutes).toBe(0);
  });
  it("uses the no-Sunday answer for a fixed weekday forecast", () => {
    const p = createWorkingTimeCalculationProfile(
      { ...profile, sundayHolidayWorkEligible: false },
      null,
      [],
    );
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(9240);
  });
  it("keeps the hypothetical forecast independent of worked days and existing confirmations", () => {
    const days = facts.map((d) => ({ ...d, disposition: "WORK_REQUIRED" as const }));
    const saved = snapshot([period], days),
      before = JSON.stringify(saved);
    const entries = [24, 25, 26, 31].map((day) =>
      shift({ id: String(day), date: "2026-12-" + day }),
    );
    const p = createWorkingTimeCalculationProfile(profile, saved, [], "ready", entries);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
    expect(calculateMonthlySummary("2026-12", entries, p).actualMinutes).toBe(
      calculateMonthlySummary("2026-12", entries, profile).actualMinutes,
    );
    expect(JSON.stringify(saved)).toBe(before);
    expect(forecast("2026-12", [period], days).adjustments).toEqual(
      forecast("2026-12").adjustments,
    );
  });
  it("recognizes an explicit historical section-43 marker without rewriting it", () => {
    const saved = snapshot([
        { ...period, tariff: { kind: "UNVERIFIED", id: "tvl-kr-tdl/SECTION_43" } },
      ]),
      before = JSON.stringify(saved);
    const p = createWorkingTimeCalculationProfile(profile, saved, []);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
    expect(JSON.stringify(saved)).toBe(before);
  });
  it.each(["TV_L", "CURRENT_SALARY_SELECTION"])(
    "does not reinterpret ambiguous historical marker %s",
    (id) => {
      const saved = snapshot([{ ...period, tariff: { kind: "UNVERIFIED", id } }]);
      const p = createWorkingTimeCalculationProfile(profile, saved, []);
      expect(p.workingTimeTarget?.context?.periods[0].tariff).toEqual({ kind: "UNVERIFIED", id });
      expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(10164);
    },
  );
  it("preserves the pre-review provisional reference", () => {
    for (const saved of [
      null,
      snapshot([
        {
          ...period,
          validFrom: "2025-01-01",
          tariff: { kind: "UNVERIFIED", id: "tvl-kr-tdl/SECTION_43" },
        },
      ]),
    ]) {
      const result = calculateMonthlyWorkingTimeTarget(
        "2025-12",
        createWorkingTimeCalculationProfile(profile, saved, []),
      );
      expect(result).toMatchObject({
        targetMinutes: 9702,
        status: "PROVISIONAL",
        tariffReductionMinutes: 0,
      });
      expect(result.adjustments.every((a) => a.status === "LEGACY_ESTIMATE")).toBe(true);
    }
  });
  it("splits a dated K-to-TV-L change and keeps the earlier family", () => {
    const saved = snapshot([
      { ...period, tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true } },
    ]);
    const dated = { ...tvlProfile(), effectiveFrom: "2026-12-16" };
    const p = createWorkingTimeCalculationProfile(profile, saved, [dated]);
    expect(p.workingTimeTarget?.context?.periods.map((p) => p.tariff.kind)).toEqual([
      "TVOED_K",
      "TVL_KR",
    ]);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
  });
  it("does not activate section 43 for other packages, variants or a salary conflict", () => {
    for (const variant of ["GENERAL", "UNKNOWN"]) {
      const dated = tvlProfile();
      const selection = dated.data.selection;
      if (selection.kind !== "tariff") throw new Error("Expected tariff test fixture");
      const p = createWorkingTimeCalculationProfile(profile, null, [
        {
          ...dated,
          effectiveFrom: "2026-12-01",
          data: { ...dated.data, selection: { ...selection, variant } },
        },
      ]);
      expect(
        p.workingTimeTarget?.context?.periods.find((p) => p.validFrom === "2026-12-01")?.tariff
          .kind,
      ).toBe("UNVERIFIED");
    }
    for (const p of [
      { ...profile, salaryBasisConflict: { tvlKrTariff: profile.tvlKrTariff } },
      { ...profile, tariff: work.tariff },
    ]) {
      expect(
        createWorkingTimeCalculationProfile(p, null, []).workingTimeTarget?.context?.periods[0]
          .tariff.kind,
      ).toBe("UNVERIFIED");
    }
  });
  it("uses one conditional result in monthly, annual, CSV and PDF report data", () => {
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
    const report = finish(
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
    expect(report.workingTimeTargets?.[0].targetMinutes).toBe(
      calculateMonthlyTargetMinutes("2026-12", p),
    );
    expect(reportToCsv(report)).toContain('"146:18"');
    expect(reportToHtml(report)).toContain("146:18 h");
    expect(reportToHtml(report)).toContain("dienstplanmäßig freie");
    for (const layout of ["standard", "compact"] as const) {
      expect(
        reportToHtml(report, { layout, includeSalary: true }).match(/TV-L\/KR \/ § 43: Planwert/g),
      ).toHaveLength(1);
    }
    const yearly = finish(
      buildReportSteps({
        period: "2026",
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
    expect(reportToHtml(yearly).match(/TV-L\/KR \/ § 43: Planwert/g)).toHaveLength(1);
    const calendar = resolveCalendarSpecialDays("2026-12", p, bundledRuleResolver);
    expect([...calendar.days.keys()]).toEqual(["2026-12-24", "2026-12-31"]);
    expect(
      [...calendar.days.values()].every(
        (d) => d.ruleId.startsWith("tvl-kr-") && d.kind === "TARIFF_SPECIAL_DAY",
      ),
    ).toBe(true);
  });
});
