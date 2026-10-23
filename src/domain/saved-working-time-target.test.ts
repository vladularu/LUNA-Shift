import { describe, expect, it } from "vitest";
import { decemberTargetContext } from "./working-time-target-test-fixtures";
import {
  validateWorkingTimeTargetContext,
  validateWorkingTimeTargetSettings,
} from "./saved-working-time-target";

describe("persisted target contract", () => {
  it("detaches and freezes the complete history and accepts explicitly unknown prerequisites", () => {
    const input = {
      periods: [
        {
          ...decemberTargetContext.periods[0],
          model: { kind: "UNKNOWN" },
          tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: null },
        },
      ],
      days: [],
    };
    const parsed = validateWorkingTimeTargetContext(input);
    input.periods[0].weeklyMinutes = 1000;
    expect(parsed.periods[0].weeklyMinutes).toBe(2310);
    expect(parsed.periods[0].tariff).toMatchObject({ scopeConfirmed: null });
    expect(Object.isFrozen(parsed.periods[0].model)).toBe(true);
  });
  it.each([
    "extra-context",
    "extra-model",
    "overlap",
    "duplicate-day",
    "invalid-date",
    "bad-region",
    "wrong-minutes",
    "bad-confirmation",
    "unknown-model",
    "unknown-tariff",
    "null-periods",
    "missing-roster",
  ])("rejects %s without a fallback", (kind) => {
    const data = JSON.parse(JSON.stringify(decemberTargetContext));
    if (kind === "extra-context") data.extra = true;
    if (kind === "extra-model") data.periods[0].model.fake = true;
    if (kind === "overlap") data.periods.push(data.periods[0]);
    if (kind === "duplicate-day") data.days.push(data.days[0]);
    if (kind === "invalid-date") data.periods[0].validFrom = "2026-02-30";
    if (kind === "bad-region") data.periods[0].holidayRegion = "BY_AUGSBURG";
    if (kind === "wrong-minutes") data.periods[0].weeklyMinutes = -1;
    if (kind === "bad-confirmation") data.periods[0].tariff.scopeConfirmed = "true";
    if (kind === "unknown-model") data.periods[0].model.kind = "SOMETHING_NEW";
    if (kind === "unknown-tariff") data.periods[0].tariff.kind = "TV_L";
    if (kind === "null-periods") data.periods = null;
    if (kind === "missing-roster") delete data.days[0].rosterStatus;
    expect(() => validateWorkingTimeTargetContext(data)).toThrow();
  });
  it.each(["future", "missing-binding", "duplicate-binding", "foreign-binding"])(
    "rejects %s settings",
    (kind) => {
      const data = {
        version: kind === "future" ? 2 : 1,
        context: decemberTargetContext,
        planBindings: decemberTargetContext.days.map((day) => ({
          date: day.date,
          signature: "plan",
        })),
      };
      if (kind === "missing-binding") data.planBindings.pop();
      if (kind === "duplicate-binding") data.planBindings[1] = data.planBindings[0];
      if (kind === "foreign-binding") data.planBindings[0].date = "2026-12-01";
      expect(() => validateWorkingTimeTargetSettings(data)).toThrow();
    },
  );
});
