import { describe, expect, it } from "vitest";
import { forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "./tvoed-pattern";
import { calculateTvhKrAssessment } from "./simple-tvh-kr-profile-pay";

describe("TV-H assessment shared by preparation and monthly pay", () => {
  it("reuses equal inputs and detects content changes without a revision change", () => {
    const shifts = [forecastShift({ id: "assessment", date: "2026-10-20" })];
    const first = calculateTvhKrAssessment("2026-10", shifts);
    expect(
      calculateTvhKrAssessment("2026-10", structuredClone(shifts), {
        ...DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      }),
    ).toBe(first);
    shifts[0] = { ...shifts[0], endTime: "22:00", breakMinutes: 0 };
    const changed = calculateTvhKrAssessment("2026-10", shifts);
    expect(changed).not.toBe(first);
    expect(changed.assessment?.evidence).not.toEqual(first.assessment?.evidence);
    expect(Object.isFrozen(shifts[0])).toBe(false);
    expect(Object.isFrozen(first.assessment?.criteria)).toBe(true);
  });
  it("bounds retained revisions and keeps pattern settings and time zones separate", () => {
    const shift = forecastShift({ id: "bounded-assessment", date: "2026-10-20" });
    const first = calculateTvhKrAssessment("2026-10", [shift]);
    expect(
      calculateTvhKrAssessment("2026-10", [shift], {
        ...DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
        assignment: "PERMANENT",
      }),
    ).not.toBe(first);
    expect(calculateTvhKrAssessment("2026-10", [shift], undefined, "UTC")).not.toBe(first);
    for (let i = 0; i < 25; i++)
      calculateTvhKrAssessment("2026-10", [{ ...shift, note: String(i) }]);
    const repeated = calculateTvhKrAssessment("2026-10", [shift]);
    expect(repeated).not.toBe(first);
    expect(repeated).toEqual(first);
  });
});
