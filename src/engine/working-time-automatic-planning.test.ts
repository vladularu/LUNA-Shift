import { describe, expect, it } from "vitest";
import type { UserProfile } from "@/domain/types";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { calculateMonthlyWorkingTimeTarget } from "./working-time-target";
import { calculateMonthlySummary } from "./monthly-summary";
import { work, shift } from "./remuneration-test-fixtures";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";

const profile: UserProfile = { ...work, federalState: "HE", sundayHolidayWorkEligible: true };
const snapshot = (context = decemberTargetContext): WorkingTimeTargetSnapshot => ({
  saved: null,
  context,
  staleDates: [],
  planRevision: "plan",
});
const projected = (
  p = profile,
  state: WorkingTimeTargetSnapshot | null = null,
  entries: Parameters<typeof createWorkingTimeCalculationProfile>[4] = [],
) => createWorkingTimeCalculationProfile(p, state, [], "ready", entries);
const result = (p = projected()) => calculateMonthlyWorkingTimeTarget("2026-12", p);
const duty = (day: number) =>
  shift({
    id: String(day),
    date: `2026-12-${day}`,
    type: "DAY",
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 0,
  });

describe("contractual target forecast, independent of recorded duties", () => {
  // External reference supplied by the user: ATOSS 146:18. Gregorian calendar:
  // 23 weekdays x 462 - Dec24/25/26/31 reference days. Projection, not proof of individual claims.
  it("uses existing Sunday/holiday information without requiring a model confirmation", () => {
    const p = projected();
    expect(p.workingTimeTarget?.context?.periods[0].model).toMatchObject({
      kind: "ROTATING_FIVE_IN_SEVEN",
      sevenDayShiftPlanConfirmed: null,
    });
    expect(result(p)).toMatchObject({
      baseMinutes: 10626,
      targetMinutes: 8778,
      status: "PROVISIONAL",
    });
    expect(p.workingTimeTarget?.context?.days).toEqual([]);
    expect(profile).not.toHaveProperty("workingTimeTarget");
  });
  it.each(
    [
      [],
      [duty(24)],
      [duty(31)],
      [duty(24), duty(25), duty(26), duty(31)],
      [{ ...duty(24), type: "FREE" as const, startTime: null, endTime: null }],
      [
        duty(24),
        { ...duty(24), id: "free", type: "FREE" as const, startTime: null, endTime: null },
      ],
    ].map((entries) => ({ entries })),
  )("keeps 146:18 for any recorded roster: %#", ({ entries }) => {
    const p = projected(profile, null, entries);
    expect(result(p).targetMinutes).toBe(8778);
    expect(result(p).adjustments.map((a) => [a.date, a.minutes])).toEqual([
      ["2026-12-24", 462],
      ["2026-12-25", 462],
      ["2026-12-26", 462],
      ["2026-12-31", 462],
    ]);
    expect(result(p).adjustments.every((a) => a.status === "PROFILE_ESTIMATE")).toBe(true);
    expect(result(p).notices.some((n) => n.code.includes("CONFLICTING_TARGET_PLAN"))).toBe(false);
  });
  it("ignores legacy day confirmations for the forecast without deleting them", () => {
    const context = {
      ...decemberTargetContext,
      days: decemberTargetContext.days.map((day) => ({
        ...day,
        rosterStatus: "FINAL" as const,
        disposition: "WORK_REQUIRED" as const,
      })),
    };
    const saved = snapshot(context),
      before = JSON.stringify(saved);
    expect(result(projected(profile, saved, [duty(24), duty(31)])).targetMinutes).toBe(8778);
    expect(JSON.stringify(saved)).toBe(before);
  });
  it("keeps the strict roster-based legal calculation separate", () => {
    const context = {
      ...decemberTargetContext,
      days: decemberTargetContext.days.map((day) =>
        day.date === "2026-12-24" ? { ...day, lostMinutes: 600 } : day,
      ),
    };
    expect(calculateMonthlyWorkingTimeTarget("2026-12", profile, undefined, context)).toMatchObject(
      { targetMinutes: 8640, status: "FINAL" },
    );
    expect(result(projected(profile, snapshot(context)))).toMatchObject({
      targetMinutes: 8778,
      status: "PROVISIONAL",
    });
  });
  it("does not create actual work or compensation credits", () => {
    const entries = [duty(24), duty(31)];
    const p = projected(profile, null, entries);
    expect(calculateMonthlySummary("2026-12", [], p).actualMinutes).toBe(0);
    expect(calculateMonthlySummary("2026-12", entries, p).actualMinutes).toBe(960);
    expect(calculateMonthlySummary("2026-12", entries, p).actualMinutes).toBe(
      calculateMonthlySummary("2026-12", entries, profile).actualMinutes,
    );
  });
  it("also infers a seven-day forecast when an old period has no distribution", () => {
    const context = {
      periods: [{ ...decemberTargetContext.periods[0], model: { kind: "UNKNOWN" as const } }],
      days: [],
    };
    expect(result(projected(profile, snapshot(context))).targetMinutes).toBe(8778);
    expect(context.periods[0].model.kind).toBe("UNKNOWN");
  });
  it("preserves an explicit fixed Monday-Friday distribution", () => {
    const context = {
      periods: [
        {
          ...decemberTargetContext.periods[0],
          model: {
            kind: "FIXED_WEEK" as const,
            weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] as const,
          },
        },
      ],
      days: [],
    };
    expect(
      result(projected(profile, snapshot(context), [duty(24), duty(25), duty(31)])).targetMinutes,
    ).toBe(9240); // 23 weekdays minus 24/25/31; no Saturday fifth.
  });
  it("does not infer seven-day work without an existing profile signal", () => {
    expect(result(projected({ ...profile, sundayHolidayWorkEligible: null })).targetMinutes).toBe(
      10164,
    );
  });
  it("uses a five-day Monday-Friday forecast when Sunday/holiday work is explicitly absent", () => {
    const p = projected({ ...profile, sundayHolidayWorkEligible: false });
    expect(p.workingTimeTarget?.context?.periods[0].model).toMatchObject({
      kind: "FIXED_WEEK",
      weekdayMinutes: [462, 462, 462, 462, 462, 0, 0],
    });
    expect(result(p).targetMinutes).toBe(9240); // 154:00: 23 weekdays minus Dec24/25/31; Saturday adds no deduction.
    expect(result(p).adjustments.map((line) => line.date)).toEqual([
      "2026-12-24",
      "2026-12-25",
      "2026-12-31",
    ]);
    expect(calculateMonthlyWorkingTimeTarget("2026-10", p).targetMinutes).toBe(10164); // 22 weekdays, Oct3 is Saturday.
  });
  it("lets an explicit historical rotating model win over today's five-day default", () => {
    expect(
      result(projected({ ...profile, sundayHolidayWorkEligible: false }, snapshot())).targetMinutes,
    ).toBe(8778);
  });
  it("does not require night work for a seven-day forecast", () => {
    expect(result(projected({ ...profile, regularRotatingNightWork: false })).targetMinutes).toBe(
      8778,
    );
  });
  it("uses part-time hours, normal months and Saturday holidays", () => {
    expect(result(projected({ ...profile, weeklyMinutes: 1200 })).targetMinutes).toBe(4560);
    expect(calculateMonthlyWorkingTimeTarget("2026-07", projected()).targetMinutes).toBe(10626);
    expect(calculateMonthlyWorkingTimeTarget("2026-10", projected()).targetMinutes).toBe(9702);
  });
  it("uses workplace holidays and never adds a Sunday fifth", () => {
    expect(calculateMonthlyWorkingTimeTarget("2026-06", projected()).targetMinutes).toBe(9702);
    expect(
      calculateMonthlyWorkingTimeTarget("2026-06", projected({ ...profile, federalState: "BE" }))
        .targetMinutes,
    ).toBe(10164);
    expect(
      calculateMonthlyWorkingTimeTarget("2026-11", projected({ ...profile, federalState: "NW" }))
        .targetMinutes,
    ).toBe(9702);
  });
  it("does not transfer BT-K claims to other families or unreviewed years", () => {
    const other = {
      ...profile,
      tariff: profile.tariff ? { ...profile.tariff, sector: "BT_B" as const } : null,
    };
    expect(result(projected(other)).targetMinutes).toBe(10164);
    expect(result(projected(other)).adjustments.some((a) => a.ruleId.startsWith("tvoed-k"))).toBe(
      false,
    );
    expect(
      calculateMonthlyWorkingTimeTarget("2028-12", projected()).adjustments.some(
        (a) => a.status === "PROFILE_ESTIMATE",
      ),
    ).toBe(false);
  });
  it("keeps missing regional support or historical gaps unavailable", () => {
    expect(
      calculateMonthlyWorkingTimeTarget(
        "2026-11",
        projected({ ...profile, federalState: "BY", holidayRegion: "NONE" }),
      ).targetMinutes,
    ).toBeNull();
    expect(
      calculateMonthlyWorkingTimeTarget("2026-11", projected(profile, snapshot())).targetMinutes,
    ).toBeNull();
  });
});
