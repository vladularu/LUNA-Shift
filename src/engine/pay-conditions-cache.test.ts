import { describe, expect, it } from "vitest";
import { BUNDLED_TARIFF_RULES } from "@/rules/bundled-rules";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import type { RuleConditions } from "@/rules/contracts.generated";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { conditionsMatch, createPayConditionMatcher } from "./pay-conditions";
import { countPremiumMinutes } from "./pay-premium-minutes";

describe("conditions within one immutable minute traversal", () => {
  it("keeps all original rule results and date-dependent conditions", () => {
    const shift = forecastShift();
    const match = createPayConditionMatcher(forecastProfile, shift);
    for (const rule of BUNDLED_TARIFF_RULES[0].rules.premiumRules)
      for (const date of ["2026-10-03", "2026-10-04"])
        expect(match(rule.conditions, date)).toBe(
          conditionsMatch(rule.conditions, forecastProfile, date, shift, null),
        );
    const dated: RuleConditions = {
      ...BUNDLED_TARIFF_RULES[0].rules.premiumRules[0].conditions,
      monthDays: ["10-03"],
    };
    expect(match(dated, "2026-10-04")).toBe(false);
  });
  it("reuses false and true results only within that call, including a new date", () => {
    let reads = 0;
    const conditions = {
      ...BUNDLED_TARIFF_RULES[0].rules.premiumRules[0].conditions,
      get requiresShiftTypes() {
        reads++;
        return ["late"];
      },
    };
    const shift = forecastShift();
    const match = createPayConditionMatcher(forecastProfile, shift);
    expect(match(conditions, "2026-10-03")).toBe(false);
    const firstReads = reads;
    expect(match(conditions, "2026-10-03")).toBe(false);
    expect(reads).toBe(firstReads);
    match(conditions, "2026-10-04");
    expect(reads).toBeGreaterThan(firstReads);
    const fresh = createPayConditionMatcher(forecastProfile, { ...shift, type: "LATE" });
    expect(fresh(conditions, "2026-10-03")).toBe(
      conditionsMatch(conditions, forecastProfile, "2026-10-03", { ...shift, type: "LATE" }, null),
    );
  });
  it("preserves lazy error ordering for a rule outside the worked time window", () => {
    const rulePackage = structuredClone(BUNDLED_TARIFF_RULES[0]);
    const rule = rulePackage.rules.premiumRules.find((item) => item.premiumType === "NIGHT")!;
    rulePackage.rules.premiumRules = [rule];
    rulePackage.rules.combinationRules = [];
    const conditions = {
      ...rule.conditions,
      get requiresShiftTypes(): string[] {
        throw new Error("evaluated condition");
      },
    };
    const selected = { ...rule, conditions, timeWindow: { startMinute: 1000, endMinute: 1100 } };
    rulePackage.rules.premiumRules = [selected];
    const shift = forecastShift({
      date: "2026-10-20",
      startTime: "06:00",
      endTime: "07:00",
      breakMinutes: 0,
    });
    expect(
      countPremiumMinutes(shift, forecastProfile, 60, 0, 0, rulePackage, bundledRuleResolver)
        .byRuleId.size,
    ).toBe(0);
    rulePackage.rules.premiumRules = [
      { ...selected, timeWindow: { startMinute: 360, endMinute: 420 } },
    ];
    expect(() =>
      countPremiumMinutes(shift, forecastProfile, 60, 0, 0, rulePackage, bundledRuleResolver),
    ).toThrow("evaluated condition");
  });
});
