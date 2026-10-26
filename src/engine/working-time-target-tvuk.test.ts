import { describe, expect, it, vi } from "vitest";
import type {
  TargetDayFact,
  TargetProfilePeriod,
  WorkingTimeTargetContext,
} from "@/domain/working-time-target";
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
import { calculateTvUkNursingProfileMonth } from "./simple-tvuk-nursing-profile-pay";
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
  federalState: "BW",
  weeklyMinutes: 2310,
  sundayHolidayWorkEligible: true,
  tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
};
const period = {
  validFrom: "2026-01-01",
  validTo: null,
  weeklyMinutes: 2310,
  federalState: "BW",
  holidayRegion: "NONE",
  model: {
    kind: "ROTATING_FIVE_IN_SEVEN",
    monthlyReference: "WEEKDAYS_ONE_FIFTH",
    sevenDayShiftPlanConfirmed: true,
  },
  tariff: {
    kind: "TVUK_NURSING",
    version: "2025-01-01",
    scopeConfirmed: true,
    accountRuleConfirmed: null,
  },
} satisfies TargetProfilePeriod;
const fixed = { kind: "FIXED_WEEK", weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] } as const;
const confirmed = (
  month: string,
  days: readonly TargetDayFact[] = [],
  p: TargetProfilePeriod = period,
) => calculateMonthlyWorkingTimeTarget(month, profile, undefined, { periods: [p], days });
const forecast = (
  month: string,
  periods: readonly TargetProfilePeriod[] = [period],
  days: readonly TargetDayFact[] = [],
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
  let value = steps.next();
  while (!value.done) value = steps.next();
  return value.value;
}

describe("TV-UK own account rule: independent calendar and § 13 controls", () => {
  // Hand counts and personal weekly minutes / 5, documented independently of the engine.
  it.each([
    ["2026-01", 10164, 924, 0, 9240],
    ["2026-04", 10164, 924, 0, 9240],
    ["2026-07", 10626, 0, 0, 10626],
    ["2026-10", 10164, 0, 0, 10164],
    ["2026-11", 9702, 0, 0, 9702],
    ["2026-12", 10626, 462, 924, 9240],
    ["2027-05", 9702, 1386, 0, 8316],
    ["2027-07", 10164, 0, 0, 10164],
    ["2027-12", 10626, 0, 924, 9702],
  ])("calculates account reference %s", (month, base, statutory, special, target) => {
    for (const result of [confirmed(month), forecast(month)]) {
      expect(result).toMatchObject({
        baseMinutes: base,
        statutoryReductionMinutes: statutory,
        tariffReductionMinutes: special,
        targetMinutes: target,
      });
      for (const a of result.adjustments) {
        expect(a.ruleId).toMatch(/^tvuk-202[67]-13-4-b/);
        expect(a.legalBasis).toContain("TV-UK");
        expect(a.sourceUrl).toContain("agu-uniklinika.de");
      }
    }
    expect(confirmed(month).status).toBe("FINAL");
    expect(forecast(month).status).toBe("PROVISIONAL");
  });
  it.each(["WORK_REQUIRED", "ROSTER_FREE", "RELEASED", "UNKNOWN"] as const)(
    "keeps § 13 deductions independent of %s, lost hours and draft status",
    (disposition) => {
      const days = [24, 25, 26, 31].map((day): TargetDayFact => ({
        date: "2026-12-" + day,
        rosterStatus: "DRAFT",
        disposition,
        lostMinutes: 900,
        mustWorkElsewhere: false,
      }));
      expect(confirmed("2026-12", days).adjustments).toEqual(confirmed("2026-12").adjustments);
      expect(forecast("2026-12", [period], days).adjustments).toEqual(
        forecast("2026-12").adjustments,
      );
    },
  );
  it.each(["WORK_REQUIRED", "ROSTER_FREE"] as const)(
    "never grants an account fifth for Saturday %s",
    (disposition) => {
      expect(
        confirmed("2026-10", [
          {
            date: "2026-10-03",
            rosterStatus: "FINAL",
            disposition,
            lostMinutes: 480,
            mustWorkElsewhere: true,
          },
        ]),
      ).toMatchObject({ targetMinutes: 10164, adjustments: [] });
    },
  );
  it("uses an explicit account even with a regularly free Friday and irregular fixed distribution", () => {
    const p: TargetProfilePeriod = {
      ...period,
      model: { kind: "FIXED_WEEK", weekdayMinutes: [600, 600, 600, 510, 0, 0, 0] },
      tariff: { ...period.tariff, accountRuleConfirmed: true },
    };
    // 4*600 + 5*600 + 5*600 + 5*510 = 10950, three account fifths = 1386.
    expect(confirmed("2026-12", [], p)).toMatchObject({
      baseMinutes: 10950,
      targetMinutes: 9564,
      statutoryReductionMinutes: 462,
      tariffReductionMinutes: 924,
      status: "FINAL",
    });
  });
  it.each([
    [1800, 7200],
    [2400, 9600],
    [2311, 9244],
  ])("uses personal %i weekly minutes", (weeklyMinutes, target) => {
    const result = forecast("2026-12", [{ ...period, weeklyMinutes }]);
    expect(result.targetMinutes).toBe(target);
    expect(
      result.baseMinutes -
        result.statutoryReductionMinutes -
        result.tariffReductionMinutes +
        result.roundingMinutes,
    ).toBe(target);
    expect(result.days.reduce((n, d) => n + d.targetMinutes!, 0)).toBe(target);
  });
  it("distinguishes § 8 fixed loss from a flat fifth without extra profile questions", () => {
    const p = {
      ...period,
      model: fixed,
      tariff: { ...period.tariff, accountRuleConfirmed: false },
    };
    const days: TargetDayFact[] = [24, 25, 31].map((day) => ({
      date: "2026-12-" + day,
      rosterStatus: "FINAL",
      disposition: "RELEASED",
      lostMinutes: 462,
    }));
    const result = confirmed("2026-12", days, p);
    expect(result).toMatchObject({ targetMinutes: 9240, status: "FINAL" });
    expect(result.adjustments.every((a) => a.ruleId.endsWith("-8-3"))).toBe(true);
    expect(
      confirmed(
        "2026-12",
        days.map((d) => ({ ...d, disposition: "WORK_REQUIRED" })),
        p,
      ).targetMinutes,
    ).toBe(10626);
    expect(
      confirmed(
        "2026-12",
        days.map((d) => ({ ...d, disposition: "ROSTER_FREE" })),
        p,
      ).adjustments.every((a) => a.status === "PENDING"),
    ).toBe(true);
  });
  it("keeps unproved general losses pending and rejects excessive fixed loss", () => {
    const p = {
      ...period,
      model: fixed,
      tariff: { ...period.tariff, accountRuleConfirmed: false },
    };
    expect(confirmed("2026-12", [], p)).toMatchObject({
      targetMinutes: 10626,
      status: "PROVISIONAL",
    });
    expect(() =>
      confirmed(
        "2026-12",
        [{ date: "2026-12-24", rosterStatus: "FINAL", disposition: "RELEASED", lostMinutes: 600 }],
        p,
      ),
    ).toThrow();
  });
  it.each([false, null])("does not confirm personal scope %s", (scopeConfirmed) => {
    const result = confirmed("2026-12", [], {
      ...period,
      tariff: { ...period.tariff, scopeConfirmed },
    });
    expect(result).toMatchObject({
      targetMinutes: 10626,
      tariffReductionMinutes: 0,
      status: "PROVISIONAL",
    });
  });
  it("does not confirm unknown account coverage from a fixed week", () => {
    expect(confirmed("2026-12", [], { ...period, model: fixed })).toMatchObject({
      targetMinutes: 10626,
      status: "PROVISIONAL",
    });
  });
  it("does not project an explicitly excluded personal scope", () => {
    expect(
      forecast("2026-12", [{ ...period, tariff: { ...period.tariff, scopeConfirmed: false } }])
        .targetMinutes,
    ).toBe(10626);
  });
  it.each(["2028-12", "2026-12"])(
    "retains pending provenance outside reviewed date/version: %s",
    (month) => {
      const p =
        month === "2026-12"
          ? { ...period, tariff: { ...period.tariff, version: "unknown" } }
          : period;
      const result = forecast(month, [p]);
      expect(result.tariffReductionMinutes).toBe(0);
      expect(result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
    },
  );
  it("reuses existing PUK, personal hours and Sunday answer without writing scope or account evidence", () => {
    const before = JSON.stringify(profile);
    const p = createWorkingTimeCalculationProfile(profile, null, []);
    expect(employmentTargetTariff(profile)).toEqual({
      kind: "TVUK_NURSING",
      version: "2025-01-01",
      scopeConfirmed: null,
      accountRuleConfirmed: null,
    });
    expect(p.workingTimeTarget?.context?.periods[0]).toMatchObject({
      tariff: employmentTargetTariff(profile),
      model: { kind: "ROTATING_FIVE_IN_SEVEN", sevenDayShiftPlanConfirmed: null },
    });
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(9240);
    expect(calculateMonthlyTargetMinutes("2025-12", p)).toBe(9702);
    expect(JSON.stringify(profile)).toBe(before);
  });
  it.each([false, null])(
    "handles a fixed or unknown Sunday answer %s",
    (sundayHolidayWorkEligible) => {
      const p = createWorkingTimeCalculationProfile(
        { ...profile, sundayHolidayWorkEligible },
        null,
        [],
      );
      const result = calculateMonthlyWorkingTimeTarget("2026-12", p);
      expect(result.targetMinutes).toBe(sundayHolidayWorkEligible === false ? 9240 : 10164);
      expect(result.status).toBe("PROVISIONAL");
    },
  );
  it("keeps dated part-time/step changes and the earlier PUK level", () => {
    const next: UserProfile = {
      ...profile,
      weeklyMinutes: 1800,
      tvUkNursingTariff: { payGroup: "PUK8", payLevel: 5 },
    };
    const timeline = [
      { ...history(), effectiveFrom: null, employment: employmentDataFromProfile(profile) },
      { ...history("2026-12-16", "P5", 1800), employment: employmentDataFromProfile(next) },
    ];
    const before = JSON.stringify(timeline);
    const p = createWorkingTimeCalculationProfile(next, null, timeline);
    // 11 early weekdays * 462 + (12 late weekdays - 3 weekday events) * 360.
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8322);
    expect(
      employmentProfileAt({ ...next, employmentTimeline: timeline }, "2026-12-01").tvUkNursingTariff
        ?.payLevel,
    ).toBe(4);
    expect(
      p.workingTimeTarget?.context?.periods.every((p) => p.tariff.kind === "TVUK_NURSING"),
    ).toBe(true);
    expect(JSON.stringify(timeline)).toBe(before);
  });
  it("handles tariff and regional switches per date without double deductions", () => {
    const result = forecast("2026-12", [
      { ...period, validTo: "2026-12-25" },
      {
        ...period,
        validFrom: "2026-12-26",
        tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true },
      },
    ]);
    expect(result.targetMinutes).toBe(8778);
    expect(result.adjustments.find((a) => a.date === "2026-12-25")?.ruleId).toContain("tvuk-");
    expect(result.adjustments.find((a) => a.date === "2026-12-26")?.ruleId).toContain("tvoed-k");
    expect(new Set(result.adjustments.map((a) => a.date)).size).toBe(4);
    expect(forecast("2026-01", [{ ...period, federalState: "HE" }])).toMatchObject({
      targetMinutes: 9702,
      statutoryReductionMinutes: 462,
    });
    expect(forecast("2026-01").targetMinutes).toBe(9240);
    const bound: WorkingTimeTargetContext = {
      periods: [period],
      days: [],
      employment: { from: "2026-12-16", to: "2026-12-31" },
    };
    expect(
      calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, bound).targetMinutes,
    ).toBe(4158);
  });
  it("rejects duplicate, forged or contradictory account evidence", () => {
    const context = { periods: [period], days: [] };
    expect(validateWorkingTimeTargetContext(context)).toEqual(context);
    for (const tariff of [
      { ...period.tariff, accountRuleConfirmed: undefined },
      { ...period.tariff, accountRuleConfirmed: "yes" },
      { ...period.tariff, accountRuleConfirmed: false },
      { ...period.tariff, fabricated: true },
    ])
      expect(() =>
        validateWorkingTimeTargetContext({ ...context, periods: [{ ...period, tariff }] }),
      ).toThrow();
    const fact: TargetDayFact = {
      date: "2026-12-24",
      rosterStatus: "FINAL",
      disposition: "WORK_REQUIRED",
    };
    expect(() => validateWorkingTimeTargetContext({ ...context, days: [fact, fact] })).toThrow();
  });
  it("retains ambiguous historical markers and salary conflicts as unverified", () => {
    const snapshot = {
      context: {
        periods: [{ ...period, tariff: { kind: "UNVERIFIED" as const, id: "TV_UK" } }],
        days: [],
      },
      saved: null,
      staleDates: [],
      planRevision: "plan",
    };
    expect(
      createWorkingTimeCalculationProfile(profile, snapshot, []).workingTimeTarget?.context
        ?.periods[0].tariff.kind,
    ).toBe("UNVERIFIED");
    for (const p of [
      { ...profile, tariff: work.tariff },
      { ...profile, salaryBasisConflict: { tvUkNursingTariff: profile.tvUkNursingTariff } },
    ]) {
      expect(employmentTargetTariff(p).kind).toBe("UNVERIFIED");
      expect(
        createWorkingTimeCalculationProfile(p, null, []).workingTimeTarget?.context?.periods[0]
          .tariff.kind,
      ).toBe("UNVERIFIED");
    }
  });
  it("does not change actual work, TV-UK salary or bonuses when forecast evidence changes", () => {
    const entries = [24, 25, 26, 31].map((day) =>
      shift({ id: String(day), date: "2026-12-" + day }),
    );
    const p = createWorkingTimeCalculationProfile(profile, null, [], "ready", entries);
    expect(calculateMonthlySummary("2026-12", entries, p).actualMinutes).toBe(
      calculateMonthlySummary("2026-12", entries, profile).actualMinutes,
    );
    expect(calculateTvUkNursingProfileMonth("2026-12", entries, p)).toEqual(
      calculateTvUkNursingProfileMonth("2026-12", entries, profile),
    );
  });
  it("shares the target across monthly/annual reports, calendar, CSV and both PDF layouts", () => {
    const p = createWorkingTimeCalculationProfile(profile, null, []);
    const pattern = {
      assignment: "UNKNOWN" as const,
      workplaceCoverage: "UNKNOWN" as const,
      updatedAt: null,
    };
    const annual = finish(
      buildAnnualAvailableReportSteps(2026, [], p, [], pattern, "2026-12-31", bundledRuleResolver),
    );
    expect(annual.months[11]).toMatchObject({ targetMinutes: 9240, targetStatus: "PROVISIONAL" });
    for (const period of ["2026-12", "2026"]) {
      const report = finish(
        buildReportSteps({
          period,
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
        9240,
      );
      expect(reportToCsv(report)).toContain('"154:00"');
      for (const layout of ["standard", "compact"] as const) {
        const html = reportToHtml(report, { layout, includeSalary: true });
        expect(html).toContain("154:00 h");
        expect(html.match(/TV-UK Pflege BW: Planwert/g)).toHaveLength(1);
      }
    }
    expect([...resolveCalendarSpecialDays("2026-12", p, bundledRuleResolver).days.keys()]).toEqual([
      "2026-12-24",
      "2026-12-31",
    ]);
  });
});
