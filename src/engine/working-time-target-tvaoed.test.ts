import { describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/domain/types";
import type { DatedRemunerationProfile } from "@/domain/remuneration-profile";
import { validateWorkingTimeTargetContext } from "@/domain/saved-working-time-target";
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

function profile(sector: "BT_K" | "BT_B", extra: Partial<UserProfile> = {}): UserProfile {
  return {
    ...work,
    tariff: null,
    federalState: "HE",
    nursingTrainingTariff: { trainingYear: 2, sector, tariffRegion: "OTHER" },
    ...extra,
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
function snapshot(id = "TVAOED"): WorkingTimeTargetSnapshot {
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
  const kind: "TVAOED_K" | "TVAOED_B" = sector === "BT_K" ? "TVAOED_K" : "TVAOED_B";
  describe("TVAöD Pflege " + sector, () => {
    it.each([
      ["2026-07", 10626],
      ["2026-10", 9702],
      ["2026-11", 9702],
      ["2026-12", 8778],
      ["2027-12", 9240],
    ])("forecasts %s as %i from the existing training inputs", (month, minutes) => {
      const own = profile(sector),
        before = JSON.stringify(own),
        p = createWorkingTimeCalculationProfile(own, null, []);
      expect(calculateMonthlyTargetMinutes(month, p)).toBe(minutes);
      expect(p.workingTimeTarget?.context?.periods[0].tariff).toEqual({
        kind,
        version: "2025-07-01",
        scopeConfirmed: null,
      });
      expect(employmentTargetTariff(own)).toEqual(p.workingTimeTarget?.context?.periods[0].tariff);
      const result = calculateMonthlyWorkingTimeTarget(month, p);
      expect(result.status).toBe("PROVISIONAL");
      expect(
        result.notices.some(
          (n) => n.code === "TARGET_RULE_FORECAST" && n.message.includes("TVAöD Pflege"),
        ),
      ).toBe(true);
      expect(JSON.stringify(own)).toBe(before);
    });
    it("has its own referral provenance, four separate dates and no salary-table fifth", () => {
      const r = calculateMonthlyWorkingTimeTarget(
        "2026-12",
        createWorkingTimeCalculationProfile(profile(sector), null, []),
      );
      expect(r.adjustments.map((a) => a.date)).toEqual([
        "2026-12-24",
        "2026-12-25",
        "2026-12-26",
        "2026-12-31",
      ]);
      expect(
        r.adjustments.every(
          (a) =>
            a.ruleId.startsWith(sector === "BT_K" ? "tvaoed-pflege-btk-" : "tvaoed-pflege-btb-") &&
            a.legalBasis.includes("§ 7") &&
            a.sourceUrl.includes("TVAOED"),
        ),
      ).toBe(true);
    });
    it.each([
      [2340, 8892],
      [1800, 6840],
      [2311, 8782],
    ])(
      "uses %i personal weekly minutes, including shared integer rounding",
      (weeklyMinutes, expected) => {
        expect(
          calculateMonthlyTargetMinutes(
            "2026-12",
            createWorkingTimeCalculationProfile(profile(sector, { weeklyMinutes }), null, []),
          ),
        ).toBe(expected);
      },
    );
    it("reuses the no-Sunday answer for the fixed-week reference", () => {
      expect(
        calculateMonthlyTargetMinutes(
          "2026-12",
          createWorkingTimeCalculationProfile(
            profile(sector, { sundayHolidayWorkEligible: false }),
            null,
            [],
          ),
        ),
      ).toBe(9240);
    });
    it("keeps the work model unknown when the Sunday answer is missing", () => {
      expect(
        createWorkingTimeCalculationProfile(
          profile(sector, { sundayHolidayWorkEligible: null }),
          null,
          [],
        ).workingTimeTarget?.context?.periods[0].model.kind,
      ).toBe("UNKNOWN");
    });
    it("retains 38.5 personal hours for a BW training selection without using the adult BW table basis", () => {
      const own = profile(sector, {
        federalState: "BW",
        nursingTrainingTariff: { trainingYear: 3, sector, tariffRegion: "KAV_BW" },
      });
      expect(
        calculateMonthlyTargetMinutes(
          "2026-12",
          createWorkingTimeCalculationProfile(own, null, []),
        ),
      ).toBe(8778);
    });
    it.each([null, false])(
      "does not turn a missing/disabled youth preference (%s) into confirmed adulthood",
      (youth) => {
        const p = createWorkingTimeCalculationProfile(
          profile(sector),
          null,
          [],
          "ready",
          [],
          youth,
        );
        expect(p.workingTimeTarget?.context?.periods[0].tariff).toEqual({
          kind,
          version: "2025-07-01",
          scopeConfirmed: null,
        });
        expect(calculateMonthlyWorkingTimeTarget("2026-12", p).status).toBe("PROVISIONAL");
      },
    );
    it("does not apply adult training references while youth protection is active", () => {
      const p = createWorkingTimeCalculationProfile(profile(sector), null, [], "ready", [], true);
      const r = calculateMonthlyWorkingTimeTarget("2026-12", p);
      expect(r).toMatchObject({
        status: "UNAVAILABLE",
        targetMinutes: null,
        tariffReductionMinutes: 0,
      });
      expect(r.notices.some((n) => n.code === "TRAINING_YOUTH_TARGET_UNSUPPORTED")).toBe(true);
      expect(r.adjustments).toEqual([]);
    });
    it("does not bypass active youth protection through stored confirmed target facts", () => {
      const saved = {
        ...snapshot(),
        context: {
          ...decemberTargetContext,
          periods: [
            {
              ...decemberTargetContext.periods[0],
              tariff: { kind, version: "2025-07-01", scopeConfirmed: true },
            },
          ],
        },
      };
      const p = createWorkingTimeCalculationProfile(profile(sector), saved, [], "ready", [], true);
      expect(calculateMonthlyWorkingTimeTarget("2026-12", p).targetMinutes).toBeNull();
    });
    it("resolves an old training marker only with applicable stored employment", () => {
      const own = profile(sector),
        saved = snapshot(),
        row = dated(own),
        before = JSON.stringify({ saved, row });
      const p = createWorkingTimeCalculationProfile(own, saved, [row]);
      expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
      expect(p.workingTimeTarget?.context?.periods[0].tariff.kind).toBe(kind);
      expect(
        createWorkingTimeCalculationProfile(own, saved, []).workingTimeTarget?.context?.periods[0]
          .tariff.kind,
      ).toBe("UNVERIFIED");
      expect(JSON.stringify({ saved, row })).toBe(before);
    });
    it("retains a later part-time/training-year change", () => {
      const old = profile(sector),
        next = profile(sector, {
          weeklyMinutes: 1800,
          nursingTrainingTariff: { ...old.nursingTrainingTariff!, trainingYear: 3 },
        }),
        history = [dated(old), dated(next, "2026-12-16")];
      const p = createWorkingTimeCalculationProfile(next, null, history);
      expect(calculateMonthlyTargetMinutes("2026-11", p)).toBe(9702);
      expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(7962); // 11*462 + (12-4)*360
      expect(
        employmentProfileAt({ ...next, employmentTimeline: history }, "2026-12-01")
          .nursingTrainingTariff?.trainingYear,
      ).toBe(2);
      expect(
        employmentProfileAt({ ...next, employmentTimeline: history }, "2026-12-16")
          .nursingTrainingTariff?.trainingYear,
      ).toBe(3);
    });
    it("does not let recorded duty or school entries change the contractual reference", () => {
      const entries = [24, 25, 26, 31].map((day) =>
        shift({ id: String(day), date: "2026-12-" + day, type: day === 24 ? "TRAINING" : "DAY" }),
      );
      const own = profile(sector),
        p = createWorkingTimeCalculationProfile(own, null, [], "ready", entries);
      expect(calculateMonthlySummary("2026-12", entries, p)).toMatchObject({
        targetMinutes: 8778,
        actualMinutes: calculateMonthlySummary("2026-12", entries, own).actualMinutes,
      });
    });
    it("retains the previous provisional reference outside reviewed years", () => {
      const r = calculateMonthlyWorkingTimeTarget(
        "2028-12",
        createWorkingTimeCalculationProfile(profile(sector), null, []),
      );
      expect(r.status).toBe("PROVISIONAL");
      expect(r.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
      expect(r.adjustments.every((a) => a.status === "LEGACY_ESTIMATE")).toBe(true);
    });
    it("uses a single number in month, annual, CSV, PDF and the special-day calendar", () => {
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
      const r = finish(
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
      expect(r.workingTimeTargets?.[0].targetMinutes).toBe(8778);
      expect(reportToCsv(r)).toContain('"146:18"');
      for (const layout of ["standard", "compact"] as const) {
        const html = reportToHtml(r, { layout, includeSalary: true });
        expect(html).toContain("146:18 h");
        expect(html).toContain("TVAöD Pflege");
      }
      expect([
        ...resolveCalendarSpecialDays("2026-12", p, bundledRuleResolver).days.keys(),
      ]).toEqual(["2026-12-24", "2026-12-31"]);
    });
  });
}

describe("training scope boundaries", () => {
  it("leaves competing salary roots unverified", () => {
    for (const extra of [
      { tariff: work.tariff },
      {
        vkaETariff: {
          payGroup: "E9b" as const,
          payLevel: 4 as const,
          sector: "BT_K" as const,
          tariffRegion: "OTHER" as const,
        },
      },
      { salaryBasisConflict: { nursingTrainingTariff: profile("BT_K").nursingTrainingTariff } },
    ]) {
      const own = profile("BT_K", extra);
      expect(employmentTargetTariff(own).kind).toBe("UNVERIFIED");
      expect(
        createWorkingTimeCalculationProfile(own, null, []).workingTimeTarget?.context?.periods[0]
          .tariff.kind,
      ).toBe("UNVERIFIED");
    }
  });
  it("keeps the later genuine employment tariff when correcting training for the whole period", () => {
    const own = profile("BT_B"),
      next: UserProfile = {
        ...own,
        nursingTrainingTariff: null,
        tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
        federalState: "BW",
      };
    const base = {
      ...dated(own),
      employmentOverrides: { nursingTrainingTariff: "2026-10-27", tariff: "2026-10-27" },
    };
    const p = createWorkingTimeCalculationProfile(next, snapshot(), [
      base,
      dated(next, "2026-12-01"),
    ]);
    expect(calculateMonthlyTargetMinutes("2026-10", p)).toBe(9702);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(9240);
  });
  it("limits the youth guard to dated training periods before a real employment transition", () => {
    const trainee = profile("BT_K"),
      employee: UserProfile = { ...work, federalState: "HE" };
    const p = createWorkingTimeCalculationProfile(
      employee,
      null,
      [dated(trainee), dated(employee, "2026-12-01")],
      "ready",
      [],
      true,
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-11", p).targetMinutes).toBeNull();
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
  });
  it("uses the explicit sector in financial-only training history without claiming adulthood", () => {
    const own = profile("BT_B"),
      row = dated(own);
    const financial = {
      ...row,
      employment: undefined,
      data: {
        version: 3 as const,
        weeklyMinutes: 2310,
        selection: {
          kind: "tariff" as const,
          packageId: "tvaoed-pflege-vka",
          variant: "BT_B",
          region: "OTHER",
          group: "b",
          level: "s2",
          fullTimeWeeklyMinutes: 2340,
          specialDutyAllowance: null,
        },
      },
    };
    const p = createWorkingTimeCalculationProfile(own, null, [financial]);
    expect(p.workingTimeTarget?.context?.periods[0].tariff).toEqual({
      kind: "TVAOED_B",
      version: "2025-07-01",
      scopeConfirmed: null,
    });
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
  });
  it.each(["TVAOED_K", "TVAOED_B"] as const)(
    "roundtrips %s target facts while rejecting malformed scope",
    (kind) => {
      const context = {
        periods: [
          {
            ...decemberTargetContext.periods[0],
            tariff: { kind, version: "2025-07-01", scopeConfirmed: null },
          },
        ],
        days: [],
      };
      expect(validateWorkingTimeTargetContext(JSON.parse(JSON.stringify(context)))).toEqual(
        context,
      );
      expect(() =>
        validateWorkingTimeTargetContext({
          ...context,
          periods: [
            {
              ...context.periods[0],
              tariff: { ...context.periods[0].tariff, scopeConfirmed: "yes" },
            },
          ],
        }),
      ).toThrow();
    },
  );
  it.each(["loading", "error"] as const)(
    "never displays an adult training value while the guard is %s",
    (status) => {
      const p = createWorkingTimeCalculationProfile(
        profile("BT_K"),
        null,
        [],
        "ready",
        [],
        null,
        status,
      );
      expect(calculateMonthlyWorkingTimeTarget("2026-12", p)).toMatchObject({
        status: "UNAVAILABLE",
        targetMinutes: null,
      });
      const employee = createWorkingTimeCalculationProfile(
        work,
        null,
        [],
        "ready",
        [],
        null,
        status,
      );
      expect(calculateMonthlyTargetMinutes("2026-12", employee)).toBe(8778);
    },
  );
  it("leaves non-training target hours unchanged by the youth preference", () => {
    const p = createWorkingTimeCalculationProfile(work, null, [], "ready", [], true);
    expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
  });
});
