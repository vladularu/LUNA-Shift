import { describe, expect, it, vi } from "vitest";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { bundledRuleResolver, RuleResolutionError } from "@/rules/rule-resolver";
import type { UserProfile } from "@/domain/types";
import type { DatedRemunerationProfile } from "@/domain/remuneration-profile";
import { employmentDataFromProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { validateWorkingTimeTargetContext } from "@/domain/saved-working-time-target";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import type { TargetTariff, WorkingTimeTargetContext } from "@/domain/working-time-target";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import { employmentTargetTariff } from "@/features/settings/working-time-target-form-model";
import { buildReportSteps } from "@/features/report-export/report-data";
import { reportToCsv, reportToHtml } from "@/features/report-export/report-formats";
import { resolveCalendarSpecialDays } from "@/features/calendar/calendar-special-days";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { calculateMonthlyWorkingTimeTarget } from "./working-time-target";
import { calculateMonthlyTargetMinutes } from "./monthly-summary";
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

type Scope = "COMMON" | "GENERAL" | "SECTION_43";
const kinds = { COMMON: "TVAL_COMMON", GENERAL: "TVAL_GENERAL", SECTION_43: "TVAL_KR" } as const;
const own = (extra: Partial<UserProfile> = {}): UserProfile => ({
  ...work,
  tariff: null,
  federalState: "HE",
  sundayHolidayWorkEligible: true,
  tvalPflegeTariff: { trainingYear: 2, universityRegion: "WEST" },
  ...extra,
});
function dated(
  scope: Scope,
  effectiveFrom: string | null = null,
  weeklyMinutes = 2310,
): DatedRemunerationProfile {
  return {
    effectiveFrom,
    revision: 1,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    data: {
      version: 6,
      weeklyMinutes,
      selection: {
        kind: "tariff",
        packageId: "tval-pflege-tdl",
        variant: "CARE",
        region: "WEST_38_5",
        group: "regular",
        level: "2",
        fullTimeWeeklyMinutes: 2310,
        tvalEmployerScope: scope === "COMMON" ? null : scope,
      },
    },
  };
}
function projected(
  scope: Scope,
  extra: Partial<UserProfile> = {},
  youth: boolean | null = null,
  youthStatus: "ready" | "loading" | "error" = "ready",
) {
  return createWorkingTimeCalculationProfile(
    own(extra),
    null,
    scope === "COMMON" ? [] : [dated(scope, null, extra.weeklyMinutes ?? 2310)],
    "ready",
    [],
    youth,
    youthStatus,
  );
}
function snapshot(id = "TVA_L"): WorkingTimeTargetSnapshot {
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
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
for (const scope of ["COMMON", "GENERAL", "SECTION_43"] as const) {
  describe("TVA-L Pflege " + scope, () => {
    it.each([
      ["2026-07", 10626],
      ["2026-10", scope === "SECTION_43" ? 9702 : 10164],
      ["2026-11", 9702],
      ["2026-12", scope === "SECTION_43" ? 8778 : 9240],
      ["2027-12", scope === "SECTION_43" ? 9240 : 9702],
    ])("uses independent calendar reference for %s: %i", (month, expected) => {
      const p = projected(scope),
        before = JSON.stringify(p);
      const r = calculateMonthlyWorkingTimeTarget(month, p);
      expect(r.targetMinutes).toBe(expected);
      expect(r.status).toBe("PROVISIONAL");
      expect(p.workingTimeTarget?.context?.periods[0].tariff).toEqual({
        kind: kinds[scope],
        version: "2026-02-14",
        scopeConfirmed: null,
      });
      expect(
        r.notices.some(
          (n) => n.code === "TARGET_RULE_FORECAST" && n.message.includes("TVA-L Pflege"),
        ),
      ).toBe(true);
      expect(JSON.stringify(p)).toBe(before);
    });
    it("keeps its own referral identity and the separate compensation rule", () => {
      const r = calculateMonthlyWorkingTimeTarget("2026-12", projected(scope));
      expect(r.adjustments.map((a) => a.date)).toEqual(
        scope === "SECTION_43"
          ? ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"]
          : ["2026-12-24", "2026-12-25", "2026-12-31"],
      );
      expect(
        r.adjustments.every(
          (a) =>
            a.ruleId.startsWith("tval-pflege-") &&
            a.legalBasis.includes("\u00a7 7") &&
            a.sourceUrl.includes("TVA-L"),
        ),
        JSON.stringify(r.adjustments),
      ).toBe(true);
      if (scope === "SECTION_43")
        expect(
          r.notices.some(
            (n) => n.code === "TARGET_RULE_FORECAST" && n.message.includes("planfreie Feiertage"),
          ),
        ).toBe(true);
      else expect(r.notices.some((n) => n.code === "CONDITIONAL_ROSTER_FREE_FORECAST")).toBe(false);
    });
    it.each([
      [1800, scope === "SECTION_43" ? 6840 : 7200],
      [2311, scope === "SECTION_43" ? 8782 : 9244],
    ])(
      "uses personal %i minutes, never the salary full-time denominator",
      (weeklyMinutes, expected) => {
        expect(calculateMonthlyTargetMinutes("2026-12", projected(scope, { weeklyMinutes }))).toBe(
          expected,
        );
      },
    );
    it("uses the existing no-Sunday answer for a fixed five-day reference", () => {
      expect(
        calculateMonthlyTargetMinutes(
          "2026-12",
          projected(scope, { sundayHolidayWorkEligible: false }),
        ),
      ).toBe(9240);
    });
    it.each(["active", "loading", "error"] as const)(
      "has no adult value for youth state %s",
      (state) => {
        const r = calculateMonthlyWorkingTimeTarget(
          "2026-12",
          projected(scope, {}, state === "active", state === "active" ? "ready" : state),
        );
        expect(r.targetMinutes).toBeNull();
        expect(r.status).toBe("UNAVAILABLE");
        expect(r.adjustments).toEqual([]);
        expect(r.notices.some((n) => n.code.startsWith("TRAINING_YOUTH_"))).toBe(true);
      },
    );
    it.each([false, null])("does not treat preference %s as adulthood evidence", (youth) => {
      const p = projected(scope, {}, youth),
        r = calculateMonthlyWorkingTimeTarget("2026-12", p);
      expect(r.status).toBe("PROVISIONAL");
      expect(p.workingTimeTarget?.context?.periods[0].tariff).toMatchObject({
        scopeConfirmed: null,
      });
    });
  });
}
it("does not infer a hospital employer from training year, West/East or Sunday work", () => {
  for (const universityRegion of ["WEST", "EAST"] as const) {
    const p = own({ tvalPflegeTariff: { trainingYear: 3, universityRegion } });
    expect(employmentTargetTariff(p)).toMatchObject({ kind: "TVAL_COMMON", scopeConfirmed: null });
    const r = calculateMonthlyWorkingTimeTarget(
      "2026-10",
      createWorkingTimeCalculationProfile(p, null, []),
    );
    expect(r.targetMinutes).toBe(10164);
    expect(r.notices.some((n) => n.message.includes("Arbeitgeberregel offen"))).toBe(true);
  }
});
it("reuses the explicit dated employer scope even alongside simple employment data", () => {
  const p = own(),
    row = { ...dated("SECTION_43"), employment: employmentDataFromProfile(p) };
  const r = createWorkingTimeCalculationProfile(p, null, [row]);
  expect(r.workingTimeTarget?.context?.periods[0].tariff).toMatchObject({ kind: "TVAL_KR" });
  expect(calculateMonthlyTargetMinutes("2026-12", r)).toBe(8778);
});
it("distinguishes a real employer switch inside December and keeps earlier dates", () => {
  const p = createWorkingTimeCalculationProfile(own(), null, [
    dated("GENERAL"),
    dated("SECTION_43", "2026-12-16", 1800),
  ]);
  expect(calculateMonthlyTargetMinutes("2026-10", p)).toBe(10164);
  expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(7962);
  const r = calculateMonthlyWorkingTimeTarget("2026-12", p);
  expect(r.days.find((d) => d.date === "2026-12-15")?.baseMinutes).toBe(462);
  expect(r.days.find((d) => d.date === "2026-12-16")?.baseMinutes).toBe(360);
});
it("upgrades an old TVA_L marker only through applicable stored employment", () => {
  const p = own(),
    source = snapshot(),
    before = JSON.stringify(source);
  const history = [
    {
      ...dated("COMMON"),
      data: remunerationDataFromLegacy(p),
      employment: employmentDataFromProfile(p),
    },
  ];
  const projection = createWorkingTimeCalculationProfile(p, source, history);
  expect(calculateMonthlyTargetMinutes("2026-12", projection)).toBe(9240);
  expect(projection.workingTimeTarget?.context?.periods[0].tariff).toMatchObject({
    kind: "TVAL_COMMON",
  });
  expect(JSON.stringify(source)).toBe(before);
  const untouched = createWorkingTimeCalculationProfile(p, source, []);
  expect(untouched.workingTimeTarget?.context?.periods[0].tariff.kind).toBe("UNVERIFIED");
});
it("ignores single shifts and old day confirmations in the automatic forecast", () => {
  const p = projected("SECTION_43");
  const context = p.workingTimeTarget!.context!;
  const snapshot: WorkingTimeTargetSnapshot = {
    saved: null,
    staleDates: [],
    planRevision: "x",
    context: {
      ...context,
      days: [
        {
          date: "2026-12-26",
          rosterStatus: "FINAL",
          disposition: "WORK_REQUIRED",
          lostMinutes: 900,
          mustWorkElsewhere: false,
        },
      ],
    },
  };
  const withShift = createWorkingTimeCalculationProfile(
    own(),
    snapshot,
    [dated("SECTION_43")],
    "ready",
    [shift({ date: "2026-12-26" })],
  );
  expect(calculateMonthlyTargetMinutes("2026-12", withShift)).toBe(8778);
});
it("preserves an explicit future TV-UK change during a whole-period TVA-L correction", () => {
  const p = own(),
    s = snapshot();
  const context = s.context!;
  const saved = {
    ...s,
    context: {
      ...context,
      periods: [
        { ...context.periods[0], validTo: "2026-11-30" },
        {
          ...context.periods[0],
          validFrom: "2026-12-01",
          tariff: {
            kind: "TVUK_NURSING",
            version: "2025-01-01",
            scopeConfirmed: null,
            accountRuleConfirmed: null,
          } as TargetTariff,
        },
      ],
    },
  };
  const history = [
    {
      ...dated("COMMON"),
      data: remunerationDataFromLegacy(p),
      employment: employmentDataFromProfile(p),
      employmentOverrides: { tvalPflegeTariff: "2026-10-27" },
    },
  ];
  const result = createWorkingTimeCalculationProfile(p, saved, history);
  expect(result.workingTimeTarget?.context?.periods.at(-1)?.tariff.kind).toBe("TVUK_NURSING");
});
it("keeps unsupported assistant categories explicit instead of treating them as regular training", () => {
  const row = dated("SECTION_43", "2027-01-01");
  const selection = row.data.selection;
  if (selection.kind !== "tariff") throw new Error("tariff expected");
  const r = createWorkingTimeCalculationProfile(own(), null, [
    { ...row, data: { ...row.data, selection: { ...selection, group: "assistant" } } },
  ]);
  expect(r.workingTimeTarget?.context?.periods.at(-1)?.tariff.kind).toBe("UNVERIFIED");
});
it.each(["2025-12", "2028-12"])("retains a clearly unreviewed legacy reference in %s", (month) => {
  const r = calculateMonthlyWorkingTimeTarget(month, projected("SECTION_43"));
  expect(r.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
  expect(r.adjustments.some((a) => a.kind === "TARIFF_SPECIAL_DAY")).toBe(false);
});
it("does not activate training rules for a salary conflict", () => {
  const p = own({
    nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
  });
  expect(employmentTargetTariff(p).kind).toBe("UNVERIFIED");
  expect(
    createWorkingTimeCalculationProfile(p, null, []).workingTimeTarget?.context?.periods[0].tariff
      .kind,
  ).toBe("UNVERIFIED");
});
it.each(["TVAL_COMMON", "TVAL_GENERAL", "TVAL_KR"] as const)(
  "roundtrips the strict %s boundary",
  (kind) => {
    const context: WorkingTimeTargetContext = {
      periods: [
        {
          ...decemberTargetContext.periods[0],
          tariff: { kind, version: "2026-02-14", scopeConfirmed: null } as TargetTariff,
        },
      ],
      days: [],
    };
    expect(validateWorkingTimeTargetContext(context)).toEqual(context);
    expect(() =>
      validateWorkingTimeTargetContext({
        ...context,
        periods: [
          {
            ...context.periods[0],
            tariff: { ...context.periods[0].tariff, employerScope: "invented" },
          },
        ],
      }),
    ).toThrow();
  },
);
it("uses the shared report and calendar projection without tariff salary rules", () => {
  const profile = projected("COMMON"),
    data = finish(
      buildReportSteps({
        period: "2026-12",
        profile,
        entries: [],
        tariffDecisions: [],
        workPatternSettings: {
          assignment: "UNKNOWN",
          workplaceCoverage: "UNKNOWN",
          updatedAt: null,
        },
        ruleResolver: bundledRuleResolver,
        createdAt: "2026-12-31T12:00:00Z",
        referenceDate: "2026-12-31",
        youthProtection: false,
        testMonths: [],
      }),
    );
  expect(reportToCsv(data)).toContain("154:00");
  expect(reportToHtml(data)).toContain("154:00");
  const special = resolveCalendarSpecialDays("2026-12", profile, bundledRuleResolver);
  expect(special).toBeDefined();
});

it.each(["TVAL_GENERAL", "TVAL_COMMON"] as const)(
  "does not invent a Saturday fifth from zero loss hours for %s",
  (kind) => {
    const context: WorkingTimeTargetContext = {
      periods: [
        {
          ...decemberTargetContext.periods[0],
          tariff: { kind, version: "2026-02-14", scopeConfirmed: true } as TargetTariff,
        },
      ],
      days: [
        {
          date: "2026-12-26",
          rosterStatus: "FINAL",
          disposition: "ROSTER_FREE",
          lostMinutes: 0,
          mustWorkElsewhere: true,
        },
      ],
    };
    const r = calculateMonthlyWorkingTimeTarget("2026-12", own(), undefined, context);
    expect(r.adjustments.find((a) => a.date === "2026-12-26")?.minutes ?? 0).toBe(0);
  },
);
it("uses confirmed Saturday loss minutes for GENERAL, not a weekly fifth", () => {
  const context: WorkingTimeTargetContext = {
    periods: [
      {
        ...decemberTargetContext.periods[0],
        tariff: {
          kind: "TVAL_GENERAL",
          version: "2026-02-14",
          scopeConfirmed: true,
        } as TargetTariff,
      },
    ],
    days: [
      {
        date: "2026-12-26",
        rosterStatus: "FINAL",
        disposition: "ROSTER_FREE",
        lostMinutes: 360,
        mustWorkElsewhere: true,
      },
    ],
  };
  const r = calculateMonthlyWorkingTimeTarget("2026-12", own(), undefined, context);
  expect(r.adjustments.find((a) => a.date === "2026-12-26")).toMatchObject({
    minutes: 360,
    status: "CONFIRMED",
  });
});
it("keeps worked hospital holidays in the separate compensation path", () => {
  const context: WorkingTimeTargetContext = {
    periods: [
      {
        ...decemberTargetContext.periods[0],
        tariff: { kind: "TVAL_KR", version: "2026-02-14", scopeConfirmed: true } as TargetTariff,
      },
    ],
    days: [{ date: "2026-12-26", rosterStatus: "FINAL", disposition: "WORK_REQUIRED" }],
  };
  const r = calculateMonthlyWorkingTimeTarget("2026-12", own(), undefined, context);
  expect(r.adjustments.some((a) => a.date === "2026-12-26")).toBe(false);
  expect(r.notices.some((n) => n.code === "HOLIDAY_TIME_OFF_SEPARATE")).toBe(true);
});
it("preserves a newer explicit hospital target against older general employment", () => {
  const p = own(),
    row = { ...dated("GENERAL"), employment: employmentDataFromProfile(p) };
  const source: WorkingTimeTargetSnapshot = {
    ...snapshot(),
    context: {
      periods: [
        {
          ...decemberTargetContext.periods[0],
          validFrom: "2026-01-01",
          validTo: "2026-11-30",
          tariff: {
            kind: "TVAL_GENERAL",
            version: "2026-02-14",
            scopeConfirmed: null,
          } as TargetTariff,
        },
        {
          ...decemberTargetContext.periods[0],
          validFrom: "2026-12-01",
          tariff: { kind: "TVAL_KR", version: "2026-02-14", scopeConfirmed: null } as TargetTariff,
        },
      ],
      days: [],
    },
  };
  const r = createWorkingTimeCalculationProfile(p, source, [row]);
  expect(r.workingTimeTarget?.context?.periods.at(-1)?.tariff.kind).toBe("TVAL_KR");
  expect(calculateMonthlyTargetMinutes("2026-12", r)).toBe(8778);
});
it("guards only training dates before a real later employee transition", () => {
  const trainee = own(),
    employee: UserProfile = { ...work, federalState: "HE" };
  const employmentRow = (
    p: UserProfile,
    effectiveFrom: string | null,
  ): DatedRemunerationProfile => ({
    ...dated("COMMON", effectiveFrom),
    data: remunerationDataFromLegacy(p),
    employment: employmentDataFromProfile(p),
  });
  const p = createWorkingTimeCalculationProfile(
    employee,
    null,
    [employmentRow(trainee, null), employmentRow(employee, "2026-12-01")],
    "ready",
    [],
    true,
  );
  expect(calculateMonthlyWorkingTimeTarget("2026-11", p).targetMinutes).toBeNull();
  expect(calculateMonthlyTargetMinutes("2026-12", p)).toBe(8778);
});

it.each(["variant", "region", "level"] as const)(
  "keeps unsupported TVA-L %s values unreviewed",
  (field) => {
    const row = dated("SECTION_43"),
      selected = row.data.selection;
    if (selected.kind !== "tariff") throw new Error("tariff expected");
    const p = createWorkingTimeCalculationProfile(own(), null, [
      {
        ...row,
        data: { ...row.data, selection: { ...selected, [field]: "UNREVIEWED" } },
      },
    ]);
    expect(p.workingTimeTarget?.context?.periods[0].tariff.kind).toBe("UNVERIFIED");
  },
);

it.each([
  ["SECTION_43", "TVAL_KR", 9702, 8778],
  ["GENERAL", "TVAL_GENERAL", 10164, 9240],
  [null, "TVAL_COMMON", 10164, 9240],
] as const)(
  "uses saved simple workplace %s without a financial setup",
  (employerScope, kind, october, december) => {
    const p = own({
      tvalPflegeTariff: { trainingYear: 2, universityRegion: "WEST", employerScope },
    });
    const calculation = createWorkingTimeCalculationProfile(p, null, []);
    expect(calculation.workingTimeTarget?.context?.periods[0].tariff).toMatchObject({
      kind,
      scopeConfirmed: null,
    });
    expect(employmentTargetTariff(p)).toMatchObject({ kind });
    expect(calculateMonthlyTargetMinutes("2026-10", calculation)).toBe(october);
    expect(calculateMonthlyTargetMinutes("2026-12", calculation)).toBe(december);
  },
);
it.each(["SECTION_43", "GENERAL", null] as const)(
  "lets explicit simple workplace %s supersede older financial metadata",
  (employerScope) => {
    const p = own({
      tvalPflegeTariff: { trainingYear: 2, universityRegion: "WEST", employerScope },
    });
    const row = {
      ...dated(employerScope === "SECTION_43" ? "GENERAL" : "SECTION_43"),
      employment: employmentDataFromProfile(p),
    };
    const calculation = createWorkingTimeCalculationProfile(p, null, [row]);
    expect(calculateMonthlyTargetMinutes("2026-12", calculation)).toBe(
      employerScope === "SECTION_43" ? 8778 : 9240,
    );
  },
);
