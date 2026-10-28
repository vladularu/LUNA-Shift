import { describe, expect, it } from "vitest";
import { forecastProfile } from "./net-pay-tvoed-forecast-test-fixtures";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { createRuleResolver } from "@/rules/rule-resolver";
import {
  calculateMonthlyWorkingTimeTarget,
  calculateMonthlyWorkingTimeTargetSteps,
} from "./working-time-target";

describe("cooperative target day ledger", () => {
  it.each(["2026-12", "2027-01"])("preserves the complete synchronous ledger for %s", (month) => {
    const profile = createWorkingTimeCalculationProfile(
      forecastProfile,
      null,
      [],
      "ready",
      [],
      false,
    );
    const expected = calculateMonthlyWorkingTimeTarget(month, profile, createRuleResolver());
    const steps = calculateMonthlyWorkingTimeTargetSteps(month, profile, createRuleResolver());
    const yielded: number[] = [];
    while (true) {
      const next = steps.next();
      if (next.done) {
        expect(next.value).toEqual(expected);
        break;
      }
      yielded.push(next.value);
    }
    expect(yielded).toEqual(Array.from({ length: 31 }, (_, index) => index + 1));
  });
  it("does not publish an incomplete ledger after cancellation", () => {
    const profile = createWorkingTimeCalculationProfile(
        forecastProfile,
        null,
        [],
        "ready",
        [],
        false,
      ),
      resolver = createRuleResolver();
    const steps = calculateMonthlyWorkingTimeTargetSteps("2026-12", profile, resolver);
    expect(steps.next().done).toBe(false);
    steps.return(undefined as never);
    const retry = calculateMonthlyWorkingTimeTargetSteps("2026-12", profile, resolver);
    expect(retry.next().done).toBe(false);
    retry.return(undefined as never);
    expect(calculateMonthlyWorkingTimeTarget("2026-12", profile, resolver).days.length).toBe(31);
  });
});
