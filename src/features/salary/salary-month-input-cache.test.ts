import { describe, expect, it, vi, afterEach } from "vitest";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { createRuleResolver } from "@/rules/rule-resolver";
import * as preparation from "@/engine/prepare-monthly-pay";
import {
  salaryMonthInput,
  salaryMonthInputSteps,
  type SalaryMonthContext,
} from "./salary-month-input";

const drain = <T>(steps: Generator<number, T, void>): T => {
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
  }
};
function context(): SalaryMonthContext {
  return {
    entries: [forecastShift()],
    tariffDecisions: [],
    workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    resolver: createRuleResolver(),
  };
}
afterEach(() => vi.restoreAllMocks());
describe("shared prepared monthly salary inputs", () => {
  it("skips repeated work for equivalent SQL objects and preserves the uncached financial result", () => {
    const input = context();
    const prepare = vi.spyOn(preparation, "prepareMonthlyPaySteps");
    const first = drain(salaryMonthInputSteps("2026-07", forecastProfile, input));
    const second = drain(
      salaryMonthInputSteps("2026-07", structuredClone(forecastProfile), {
        ...structuredClone({ ...input, resolver: undefined }),
        resolver: input.resolver,
      }),
    );
    expect(first.pay.available).toBe(true);
    expect(second).toBe(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(first).toEqual(salaryMonthInput("2026-07", forecastProfile, input));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.shifts)).toBe(true);
    expect(Object.isFrozen(input.entries[0])).toBe(false);
  });
  it.each(["shift", "assessment", "profile", "decision", "pattern", "resolver"] as const)(
    "invalidates changed %s even without new revisions",
    (change) => {
      const input = context();
      let profile = structuredClone(forecastProfile);
      const first = drain(salaryMonthInputSteps("2026-07", profile, input));
      const prepare = vi.spyOn(preparation, "prepareMonthlyPaySteps");
      let next = input;
      if (change === "shift") next = { ...input, entries: [forecastShift({ endTime: "05:00" })] };
      if (change === "assessment")
        next = {
          ...input,
          entries: [...input.entries, forecastShift({ id: "reference", date: "2026-06-04" })],
        };
      if (change === "profile") profile = { ...profile, weeklyMinutes: 1200 };
      if (change === "decision")
        next = {
          ...input,
          tariffDecisions: [
            {
              month: "2026-07",
              allowanceStatus: "NONE",
              revision: 1,
              confirmedAt: "2026-07-01",
              updatedAt: "2026-07-01",
            },
          ],
        };
      if (change === "pattern")
        next = {
          ...input,
          workPatternSettings: { ...input.workPatternSettings, updatedAt: "2026-07-01" },
        };
      if (change === "resolver") next = { ...input, resolver: createRuleResolver() };
      const result = drain(salaryMonthInputSteps("2026-07", profile, next));
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(result).not.toBe(first);
      expect(result).toEqual(salaryMonthInput("2026-07", profile, next));
    },
  );
  it("retries failures instead of storing them", () => {
    const input = context();
    const prepare = vi
      .spyOn(preparation, "prepareMonthlyPaySteps")
      .mockImplementationOnce(function* () {
        yield 1;
        throw new Error("transient");
      });
    expect(() => drain(salaryMonthInputSteps("2026-07", forecastProfile, input))).toThrow(
      "transient",
    );
    expect(drain(salaryMonthInputSteps("2026-07", forecastProfile, input)).pay.available).toBe(
      true,
    );
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
