import { describe, expect, it } from "vitest";
import {
  newSpecialDuty,
  plannedSpecialDuty,
  validateSpecialDuty,
  validateDutyParent,
} from "./special-duty";

const duty = {
  ...newSpecialDuty("STANDBY", "20:00", "08:00", "Europe/Berlin"),
  version: 3 as const,
  standbyAgreement: null,
  breakStart: 1470,
};
const parent = {
  date: "2026-10-24",
  type: "CUSTOM",
  startTime: "20:00",
  endTime: "08:00",
  breakMinutes: 30,
};
describe("standby break position", () => {
  it("preserves a dated break and planned template without inventing a payroll agreement", () => {
    expect(validateSpecialDuty(duty)).toEqual(duty);
    expect(() => validateDutyParent(duty, parent)).not.toThrow();
    expect(plannedSpecialDuty(duty)?.breakStart).toBe(1470);
    expect(
      validateSpecialDuty(newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"))?.version,
    ).toBe(1);
  });
  it.each([1199, 1920, 1910])("rejects a break outside the parent (%s)", (breakStart) => {
    expect(() => validateDutyParent({ ...duty, breakStart }, parent)).toThrow();
  });
  it("rejects ambiguous and nonexistent local break starts", () => {
    expect(() => validateDutyParent({ ...duty, breakStart: 1590 }, parent)).toThrow();
    expect(() =>
      validateDutyParent({ ...duty, breakStart: 1590 }, { ...parent, date: "2026-03-28" }),
    ).toThrow();
  });
  it.each([
    { ...duty, version: 2 },
    { ...duty, kind: "ON_CALL" },
    { ...duty, breakStart: -1 },
    { ...duty, breakStart: 0.5 },
  ])("rejects malformed versioned payloads", (value) => {
    expect(() => validateSpecialDuty(value)).toThrow();
  });
});
