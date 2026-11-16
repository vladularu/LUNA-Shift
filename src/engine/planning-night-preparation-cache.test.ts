import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { ComplianceInterval } from "./compliance-sequences";
import { forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { checkPlanningNightsSteps } from "./planning-night-recovery";

function timeline(first: string, timeZone = "Europe/Berlin") {
  return Array.from({ length: 4 }, (_, index): ComplianceInterval => {
    const date = Temporal.PlainDate.from(first).add({ days: index });
    const start = date.toZonedDateTime({ timeZone, plainTime: "22:00" });
    const end = date.add({ days: 1 }).toZonedDateTime({ timeZone, plainTime: "06:00" });
    const grossMinutes = (end.epochMilliseconds - start.epochMilliseconds) / 60000;
    return {
      shift: forecastShift({
        id: `night-${index}`,
        date: date.toString(),
        startTime: "22:00",
        endTime: "06:00",
        breakMinutes: 0,
      }),
      start,
      end,
      grossMinutes,
      netMinutes: grossMinutes,
    };
  });
}
function check(
  intervals: readonly ComplianceInterval[],
  timeZone = "Europe/Berlin",
  complete = true,
) {
  const steps = checkPlanningNightsSteps(
    intervals,
    intervals.map((item) => item.shift),
    timeZone,
    { allEmploymentWorkRecorded: complete, coverageStart: "2020-01-01", coverageEnd: "2040-01-01" },
  );
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
describe("shared night time evidence", () => {
  it("reuses native time conversion for equivalent cloned shifts while rebinding the latest duty identifiers", () => {
    const input = timeline("2031-07-01");
    const first = check(input);
    expect(first).toHaveLength(1);
    const calls = vi.spyOn(Temporal.PlainDate.prototype, "toZonedDateTime");
    try {
      const cloned = input.map((item) => ({
        ...item,
        shift: { ...item.shift, id: `new-${item.shift.id}`, title: "Neu geladen" },
      }));
      const second = check(cloned);
      expect(calls).not.toHaveBeenCalled();
      expect(second[0]?.facts).toMatchObject({ nightSequence: { lastShiftId: "new-night-3" } });
      expect(second[0]?.relatedShiftIds.every((id) => id.startsWith("new-"))).toBe(true);
      check(timeline("2031-07-01", "America/New_York"), "America/New_York");
      expect(calls).toHaveBeenCalled();
    } finally {
      calls.mockRestore();
    }
  });
  it("does not reuse qualification after an in-place clock or net-work edit at the same revision", () => {
    const input = timeline("2032-07-01");
    expect(check(input)).toHaveLength(1);
    Object.assign(input[1]!.shift, { startTime: "21:00" });
    expect(
      check(input).some(
        (issue) => issue.facts && "count" in issue.facts && (issue.facts.count ?? 0) >= 4,
      ),
    ).toBe(false);
    Object.assign(input[1]!.shift, { startTime: "22:00" });
    expect(check(input)).toHaveLength(1);
    Object.assign(input[1]!, { netMinutes: 0 });
    expect(
      check(input).some(
        (issue) => issue.facts && "count" in issue.facts && (issue.facts.count ?? 0) >= 4,
      ),
    ).toBe(false);
  });
  it("keeps completeness and recovery classification specific to the current request", () => {
    const input = timeline("2033-07-01");
    const known = check(input),
      unknown = check(input, "Europe/Berlin", false);
    expect(known).toHaveLength(1);
    expect(unknown[0]?.facts).toMatchObject({ nightSequence: { recoveryStatus: "unknown" } });
    expect(check(input)).toEqual(known);
  });
  it("retains the zone identity for the same instants without formatting zoned timestamps", () => {
    const input = timeline("2034-07-01");
    expect(check(input)).toHaveLength(1);
    const formatting = vi.spyOn(Temporal.ZonedDateTime.prototype, "toString");
    try {
      const shiftedZone = input.map((item) => ({
        ...item,
        start: item.start.withTimeZone("UTC"),
        end: item.end.withTimeZone("UTC"),
      }));
      expect(
        check(shiftedZone).some(
          (issue) => issue.facts && "count" in issue.facts && (issue.facts.count ?? 0) >= 4,
        ),
      ).toBe(false);
      expect(check(input)).toHaveLength(1);
      expect(formatting).not.toHaveBeenCalled();
    } finally {
      formatting.mockRestore();
    }
  });
  it("yields while preparing a large input signature before starting night qualification", () => {
    const input = Array.from({ length: 16 }, (_, index) =>
      timeline(`2035-${String((index % 12) + 1).padStart(2, "0")}-01`),
    ).flat();
    const conversion = vi.spyOn(Temporal.ZonedDateTime.prototype, "toPlainDate");
    try {
      const steps = checkPlanningNightsSteps(
        input,
        input.map((item) => item.shift),
        "Europe/Berlin",
        {
          coverageStart: "2035-01-01",
          coverageEnd: "2036-01-01",
          allEmploymentWorkRecorded: true,
        },
      );
      expect(steps.next().done).toBe(false);
      expect(conversion).not.toHaveBeenCalled();
      steps.return([]);
    } finally {
      conversion.mockRestore();
    }
  });
});
