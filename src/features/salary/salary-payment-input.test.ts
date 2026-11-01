import { afterEach, describe, expect, it, vi } from "vitest";
import { employmentDataFromProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import {
  SALARY_PAYMENT_GROUPS,
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  type SalaryPaymentDelays,
  type SalaryPaymentPreferences,
} from "@/domain/salary-payment";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver, RuleResolutionError } from "@/rules/rule-resolver";
import { salaryMonthInput, type SalaryMonthContext } from "./salary-month-input";
import * as salaryInputs from "./salary-month-input";
import { salaryPaymentInput, salaryPaymentInputSteps } from "./salary-payment-input";

const context: SalaryMonthContext = {
  entries: [],
  tariffDecisions: [],
  resolver: bundledRuleResolver,
  workPatternSettings: {
    workplaceCoverage: "AROUND_THE_CLOCK",
    assignment: "PERMANENT",
    updatedAt: null,
  },
};
function prefs(delays: Partial<SalaryPaymentDelays> = {}): SalaryPaymentPreferences {
  return {
    version: 1,
    periods: [
      {
        effectiveMonth: "2025-01",
        delays: Object.fromEntries(
          SALARY_PAYMENT_GROUPS.map((group) => [group, delays[group] ?? 0]),
        ) as SalaryPaymentDelays,
      },
    ],
    reviewedEmptyMonths: [],
  };
}
function unknownPrefs(): SalaryPaymentPreferences {
  return {
    ...prefs(),
    periods: [
      {
        effectiveMonth: "2025-01",
        delays: Object.fromEntries(
          SALARY_PAYMENT_GROUPS.map((group) => [group, null]),
        ) as SalaryPaymentDelays,
      },
    ],
  };
}
function duty(date: string, type: ShiftEntry["type"] = "NIGHT") {
  return forecastShift({
    id: date,
    date,
    type,
    startTime: type === "EARLY" ? "07:00" : type === "LATE" ? "13:00" : "21:00",
    endTime: type === "EARLY" ? "15:00" : type === "LATE" ? "21:00" : "07:00",
  });
}
function finish<T>(steps: Generator<number, T, void>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

describe("canonical salary payment input", () => {
  afterEach(() => vi.restoreAllMocks());

  function failMonth(month: string, cause: Error) {
    const calculate = salaryInputs.salaryMonthInputSteps;
    vi.spyOn(salaryInputs, "salaryMonthInputSteps").mockImplementation(
      function* (claimMonth, profile, context) {
        if (claimMonth === month) throw cause;
        return yield* calculate(claimMonth, profile, context);
      },
    );
  }
  const ruleFailure = () =>
    new RuleResolutionError({
      code: "RULE_PACKAGE_NOT_FOUND",
      kind: "TARIFF",
      packageId: "test-tariff",
      effectiveDate: "2026-10-01",
      message: "Missing tariff rules",
    });

  it("keeps zero-lag gross exactly equal to the canonical earned calculation", () => {
    const input = { ...context, entries: [duty("2026-07-05")] };
    const actual = salaryPaymentInput("2026-07", forecastProfile, input, prefs(), "PAYOUT");
    expect(actual.pay).toEqual(salaryMonthInput("2026-07", forecastProfile, input).pay);
    expect(
      finish(salaryPaymentInputSteps("2026-07", forecastProfile, input, prefs(), "PAYOUT")),
    ).toEqual(actual);
  });

  it("uses the claim month's historical profile and preserves original shift IDs, dates and rates", () => {
    const oldProfile = {
      ...forecastProfile,
      weeklyMinutes: 1200,
      tariff: { ...forecastProfile.tariff!, payLevel: 2 as const },
    };
    const now = forecastProfile.createdAt;
    const profile: UserProfile = {
      ...forecastProfile,
      employmentTimeline: [
        {
          effectiveFrom: null,
          data: remunerationDataFromLegacy(oldProfile),
          employment: employmentDataFromProfile(oldProfile),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          effectiveFrom: "2026-08-01",
          data: remunerationDataFromLegacy(forecastProfile),
          employment: employmentDataFromProfile(forecastProfile),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const shift = duty("2026-07-05");
    const input = { ...context, entries: [shift] };
    const actual = salaryPaymentInput("2026-09", profile, input, prefs({ PREMIUMS: 2 }), "PAYOUT");
    const earned = salaryMonthInput("2026-07", profile, input);
    const claim = actual.sources.find((source) => source.month === "2026-07")!;
    expect(claim.profile.weeklyMinutes).toBe(1200);
    expect(claim.profile.tariff?.payLevel).toBe(2);
    expect(claim.shifts).toEqual([shift]);
    expect(claim.pay).toBe(earned.pay);
    expect(actual.pay.timePremiumAmount).toBe(earned.pay.timePremiumAmount);
    expect(actual.pay.shiftBreakdowns.find((line) => line.shiftId === shift.id)).toBe(
      earned.pay.shiftBreakdowns[0],
    );
    expect(actual.pay.personalBaseAmount).toBe(
      salaryMonthInput("2026-09", profile, input).pay.personalBaseAmount,
    );
  });

  it("retains cross-month night evidence and per-claim decisions for a delayed monthly allowance", () => {
    const input = {
      ...context,
      entries: [
        duty("2026-12-20"),
        duty("2027-01-02"),
        duty("2027-01-03"),
        duty("2027-01-05", "EARLY"),
        duty("2027-01-07", "LATE"),
      ],
    };
    const preferences = prefs({ MONTHLY_ALLOWANCE: 2 });
    const actual = salaryPaymentInput("2027-03", forecastProfile, input, preferences, "PAYOUT");
    const earned = salaryMonthInput("2027-01", forecastProfile, input).pay;
    expect(earned.allowanceAmount).toBeGreaterThan(0);
    expect(actual.pay.allowanceAmount).toBe(earned.allowanceAmount);
    expect(actual.sources.find((source) => source.month === "2027-01")?.pay.assessment).toEqual(
      earned.assessment,
    );
    const changed = {
      ...input,
      entries: input.entries.map((shift) =>
        shift.date === "2026-12-20" ? { ...shift, startTime: "08:00", endTime: "16:00" } : shift,
      ),
    };
    expect(
      salaryPaymentInput("2027-03", forecastProfile, changed, preferences, "PAYOUT").pay
        .allowanceAmount,
    ).not.toBe(actual.pay.allowanceAmount);
    const decision = {
      month: "2027-01",
      allowanceStatus: "NONE" as const,
      confirmedAt: forecastProfile.updatedAt,
      note: null,
      revision: 1,
      createdAt: forecastProfile.createdAt,
      updatedAt: forecastProfile.updatedAt,
    };
    expect(
      salaryPaymentInput(
        "2027-03",
        forecastProfile,
        { ...input, tariffDecisions: [decision] },
        preferences,
        "PAYOUT",
      ).pay.allowanceAmount,
    ).toBe(0);
  });

  it("does not infer a monthly entitlement from an empty month", () => {
    const actual = salaryPaymentInput(
      "2026-10",
      forecastProfile,
      context,
      prefs({ MONTHLY_ALLOWANCE: 1 }),
      "PAYOUT",
    );
    expect(actual.pay.allowanceAmount).toBe(0);
    expect(actual.available).toBe(false);
    expect(actual.issues).toContainEqual(
      expect.objectContaining({
        kind: "MISSING_MONTH",
        month: "2026-09",
        group: "MONTHLY_ALLOWANCE",
      }),
    );
    const decision = {
      month: "2026-09",
      allowanceStatus: "SHIFT_MONTHLY" as const,
      confirmedAt: forecastProfile.updatedAt,
      note: null,
      revision: 1,
      createdAt: forecastProfile.createdAt,
      updatedAt: forecastProfile.updatedAt,
    };
    const confirmed = salaryPaymentInput(
      "2026-10",
      forecastProfile,
      { ...context, tariffDecisions: [decision] },
      prefs({ MONTHLY_ALLOWANCE: 1 }),
      "PAYOUT",
    );
    expect(confirmed.available).toBe(true);
    expect(confirmed.pay.allowanceAmount).toBeGreaterThan(0);
  });

  it("excludes active test months from actual claims and their assessment dependencies", () => {
    const entries = [
      duty("2026-12-20"),
      duty("2027-01-02"),
      duty("2027-01-03"),
      duty("2027-01-05", "EARLY"),
      duty("2027-01-07", "LATE"),
    ];
    const preferences = prefs({ MONTHLY_ALLOWANCE: 2 });
    const actual = salaryPaymentInput(
      "2027-03",
      forecastProfile,
      { ...context, entries, testMonths: ["2026-12"] },
      preferences,
      "PAYOUT",
    );
    expect(actual.sources.find((source) => source.month === "2027-01")?.pay).toEqual(
      salaryMonthInput("2027-01", forecastProfile, { ...context, entries: entries.slice(1) }).pay,
    );
    const selected = salaryPaymentInput(
      "2027-03",
      forecastProfile,
      { ...context, entries, testMonths: ["2027-01"] },
      preferences,
      "PAYOUT",
    );
    expect(selected.available).toBe(false);
    expect(selected.pay.estimatedGrossAmount).toBeNull();
    expect(selected.issues).toContainEqual(
      expect.objectContaining({ kind: "UNAVAILABLE", month: "2027-01" }),
    );
  });

  it.each(["PAYOUT", "EARNED"] as const)(
    "preserves legacy payout while keeping an empty earned tariff month unresolved (%s)",
    (perspective) => {
      const actual = salaryPaymentInput("2026-10", forecastProfile, context, prefs(), perspective);
      if (perspective === "PAYOUT") {
        expect(actual.pay).toEqual(salaryMonthInput("2026-10", forecastProfile, context).pay);
        expect(actual.available).toBe(true);
        return;
      }
      expect(actual.available).toBe(false);
      expect(actual.pay.estimatedGrossAmount).toBeNull();
      expect(actual.issues).toContainEqual(
        expect.objectContaining({
          kind: "MISSING_MONTH",
          month: "2026-10",
          group: "MONTHLY_ALLOWANCE",
        }),
      );
      const reviewed = salaryPaymentInput(
        "2026-10",
        forecastProfile,
        context,
        { ...prefs(), reviewedEmptyMonths: ["2026-10"] },
        perspective,
      );
      expect(reviewed.available).toBe(true);
      expect(reviewed.pay.allowanceAmount).toBe(0);
    },
  );

  it("keeps manual fixed pay independent of empty tariff evidence", () => {
    const profile = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400_000 };
    const actual = salaryPaymentInput("2026-10", profile, context, prefs(), "EARNED");
    expect(actual.available).toBe(true);
    expect(actual.pay.estimatedGrossAmount).toBe(4000);
  });

  it("blocks a detected allowance pattern with missing required assignment facts", () => {
    const entries = [
      duty("2026-07-02"),
      duty("2026-07-04", "EARLY"),
      duty("2026-07-06", "LATE"),
      duty("2026-07-23"),
      duty("2026-07-24"),
    ];
    const actual = salaryPaymentInput(
      "2026-07",
      forecastProfile,
      {
        ...context,
        entries,
        workPatternSettings: { ...context.workPatternSettings, assignment: "UNKNOWN" },
      },
      prefs(),
      "EARNED",
    );
    expect(actual.sources[0].pay.assessment.requiresConfirmation).toBe(true);
    expect(actual.pay.allowanceAmount).toBe(0);
    expect(actual.available).toBe(false);
    expect(actual.issues).toContainEqual(
      expect.objectContaining({
        kind: "UNAVAILABLE",
        month: "2026-07",
        group: "MONTHLY_ALLOWANCE",
      }),
    );
  });

  it("retains daytime no-allowance estimates and provisional absence continuation", () => {
    const daytime = salaryPaymentInput(
      "2026-07",
      forecastProfile,
      { ...context, entries: [duty("2026-07-03", "EARLY")] },
      prefs(),
      "EARNED",
    );
    expect(daytime.available).toBe(true);
    expect(daytime.pay.allowanceAmount).toBe(0);
    const entries = [
      duty("2026-07-02"),
      duty("2026-07-04", "EARLY"),
      duty("2026-07-06", "LATE"),
      duty("2026-07-23"),
      duty("2026-07-24"),
      forecastShift({
        date: "2026-08-03",
        type: "VACATION",
        startTime: null,
        endTime: null,
        allDay: true,
      }),
    ];
    const absence = salaryPaymentInput(
      "2026-08",
      forecastProfile,
      { ...context, entries },
      prefs(),
      "EARNED",
    );
    expect(absence.available).toBe(true);
    expect(absence.pay.allowanceAmount).toBeGreaterThan(0);
    expect(absence.warnings.some((warning) => /Fortzahlung nicht bestätigt/.test(warning))).toBe(
      true,
    );
  });

  it.each(["PAYOUT", "EARNED"] as const)(
    "shows pure manual fixed pay in %s without configuring variable payment timing",
    (perspective) => {
      const profile = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400_000 };
      const actual = salaryPaymentInput(
        "2026-10",
        profile,
        context,
        DEFAULT_SALARY_PAYMENT_PREFERENCES,
        perspective,
      );
      expect(actual.available).toBe(true);
      expect(actual.pay.estimatedGrossAmount).toBe(4000);
      expect(actual.sources.map((source) => source.month)).toEqual(["2026-10"]);
      expect(actual.issues).toEqual([]);
      expect(DEFAULT_SALARY_PAYMENT_PREFERENCES.periods).toEqual([]);
    },
  );

  it("keeps old tariff months unresolved after switching to manual fixed pay", () => {
    const manual = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400_000 };
    const now = forecastProfile.createdAt;
    const profile: UserProfile = {
      ...manual,
      employmentTimeline: [
        {
          effectiveFrom: null,
          data: remunerationDataFromLegacy(forecastProfile),
          employment: employmentDataFromProfile(forecastProfile),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          effectiveFrom: "2026-10-01",
          data: remunerationDataFromLegacy(manual),
          employment: employmentDataFromProfile(manual),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const actual = salaryPaymentInput("2026-10", profile, context, unknownPrefs(), "PAYOUT");
    expect(actual.available).toBe(false);
    expect(actual.pay.personalBaseAmount).toBe(4000);
    expect(actual.issues).toContainEqual(
      expect.objectContaining({ kind: "UNCONFIGURED", month: "2026-08" }),
    );
    expect(actual.issues).toContainEqual(
      expect.objectContaining({ kind: "UNCONFIGURED", month: "2026-09" }),
    );
    expect(actual.issues.some((issue) => issue.month === "2026-10")).toBe(false);
  });

  it("does not infer a manual profile before its recorded history begins", () => {
    const manual = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400_000 };
    const now = forecastProfile.createdAt;
    const profile: UserProfile = {
      ...manual,
      employmentTimeline: [
        {
          effectiveFrom: "2026-10-01",
          data: remunerationDataFromLegacy(manual),
          employment: employmentDataFromProfile(manual),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const actual = salaryPaymentInput("2026-10", profile, context, unknownPrefs(), "PAYOUT");
    expect(actual.available).toBe(false);
    expect(actual.issues).toContainEqual(
      expect.objectContaining({ kind: "UNCONFIGURED", month: "2026-08" }),
    );
  });

  it("retains a tariff portion before a mid-month switch, including its configured delayed claims", () => {
    const manual = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400_000 };
    const now = forecastProfile.createdAt;
    const profile: UserProfile = {
      ...manual,
      employmentTimeline: [
        {
          effectiveFrom: null,
          data: remunerationDataFromLegacy(forecastProfile),
          employment: employmentDataFromProfile(forecastProfile),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          effectiveFrom: "2026-08-15",
          data: remunerationDataFromLegacy(manual),
          employment: employmentDataFromProfile(manual),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const input = { ...context, entries: [duty("2026-08-05")] };
    const unresolved = salaryPaymentInput("2026-10", profile, input, unknownPrefs(), "PAYOUT");
    expect(unresolved.issues).toContainEqual(
      expect.objectContaining({ kind: "UNCONFIGURED", month: "2026-08" }),
    );
    expect(unresolved.issues.some((issue) => issue.month === "2026-09")).toBe(false);
    const configured = salaryPaymentInput(
      "2026-10",
      profile,
      input,
      prefs({ PREMIUMS: 2 }),
      "PAYOUT",
    );
    expect(configured.pay.timePremiumAmount).toBe(
      salaryMonthInput("2026-08", profile, input).pay.timePremiumAmount,
    );
    expect(configured.pay.timePremiumAmount).toBeGreaterThan(0);
    expect(configured.sources.some((source) => source.month === "2026-08")).toBe(true);
  });

  it.each([false, true])(
    "propagates current rule errors through normal and manual prechecks (manual=%s)",
    (manual) => {
      const cause = ruleFailure();
      failMonth("2026-10", cause);
      const profile = manual
        ? { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400_000 }
        : forecastProfile;
      expect(() => salaryPaymentInput("2026-10", profile, context, prefs(), "PAYOUT")).toThrow(
        cause,
      );
      expect(() =>
        finish(salaryPaymentInputSteps("2026-10", profile, context, prefs(), "PAYOUT")),
      ).toThrow(cause);
    },
  );

  it("retains an unavailable historical rule source without hiding current components", () => {
    failMonth("2026-08", ruleFailure());
    const input = { ...context, entries: [duty("2026-10-05", "EARLY")] };
    const actual = salaryPaymentInput(
      "2026-10",
      forecastProfile,
      input,
      prefs({ PREMIUMS: 2 }),
      "PAYOUT",
    );
    expect(actual.available).toBe(false);
    expect(actual.pay.estimatedGrossAmount).toBeNull();
    expect(actual.pay.personalBaseAmount).toBeGreaterThan(0);
    expect(actual.issues).toContainEqual(
      expect.objectContaining({ kind: "UNAVAILABLE", month: "2026-08", group: "PREMIUMS" }),
    );
    expect(actual.sources.find((source) => source.month === "2026-08")?.pay.available).toBe(false);
  });

  it.each(["2026-10", "2026-08"])(
    "propagates unexpected calculation errors from source %s",
    (month) => {
      const cause = new Error("Unexpected calculation defect");
      failMonth(month, cause);
      expect(() =>
        salaryPaymentInput("2026-10", forecastProfile, context, prefs({ PREMIUMS: 2 }), "PAYOUT"),
      ).toThrow(cause);
    },
  );
});
