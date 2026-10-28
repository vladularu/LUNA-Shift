import { describe, expect, it } from "vitest";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { calculateTvlKrShift } from "./simple-tvl-kr-pay";
import { calculateTvUkNursingShift } from "./simple-tvuk-nursing-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";

describe("TV-L and TV-UK shift reuse", () => {
  const work = { ...forecastProfile, tariff: null };
  const shift = forecastShift({
    date: "2026-07-04",
    startTime: "13:00",
    endTime: "21:00",
    breakMinutes: 0,
  });
  it("reuses TV-L cash/trace separately and invalidates Saturday eligibility, content and resolver changes", () => {
    const selection = { payGroup: "KR8" as const, payLevel: 4 as const };
    const resolver = { ...bundledRuleResolver };
    const first = calculateTvlKrShift(shift, work, selection, "WEST", false, resolver);
    expect(
      calculateTvlKrShift({ ...shift }, { ...work }, { ...selection }, "WEST", false, resolver),
    ).toBe(first);
    const shiftWork = calculateTvlKrShift(shift, work, selection, "WEST", true, resolver);
    expect(shiftWork).not.toBe(first);
    expect(shiftWork.totalAmount).not.toBe(first.totalAmount);
    expect(
      calculateTvlKrShift({ ...shift, endTime: "22:00" }, work, selection, "WEST", false, resolver),
    ).not.toBe(first);
    expect(calculateTvlKrShift(shift, work, selection, "WEST", false, { ...resolver })).not.toBe(
      first,
    );
    const trace = calculateTvlKrShift(shift, work, selection, "WEST", false, resolver, true);
    expect(trace.payrollTrace).toBeDefined();
    expect(first.payrollTrace).toBeUndefined();
    const { payrollTrace: _trace, ...cash } = trace;
    expect(cash).toEqual(first);
    expect(Object.isFrozen(shift)).toBe(false);
  });
  it("reuses TV-UK using its actual shift/break options and keeps night credit unchanged", () => {
    const selection = { payGroup: "PUK8" as const, payLevel: 4 as const };
    const resolver = { ...bundledRuleResolver };
    const night = { ...shift, startTime: "20:00", endTime: "06:00", breakMinutes: 60 };
    const first = calculateTvUkNursingShift(
      night,
      work,
      selection,
      { regularShiftWork: false },
      resolver,
    );
    expect(
      calculateTvUkNursingShift(
        { ...night },
        work,
        selection,
        { regularShiftWork: false },
        resolver,
      ),
    ).toBe(first);
    const paidBreak = calculateTvUkNursingShift(
      night,
      work,
      selection,
      { regularShiftWork: false, paidNightBreaks: true },
      resolver,
    );
    expect(paidBreak.netMinutes).toBeGreaterThan(first.netMinutes);
    expect(paidBreak.nightCompensatoryMinutes).toBeGreaterThan(first.nightCompensatoryMinutes);
    const trace = calculateTvUkNursingShift(
      night,
      work,
      selection,
      { regularShiftWork: false },
      resolver,
      true,
    );
    const { payrollTrace: _trace, ...cash } = trace;
    expect(cash).toEqual(first);
    expect(trace.payrollTrace).toBeDefined();
    expect(() =>
      calculateTvUkNursingShift(
        night,
        work,
        selection,
        { regularShiftWork: "invalid" as never },
        resolver,
      ),
    ).toThrow();
  });
});
