import { describe, expect, it } from "vitest";
import type { MonthlyWorkingTimeTarget } from "@/domain/working-time-target";
import { targetCalculationCaption } from "./target-calculation-caption";

const target: MonthlyWorkingTimeTarget = {
  month: "2026-11",
  status: "PROVISIONAL",
  baseMinutes: 9702,
  targetMinutes: 9702,
  statutoryReductionMinutes: 0,
  tariffReductionMinutes: 0,
  roundingMinutes: 0,
  adjustments: [],
  days: [],
  notices: [
    { code: "CONTRACTUAL_TARGET_FORECAST", affectsTarget: true, date: null, message: "Prognose" },
  ],
};
describe("target calculation wording", () => {
  it("does not let a general forecast notice hide missing holiday inputs", () => {
    expect(
      targetCalculationCaption({
        ...target,
        notices: [
          { code: "TARGET_RULE_FORECAST", affectsTarget: true, date: null, message: "Prognose" },
          {
            code: "HOLIDAY_REGION_UNKNOWN",
            affectsTarget: true,
            date: null,
            message: "Bundesland fehlt",
          },
        ],
      }),
    ).toContain("Bundesland");
  });
  it("explains the normal profile calculation without implying incorrect hours", () => {
    expect(targetCalculationCaption(target)).toBe("Aus deinem Arbeitszeitprofil berechnet.");
    expect(targetCalculationCaption({ ...target, status: "FINAL" })).toBeUndefined();
    expect(targetCalculationCaption(undefined)).toBeUndefined();
  });
  it.each([
    ["LEGACY_WORK_MODEL_UNKNOWN", "5-Tage-Woche"],
    ["HOLIDAY_REGION_UNKNOWN", "Bundesland"],
    ["TARIFF_SCOPE_UNCONFIRMED", "Tarifzuordnung"],
    ["SEVEN_DAY_PLAN_UNCONFIRMED", "Dienstplan"],
    ["UNRECOGNIZED", "Berechnungsannahmen"],
  ])("retains the concrete open basis for %s", (code, expected) => {
    expect(
      targetCalculationCaption({
        ...target,
        notices: [...target.notices, { code, affectsTarget: true, date: null, message: "offen" }],
      }),
    ).toContain(expected);
  });
});
