import { describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/domain/types";
import type { DatedRemunerationProfile } from "@/domain/remuneration-profile";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { employmentDataFromProfile, employmentProfileAt } from "@/domain/employment-history";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import { employmentTargetTariff } from "@/features/settings/working-time-target-form-model";
import { buildAnnualAvailableReportSteps } from "@/features/analysis/annual-core-report";
import { buildReportSteps } from "@/features/report-export/report-data";
import { reportToCsv, reportToHtml } from "@/features/report-export/report-formats";
import { resolveCalendarSpecialDays } from "@/features/calendar/calendar-special-days";
import { bundledRuleResolver, RuleResolutionError } from "@/rules/rule-resolver";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { calculateMonthlyWorkingTimeTarget } from "./working-time-target";
import { calculateMonthlySummary, calculateMonthlyTargetMinutes } from "./monthly-summary";
import { work, shift } from "./remuneration-test-fixtures";

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

function profile(sector: "BT_K" | "BT_B", overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    ...work,
    tariff: null,
    federalState: "HE",
    vkaETariff: { payGroup: "E9b", payLevel: 4, sector, tariffRegion: "OTHER" },
    ...overrides,
  };
}
function dated(p: UserProfile, effectiveFrom: string | null = null): DatedRemunerationProfile {
  return {
    effectiveFrom,
    employment: employmentDataFromProfile(p),
    data: remunerationDataFromLegacy(p),
    revision: 1,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
  };
}
function snapshot(id = "VKA_E"): WorkingTimeTargetSnapshot {
  return {
    saved: null,
    staleDates: [],
    planRevision: "plan",
    context: {
      periods: [
        {
          ...decemberTargetContext.periods[0],
          validFrom: "2026-01-01",
          tariff: { kind: "UNVERIFIED", id },
        },
      ],
      days: [],
    },
  };
}
function finish<T>(steps: Generator<unknown, T, unknown>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
const pattern = {
  assignment: "UNKNOWN" as const,
  workplaceCoverage: "UNKNOWN" as const,
  updatedAt: null,
};

for (const sector of ["BT_K", "BT_B"] as const) {
  const kind: "TVOED_K" | "TVOED_B" = sector === "BT_K" ? "TVOED_K" : "TVOED_B";
  describe("VKA E with existing " + sector + " selection", () => {
    // Independent calendar references: weekdays, minus qualifying weekday/Saturday holidays and 24/31 Dec.
    it.each([
      ["2026-07", 10626], // 23 * 462
      ["2026-10", 9702], // (22 - Sat 03 Oct) * 462
      ["2026-11", 9702], // HE: 21 * 462
      ["2026-12", 8778], // (23 - 24/25/26/31 Dec) * 462
      ["2027-12", 9240], // (23 - 24/25/31 Dec; Sun 26 Dec excluded) * 462
    ])("calculates %s as %i from existing inputs alone", (month, minutes) => {
      const own = profile(sector);
      const before = JSON.stringify(own);
      const p = createWorkingTimeCalculationProfile(own, null, []);
      expect(calculateMonthlyTargetMinutes(month, p)).toBe(minutes);
      expect(p.workingTimeTarget?.context?.periods[0].tariff).toEqual({
        kind,
        version: "2026-01-01",
        scopeConfirmed: null,
      });
      expect(employmentTargetTariff(own)).toEqual(p.workingTimeTarget?.context?.periods[0].tariff);
      expect(JSON.stringify(own)).toBe(before);
    });
    it("uses this special part's own rule identities and contractual fifths", () => {
      const result = calculateMonthlyWorkingTimeTarget(
        "2026-12",
        createWorkingTimeCalculationProfile(profile(sector), null, []),
      );
      expect(result).toMatchObject({ targetMinutes: 8778, status: "PROVISIONAL" });
      expect(result.adjustments.map((a) => a.date)).toEqual([
        "2026-12-24",
        "2026-12-25",
        "2026-12-26",
        "2026-12-31",
      ]);
      expect(
        result.adjustments.every((a) =>
          a.ruleId.startsWith(sector === "BT_K" ? "tvoed-k-" : "tvoed-b-"),
        ),
      ).toBe(true);
    });
    it("reuses the no-Sunday answer without a five/seven-day question", () => {
      const p = createWorkingTimeCalculationProfile(
        profile(sector, { sundayHolidayWorkEligible: false }),
        null,
        [],
      );
      expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(9240); // 20 * 462; Sat 26 Dec carries no fixed work.
      expect(p.workingTimeTarget?.context?.periods[0].model.kind).toBe("FIXED_WEEK");
    });
    it("retains an unknown Sunday answer as an unknown work pattern", () => {
      const p = createWorkingTimeCalculationProfile(
        profile(sector, { sundayHolidayWorkEligible: null }),
        null,
        [],
      );
      expect(p.workingTimeTarget?.context?.periods[0].model.kind).toBe("UNKNOWN");
      expect(calculateMonthlyWorkingTimeTarget("2026-12", p).status).toBe("PROVISIONAL");
    });
    it.each([
      [2340, 8892],
      [1800, 6840],
      [2311, 8782],
    ])(
      "uses personal %i weekly minutes, not the E table's full-time basis",
      (weeklyMinutes, expected) => {
        const p = createWorkingTimeCalculationProfile(profile(sector, { weeklyMinutes }), null, []);
        expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(expected);
      },
    );
    it("does not derive contractual hours from E group, level or KAV region", () => {
      const p = profile(sector);
      const changed = {
        ...p,
        vkaETariff: {
          ...p.vkaETariff!,
          payGroup: "E15" as const,
          payLevel: 6 as const,
          tariffRegion: "KAV_BW" as const,
        },
      };
      expect(
        calculateMonthlyTargetMinutes(
          "2026-12",
          createWorkingTimeCalculationProfile(changed, null, []),
        ),
      ).toBe(8778);
    });
    it("leaves entered services, actual work and the contractual forecast independent", () => {
      const entries = [24, 25, 26, 31].map((day) =>
        shift({ id: String(day), date: "2026-12-" + day, startTime: "08:00", endTime: "16:00" }),
      );
      const own = profile(sector);
      const p = createWorkingTimeCalculationProfile(own, null, [], "ready", entries);
      expect(calculateMonthlySummary("2026-12", entries, p)).toMatchObject({
        targetMinutes: 8778,
        actualMinutes: calculateMonthlySummary("2026-12", entries, own).actualMinutes,
      });
    });
    it("resolves an old E marker only from applicable dated employment, without modifying storage", () => {
      const own = profile(sector),
        saved = snapshot(),
        history = [dated(own)];
      const before = JSON.stringify({ saved, history });
      const p = createWorkingTimeCalculationProfile(own, saved, history);
      expect(p.workingTimeTarget?.context?.periods[0].tariff.kind).toBe(kind);
      expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
      expect(JSON.stringify({ saved, history })).toBe(before);
    });
    it("keeps ambiguous historical E/current markers unresolved without dated employment", () => {
      for (const id of ["VKA_E", "CURRENT_SALARY_SELECTION"])
        expect(
          createWorkingTimeCalculationProfile(profile(sector), snapshot(id), []).workingTimeTarget
            ?.context?.periods[0].tariff.kind,
        ).toBe("UNVERIFIED");
    });
    it("preserves later part-time and level changes", () => {
      const old = profile(sector),
        next = profile(sector, {
          weeklyMinutes: 1800,
          vkaETariff: { ...old.vkaETariff!, payLevel: 5 },
        });
      const history = [dated(old), dated(next, "2026-12-16")];
      const p = createWorkingTimeCalculationProfile(next, null, history);
      expect(calculateMonthlyTargetMinutes("2026-11", p)).toBe(9702);
      expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(7962); // 11 * 462 + (12 - 4) * 360
      expect(
        employmentProfileAt({ ...next, employmentTimeline: history }, "2026-12-01").vkaETariff
          ?.payLevel,
      ).toBe(4);
      expect(
        employmentProfileAt({ ...next, employmentTimeline: history }, "2026-12-16").vkaETariff
          ?.payLevel,
      ).toBe(5);
    });
    it("preserves an explicitly rejected working-time scope", () => {
      const saved = snapshot();
      const context = {
        ...saved.context!,
        periods: [
          {
            ...saved.context!.periods[0],
            tariff: { kind, version: "2026-01-01" as const, scopeConfirmed: false },
          },
        ],
      };
      const own = profile(sector);
      const p = createWorkingTimeCalculationProfile(own, { ...saved, context }, [dated(own)]);
      expect(p.workingTimeTarget?.context?.periods[0].tariff).toEqual(context.periods[0].tariff);
      expect(calculateMonthlyWorkingTimeTarget("2026-12", p).tariffReductionMinutes).toBe(0);
    });
    it("preserves a documented unequal fixed week", () => {
      const saved = snapshot();
      const context = {
        ...saved.context!,
        periods: [
          {
            ...saved.context!.periods[0],
            model: {
              kind: "FIXED_WEEK" as const,
              weekdayMinutes: [600, 480, 360, 600, 270, 0, 0] as const,
            },
          },
        ],
      };
      const own = profile(sector, { sundayHolidayWorkEligible: false });
      const p = createWorkingTimeCalculationProfile(own, { ...saved, context }, [dated(own)]);
      expect(p.workingTimeTarget?.context?.periods[0].model).toEqual(context.periods[0].model);
      expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(9210);
    });
    it("keeps unknown versions and dates outside the reviewed coverage provisional", () => {
      const p = createWorkingTimeCalculationProfile(profile(sector), null, []);
      const result = calculateMonthlyWorkingTimeTarget("2028-12", p);
      expect(result.status).toBe("PROVISIONAL");
      expect(result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
    });
    it("uses the same number in month, annual, CSV, PDF data and special-day calendar", () => {
      const p = createWorkingTimeCalculationProfile(profile(sector), null, []);
      expect(
        finish(
          buildAnnualAvailableReportSteps(
            2026,
            [],
            p,
            [],
            pattern,
            "2026-12-31",
            bundledRuleResolver,
          ),
        ).months[11],
      ).toMatchObject({ targetMinutes: 8778, targetStatus: "PROVISIONAL" });
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
      expect(report.workingTimeTargets?.[0].targetMinutes).toBe(8778);
      expect(reportToCsv(report)).toContain('"146:18"');
      for (const layout of ["standard", "compact"] as const)
        expect(reportToHtml(report, { layout, includeSalary: true })).toContain("146:18 h");
      const calendar = resolveCalendarSpecialDays("2026-12", p, bundledRuleResolver);
      expect([...calendar.days.keys()]).toEqual(["2026-12-24", "2026-12-31"]);
    });
  });
}

describe("VKA E tariff boundaries", () => {
  it.each([
    { tariff: work.tariff },
    { tvUkNursingTariff: { payGroup: "PUK8" as const, payLevel: 4 as const } },
    {
      tvlKrTariff: {
        payGroup: "KR8" as const,
        payLevel: 4 as const,
        universityRegion: "WEST" as const,
      },
    },
    { salaryBasisConflict: { vkaETariff: profile("BT_K").vkaETariff } },
  ])("leaves competing salary roots unresolved: %j", (extra) => {
    const p = profile("BT_K", extra);
    expect(employmentTargetTariff(p).kind).toBe("UNVERIFIED");
    expect(
      createWorkingTimeCalculationProfile(p, null, []).workingTimeTarget?.context?.periods[0].tariff
        .kind,
    ).toBe("UNVERIFIED");
  });
  it("keeps an actual later TV-UK change after a whole-period E correction", () => {
    const own = profile("BT_B"),
      next: UserProfile = {
        ...own,
        vkaETariff: null,
        tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
        federalState: "BW",
      };
    const base = {
      ...dated(own),
      employmentOverrides: { vkaETariff: "2026-10-27", tariff: "2026-10-27" },
    };
    const p = createWorkingTimeCalculationProfile(next, snapshot(), [
      base,
      dated(next, "2026-12-01"),
    ]);
    expect(calculateMonthlyTargetMinutes("2026-10", p)).toBe(9702);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(9240);
    expect(p.workingTimeTarget?.context?.periods.map((p) => p.tariff.kind)).toEqual([
      "TVOED_B",
      "TVUK_NURSING",
    ]);
  });
});
