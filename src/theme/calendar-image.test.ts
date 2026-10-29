import { describe, expect, it } from "vitest";
import {
  calendarImageOpacityPercentage,
  calendarImageOverlayOpacity,
  parseCalendarImageStrength,
} from "./calendar-image";

describe("calendar photo opacity compatibility", () => {
  it.each([
    ["subtle", 10],
    ["medium", 25],
    ["strong", 40],
  ] as const)("preserves %s as %s percent", (preset, percent) => {
    expect(parseCalendarImageStrength(preset)).toBe(preset);
    expect(calendarImageOpacityPercentage(preset)).toBe(percent);
  });
  it.each([0, 1, 35, 50, 99, 100])(
    "preserves stored and rendered %s percent without a hidden cap",
    (value) => {
      expect(parseCalendarImageStrength(String(value))).toBe(value);
      expect(parseCalendarImageStrength(value)).toBe(value);
      expect(calendarImageOverlayOpacity(value)).toBeCloseTo(1 - value / 100);
      expect(calendarImageOpacityPercentage(value)).toBe(value);
    },
  );
  it.each([null, undefined, "", "35px", "1e2", "-1", "101", -1, 101, 2.5, NaN, Infinity, true, {}])(
    "retains the default for invalid input %j",
    (value) => {
      expect(parseCalendarImageStrength(value)).toBe("medium");
    },
  );
});
