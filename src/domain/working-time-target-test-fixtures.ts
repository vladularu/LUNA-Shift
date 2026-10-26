import type { WorkingTimeTargetContext } from "./working-time-target";

export const decemberTargetContext: WorkingTimeTargetContext = {
  periods: [
    {
      validFrom: "2026-12-01",
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
    },
  ],
  days: [24, 25, 26, 31].map((day) => ({
    date: `2026-12-${day}`,
    rosterStatus: "FINAL",
    disposition: day === 24 || day === 31 ? "RELEASED" : "ROSTER_FREE",
    lostMinutes: day === 24 || day === 31 ? 462 : null,
    mustWorkElsewhere: true,
  })),
};
