import { describe, expect, it } from "vitest";

import holidayCandidateValue from "../../rules/packages/reviewed/de-holidays/2026.json";
import type { TargetProfilePeriod, WorkingTimeTargetContext } from "@/domain/working-time-target";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import { calculateMonthlySummary, calculateMonthlyTargetMinutes } from "@/engine/monthly-summary";
import { calculateDailyTargetMinutes } from "@/engine/daily-summary";
import { getPublicHolidays } from "@/engine/holidays";
import { bundledRuleResolver, createRuleResolver } from "@/rules/rule-resolver";
import type { RuleHolidayPackage } from "@/rules/contracts.generated";

const profile = { federalState: "HE", weeklyMinutes: 2310, timeZone: "Europe/Berlin" } as const;
const period: TargetProfilePeriod = {
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
  tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true },
};
function context(overrides: Partial<WorkingTimeTargetContext> = {}): WorkingTimeTargetContext {
  return {
    periods: [period],
    days: [24, 25, 26, 31].map((day) => ({
      date: `2026-12-${day}`,
      rosterStatus: "FINAL",
      disposition: "ROSTER_FREE",
      lostMinutes: 462,
      mustWorkElsewhere: true,
    })),
    ...overrides,
  };
}
const calculate = (month = "2026-12", input = context()) =>
  calculateMonthlyWorkingTimeTarget(month, profile, bundledRuleResolver, input);

describe("tariff-dependent target time (source references in docs/working-time-target-sources.md)", () => {
  it("reproduces the explicitly qualified ATOSS reference, without duplicate weekday relief", () => {
    const result = calculate();
    expect(result.status).toBe("FINAL");
    expect(result.baseMinutes).toBe(10626); // 23 * 462 = 177:06
    expect(result.statutoryReductionMinutes).toBe(924);
    expect(result.tariffReductionMinutes).toBe(924);
    expect(result.targetMinutes).toBe(8778); // 146:18
    expect(result.adjustments.map((line) => [line.date, line.minutes])).toEqual([
      ["2026-12-24", 462],
      ["2026-12-25", 462],
      ["2026-12-26", 462],
      ["2026-12-31", 462],
    ]);
    for (const line of result.adjustments) {
      expect(line.status).toBe("CONFIRMED");
      expect(line.ruleId).not.toBe("");
      expect(line.legalBasis).not.toBe("");
      expect(line.condition).not.toBe("");
    }
  });

  it("keeps fixed Monday-Friday and rotating five-day distribution distinct", () => {
    const result = calculate(
      "2026-12",
      context({
        periods: [
          {
            ...period,
            model: { kind: "FIXED_WEEK", weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] },
          },
        ],
        days: context().days.map((day) => ({ ...day, disposition: "RELEASED" })),
      }),
    );
    expect(result.targetMinutes).toBe(9240); // 154:00, Saturday does not remove a fixed workday
    expect(result.adjustments.some((line) => line.date === "2026-12-26")).toBe(false);
  });

  it.each(["WORK_REQUIRED", "ROSTER_FREE"] as const)(
    "reduces Saturday for confirmed %s under BT-K §49(2)",
    (disposition) => {
      const input = context({
        days: [{ date: "2026-10-03", rosterStatus: "FINAL", disposition, mustWorkElsewhere: true }],
      });
      expect(calculate("2026-10", input).targetMinutes).toBe(9702); // 22 * 462 - 462
    },
  );

  it("does not derive roster-free eligibility from an empty or draft calendar", () => {
    for (const days of [
      [],
      [
        {
          date: "2026-10-03",
          rosterStatus: "DRAFT",
          disposition: "ROSTER_FREE",
          mustWorkElsewhere: true,
        },
      ] as const,
      [
        {
          date: "2026-10-03",
          rosterStatus: "FINAL",
          disposition: "ROSTER_FREE",
          mustWorkElsewhere: null,
        },
      ] as const,
    ]) {
      const result = calculate("2026-10", context({ days }));
      expect(result.status).toBe("PROVISIONAL");
      expect(result.targetMinutes).toBe(10164);
      expect(result.adjustments[0].status).toBe("PENDING");
      expect(result.adjustments[0].minutes).toBe(0);
    }
  });

  it("does not reduce a Sunday holiday under BT-K §49(2)", () => {
    const result = calculate(
      "2026-11",
      context({ periods: [{ ...period, federalState: "NW" }], days: [] }),
    );
    expect(result.targetMinutes).toBe(9702); // 21 weekdays; All Saints is Sunday
    expect(result.status).toBe("FINAL");
  });

  it("keeps work on Christmas Eve/New Year's Eve separate from target reduction and compensatory leave", () => {
    const input = context({
      days: context().days.map((day) =>
        ["2026-12-24", "2026-12-31"].includes(day.date)
          ? { ...day, disposition: "WORK_REQUIRED" }
          : day,
      ),
    });
    const result = calculate("2026-12", input);
    expect(result.targetMinutes).toBe(9702);
    expect(result.tariffReductionMinutes).toBe(0);
    expect(
      result.notices.filter((notice) => notice.code === "COMPENSATORY_LEAVE_SEPARATE"),
    ).toHaveLength(2);
  });

  it("uses confirmed lost hours for special days, including a partial release", () => {
    const input = context({
      days: context().days.map((day) =>
        day.date === "2026-12-24" ? { ...day, disposition: "RELEASED", lostMinutes: 231 } : day,
      ),
    });
    expect(calculate("2026-12", input).targetMinutes).toBe(9009);
  });

  it("scales the one-fifth rule with individual part-time hours", () => {
    const input = context({
      periods: [{ ...period, weeklyMinutes: 1155 }],
      days: context().days.map((day) => ({ ...day, lostMinutes: 231 })),
    });
    expect(calculate("2026-12", input).targetMinutes).toBe(4389); // 73:09
  });

  it("uses historical tariff and hours on each date, never the current profile", () => {
    const input = context({
      periods: [
        { ...period, validTo: "2026-12-15" },
        { ...period, validFrom: "2026-12-16", weeklyMinutes: 1155, tariff: { kind: "CUSTOM" } },
      ],
    });
    const result = calculate("2026-12", input);
    expect(result.baseMinutes).toBe(7854); // 11*462 + 12*231
    expect(result.targetMinutes).toBe(7623); // only fixed reference relief on Dec 25, no invented custom claims
    expect(result.tariffReductionMinutes).toBe(0);
  });

  it("uses the historical state/holiday region", () => {
    const fixed = { kind: "FIXED_WEEK", weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] } as const;
    const he = calculate(
      "2026-06",
      context({ periods: [{ ...period, model: fixed, tariff: { kind: "CUSTOM" } }], days: [] }),
    );
    const hh = calculate(
      "2026-06",
      context({
        periods: [{ ...period, federalState: "HH", model: fixed, tariff: { kind: "CUSTOM" } }],
        days: [],
      }),
    );
    expect(he.targetMinutes).toBe(9702); // Corpus Christi: June 4
    expect(hh.targetMinutes).toBe(10164);
  });

  it("uses a changed municipality on the holiday date rather than today's region", () => {
    const resolver = createRuleResolver(
      { tariff: [], legal: [], holiday: [holidayCandidateValue as RuleHolidayPackage] },
      { tariff: "unused", legal: "unused", holiday: "de-holidays" },
    );
    const fixed = { kind: "FIXED_WEEK", weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] } as const;
    const local = {
      ...period,
      federalState: "SN",
      holidayRegion: "SN_FRONLEICHNAM",
      model: fixed,
      tariff: { kind: "CUSTOM" },
    } as const;
    const without = { ...local, holidayRegion: "NONE" } as const;
    const beforeInput = context({
      periods: [
        { ...without, validTo: "2026-06-03" },
        { ...local, validFrom: "2026-06-04" },
      ],
      days: [],
    });
    const afterInput = context({
      periods: [
        { ...local, validTo: "2026-06-03" },
        { ...without, validFrom: "2026-06-04" },
      ],
      days: [],
    });
    const before = calculateMonthlyWorkingTimeTarget("2026-06", profile, resolver, beforeInput);
    const after = calculateMonthlyWorkingTimeTarget("2026-06", profile, resolver, afterInput);
    expect(before.targetMinutes).toBe(9702);
    expect(after.targetMinutes).toBe(10164);
    expect(calculate("2026-06", beforeInput).targetMinutes).toBeNull();
    expect(
      calculate("2026-06", beforeInput).notices.some(
        (notice) => notice.code === "HOLIDAY_REGION_UNSUPPORTED",
      ),
    ).toBe(true);
    const unknown = { ...local, holidayRegion: "UNKNOWN" } as const;
    expect(
      calculateMonthlyWorkingTimeTarget(
        "2026-06",
        profile,
        resolver,
        context({ periods: [unknown] }),
      ).notices.some((notice) => notice.code === "HOLIDAY_REGION_UNKNOWN"),
    ).toBe(true);
  });

  it("rejects an impossible negative partial-month reference instead of clamping it", () => {
    const result = calculate(
      "2026-10",
      context({
        employment: { from: "2026-10-03", to: "2026-10-03" },
        days: [{ date: "2026-10-03", disposition: "WORK_REQUIRED", rosterStatus: "FINAL" }],
      }),
    );
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.targetMinutes).toBeNull();
    expect(result.notices.some((notice) => notice.code === "NEGATIVE_MONTH_TARGET")).toBe(true);
  });

  it("handles a normal month and explicit employment boundaries", () => {
    expect(calculate("2026-07", context({ days: [] })).targetMinutes).toBe(10626);
    const result = calculate(
      "2026-07",
      context({ days: [], employment: { from: "2026-07-13", to: "2026-07-17" } }),
    );
    expect(result.targetMinutes).toBe(2310);
  });

  it("does not borrow the current profile across a gap in history", () => {
    const result = calculate(
      "2026-07",
      context({ periods: [{ ...period, validFrom: "2026-07-10" }] }),
    );
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.targetMinutes).toBeNull();
    expect(() =>
      calculateMonthlyTargetMinutes(
        "2026-07",
        profile,
        bundledRuleResolver,
        context({ periods: [] }),
      ),
    ).toThrow();
  });

  it.each([null, false])(
    "requires confirmed scope and a seven-day shift plan (%s)",
    (confirmed) => {
      const input = context({
        periods: [
          {
            ...period,
            tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: confirmed },
          },
        ],
      });
      expect(calculate("2026-12", input).status).toBe("PROVISIONAL");
      expect(calculate("2026-12", input).tariffReductionMinutes).toBe(0);
      const noPlan = context({
        periods: [
          {
            ...period,
            model: {
              kind: "ROTATING_FIVE_IN_SEVEN",
              monthlyReference: "WEEKDAYS_ONE_FIFTH",
              sevenDayShiftPlanConfirmed: confirmed,
            },
          },
        ],
      });
      expect(calculate("2026-12", noPlan).statutoryReductionMinutes).toBe(0);
    },
  );

  it("does not carry an unreviewed tariff version across the year boundary", () => {
    const result = calculate(
      "2027-01",
      context({
        days: [{ date: "2027-01-01", rosterStatus: "FINAL", disposition: "WORK_REQUIRED" }],
      }),
    );
    expect(result.status).toBe("PROVISIONAL");
    expect(result.notices.some((notice) => notice.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
  });

  it("rejects ambiguous histories, duplicate day facts and inconsistent fixed distributions", () => {
    expect(() => calculate("2026-12", context({ periods: [period, period] }))).toThrow();
    expect(() =>
      calculate("2026-12", context({ days: [context().days[0], context().days[0]] })),
    ).toThrow();
    expect(() =>
      calculate(
        "2026-12",
        context({
          periods: [
            { ...period, model: { kind: "FIXED_WEEK", weekdayMinutes: [1, 0, 0, 0, 0, 0, 0] } },
          ],
        }),
      ),
    ).toThrow();
  });

  it("provides one target through both existing monthly APIs without generating actual work", () => {
    const input = context();
    const summary = calculateMonthlySummary("2026-12", [], profile, bundledRuleResolver, input);
    expect(summary.targetMinutes).toBe(8778);
    expect(summary.actualMinutes).toBe(0);
    expect(summary.balanceMinutes).toBe(-8778);
    expect(summary.targetCalculation?.targetMinutes).toBe(8778);
    expect(calculateMonthlyTargetMinutes("2026-12", profile, bundledRuleResolver, input)).toBe(
      8778,
    );
    expect(
      Array.from({ length: 31 }, (_, i) =>
        calculateDailyTargetMinutes(
          `2026-12-${String(i + 1).padStart(2, "0")}`,
          profile,
          bundledRuleResolver,
          input,
        ),
      ).reduce((a, b) => a + b, 0),
    ).toBe(8778);
  });

  it("keeps legacy monthly values and marks missing eligibility as provisional", () => {
    expect(calculateMonthlyTargetMinutes("2026-12", profile)).toBe(10164); // 169:24
    expect(calculateMonthlyWorkingTimeTarget("2026-12", profile).status).toBe("PROVISIONAL");
    expect(calculateMonthlySummary("2026-12", [], profile).actualMinutes).toBe(0);
  });

  it("rounds once over exact one-fifth numerators, with a reconciled integer-minute ledger", () => {
    const odd = { ...profile, weeklyMinutes: 1001 };
    const result = calculateMonthlyWorkingTimeTarget("2026-12", odd);
    expect(result.targetMinutes).toBe(4404); // round(22*1001/5), not 22*round(1001/5)
    expect(result.days.reduce((sum, day) => sum + day.targetMinutes!, 0)).toBe(4404);
    expect(
      result.baseMinutes -
        result.statutoryReductionMinutes -
        result.tariffReductionMinutes +
        result.roundingMinutes,
    ).toBe(4404);
  });

  it("uses a nonuniform fixed contractual week instead of one fifth for every weekday", () => {
    const input = context({
      periods: [
        {
          ...period,
          model: { kind: "FIXED_WEEK", weekdayMinutes: [600, 480, 360, 600, 270, 0, 0] },
        },
      ],
      days: [24, 31].map((day) => ({
        date: `2026-12-${day}`,
        rosterStatus: "FINAL",
        disposition: "RELEASED",
        lostMinutes: 600,
      })),
    });
    const result = calculate("2026-12", input);
    expect(result.baseMinutes).toBe(10680);
    expect(result.statutoryReductionMinutes).toBe(270);
    expect(result.tariffReductionMinutes).toBe(1200);
    expect(result.targetMinutes).toBe(9210);
  });

  it("does not call Christmas Eve and New Year's Eve statutory holidays", () => {
    const dates = getPublicHolidays(2026, "HE").map((day) => day.date);
    expect(dates).not.toContain("2026-12-24");
    expect(dates).not.toContain("2026-12-31");
    expect(
      calculate().adjustments.filter((line) => line.kind === "TARIFF_SPECIAL_DAY"),
    ).toHaveLength(2);
  });

  it("does not treat explicitly roster-free fixed-week days as holiday-caused lost work", () => {
    const input = context({
      periods: [
        {
          ...period,
          tariff: { kind: "CUSTOM" },
          model: { kind: "FIXED_WEEK", weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] },
        },
      ],
      days: [
        {
          date: "2026-12-25",
          rosterStatus: "FINAL",
          disposition: "ROSTER_FREE",
          mustWorkElsewhere: true,
        },
      ],
    });
    const result = calculate("2026-12", input);
    expect(result.status).toBe("PROVISIONAL");
    expect(result.targetMinutes).toBe(10626);
    expect(result.adjustments[0].status).toBe("PENDING");
  });

  it("does not substitute the TVöD-K rule for another salary tariff", () => {
    for (const id of [
      "tvoed-b",
      "tvoed-vka-e",
      "tvl-kr",
      "tvh-kr",
      "tvuk-nursing",
      "tvaoed-pflege",
      "tval-pflege",
      "avr-caritas",
      "drk",
    ]) {
      const input = context({ periods: [{ ...period, tariff: { kind: "UNVERIFIED", id } }] });
      const result = calculate("2026-12", input);
      expect(result.status).toBe("PROVISIONAL");
      expect(result.tariffReductionMinutes).toBe(0);
      expect(result.adjustments.some((line) => line.ruleId.includes("tvoed-k"))).toBe(false);
    }
  });

  it("does not apply an explicitly ineligible roster-free Saturday reduction", () => {
    const result = calculate(
      "2026-10",
      context({
        days: [
          {
            date: "2026-10-03",
            rosterStatus: "FINAL",
            disposition: "ROSTER_FREE",
            mustWorkElsewhere: false,
          },
        ],
      }),
    );
    expect(result.targetMinutes).toBe(10164);
    expect(result.status).toBe("FINAL");
  });

  it.each(["2026-13", "2026-7", "2026-07-01", "invalid"])("rejects invalid month %s", (month) => {
    expect(() => calculate(month)).toThrow();
  });

  it("rejects invalid or contradictory input rather than silently falling back", () => {
    for (const weeklyMinutes of [-1, 1.5, NaN, 10081]) {
      expect(() =>
        calculate("2026-07", context({ periods: [{ ...period, weeklyMinutes }] })),
      ).toThrow();
    }
    expect(() =>
      calculate("2026-07", context({ periods: [{ ...period, validFrom: "2026-02-30" }] })),
    ).toThrow();
    expect(() =>
      calculate("2026-07", context({ periods: [{ ...period, validTo: "2025-12-31" }] })),
    ).toThrow();
    expect(() =>
      calculate("2026-07", context({ employment: { from: "2026-07-02", to: "2026-07-01" } })),
    ).toThrow();
    expect(() =>
      calculate(
        "2026-07",
        context({
          days: [
            {
              date: "2026-07-01",
              disposition: "RELEASED",
              rosterStatus: "FINAL",
              lostMinutes: 1500,
            },
          ],
        }),
      ),
    ).toThrow();
  });
});
