import { describe, expect, it } from "vitest";
import { newSpecialDuty } from "@/domain/special-duty";
import { changeDutyClock, dutyFormFeedback, dutyParentPart } from "./special-duty-form-state";

const zone = "Europe/Berlin";
const split = {
  ...newSpecialDuty("SPLIT", "08:00", "10:00", zone),
  parts: [{ start: 17 * 60, end: 21 * 60, breakMinutes: 0 }],
};

describe("special duty form feedback", () => {
  it("separates six hours of work from the seven-hour interruption in the accepted example", () => {
    expect(dutyFormFeedback(split, dutyParentPart("08:00", "10:00", 0, "0"))).toMatchObject({
      workMinutes: 360,
      interruptionMinutes: 420,
      parentError: null,
      partErrors: [null],
    });
  });
  it("subtracts exact pauses in both parts without rounding", () => {
    const result = dutyFormFeedback(
      { ...split, parts: [{ ...split.parts[0], breakMinutes: 7 }] },
      dutyParentPart("08:00", "10:00", 0, "15"),
    );
    expect(result.workMinutes).toBe(338);
    expect(result.interruptionMinutes).toBe(420);
  });
  it("marks the offending part and suppresses totals for overlap", () => {
    const result = dutyFormFeedback(
      { ...split, parts: [{ start: 9 * 60, end: 12 * 60, breakMinutes: 0 }] },
      dutyParentPart("08:00", "10:00", 0, "0"),
    );
    expect(result.partErrors[0]).toContain("Dienstteil 2");
    expect(result.workMinutes).toBeNull();
  });
  it("checks all extra parts, including parts entered out of chronological order", () => {
    const result = dutyFormFeedback(
      { ...split, parts: [split.parts[0], { start: 18 * 60, end: 22 * 60, breakMinutes: 0 }] },
      dutyParentPart("08:00", "10:00", 0, "0"),
    );
    expect(result.partErrors.every((error) => error?.includes("überschneidet"))).toBe(true);
  });
  it("puts an invalid pause on its own block", () => {
    const result = dutyFormFeedback(split, dutyParentPart("08:00", "10:00", 0, "120"));
    expect(result.parentError).toContain("Pause");
    expect(result.workMinutes).toBeNull();
  });
  it("keeps midnight explicit without resetting a chosen later end day", () => {
    const part = dutyParentPart("22:00", "23:00", 0, "0");
    expect(changeDutyClock(part, "end", "06:00").end).toBe(1800);
    expect(changeDutyClock({ ...part, end: 3 * 1440 + 360 }, "end", "08:00").end).toBe(
      3 * 1440 + 480,
    );
  });
  it("keeps multi-day on-call windows valid and never calls the window work", () => {
    const duty = { ...newSpecialDuty("ON_CALL", "08:00", "08:00", zone), endDay: 14 };
    const result = dutyFormFeedback(duty, dutyParentPart("08:00", "08:00", 14, "0"));
    expect(result.parentError).toBeNull();
    expect(result.workMinutes).toBeNull();
  });
  it("checks on-site travel against the on-call window", () => {
    const duty = {
      ...newSpecialDuty("ON_CALL", "08:00", "16:00", zone),
      callouts: [
        {
          kind: "ON_SITE" as const,
          start: 480,
          end: 540,
          departure: 470,
          returned: 550,
          breakMinutes: 0,
        },
      ],
    };
    expect(
      dutyFormFeedback(duty, dutyParentPart("08:00", "16:00", 0, "0")).calloutErrors[0],
    ).toContain("Wege");
  });
  it("uses the actual date across daylight saving and wall-clock hours for a template", () => {
    const duty = {
      ...newSpecialDuty("SPLIT", "22:00", "06:00", zone),
      parts: [{ start: 1440 + 8 * 60, end: 1440 + 10 * 60, breakMinutes: 0 }],
    };
    const parent = dutyParentPart("22:00", "06:00", 1, "0");
    expect(dutyFormFeedback(duty, parent).workMinutes).toBe(600);
    expect(dutyFormFeedback(duty, parent, "2026-10-24").workMinutes).toBe(660);
  });
  it("identifies a nonexistent or ambiguous clock time without rendering a false total", () => {
    const duty = newSpecialDuty("SPLIT", "02:30", "04:00", zone);
    for (const date of ["2026-03-29", "2026-10-25"]) {
      const result = dutyFormFeedback(duty, dutyParentPart("02:30", "04:00", 0, "0"), date);
      expect(result.parentError).toContain("Zeitumstellung");
      expect(result.workMinutes).toBeNull();
    }
  });
  it("tolerates incomplete web time entry without crashing", () => {
    expect(dutyFormFeedback(split, dutyParentPart("0", "10:00", 0, "0")).parentError).toContain(
      "gültige Uhrzeiten",
    );
  });
});
