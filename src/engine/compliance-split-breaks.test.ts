import { describe, expect, it } from "vitest";

import { newSpecialDuty } from "@/domain/special-duty";
import type { ShiftEntry } from "@/domain/types";
import { calculateMonthlyCompliance } from "./compliance";
import { forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { calculateTimedDailyWorkCredit } from "./daily-summary";

function splitDuty(
  startTime = "06:00",
  endTime = "10:00",
  parts = [{ start: 16 * 60, end: 20 * 60, breakMinutes: 0 }],
): ShiftEntry {
  return forecastShift({
    id: "split",
    date: "2026-07-06",
    type: "DAY",
    startTime,
    endTime,
    breakMinutes: 0,
    specialDuty: { ...newSpecialDuty("SPLIT", startTime, endTime, "Europe/Berlin"), parts },
  });
}

function pauseIssues(shifts: readonly ShiftEntry[]) {
  return calculateMonthlyCompliance("2026-07", shifts, "Europe/Berlin", {
    referenceDate: "2026-07-31",
  }).issues.filter((issue) => issue.rule.startsWith("ARBZG_4_"));
}

describe("planned breaks between split-duty parts", () => {
  it("accepts a free split-duty interruption without subtracting the gap from work again", () => {
    const duty = splitDuty();
    const workBefore = calculateTimedDailyWorkCredit(duty.date, [duty], {
      timeZone: "Europe/Berlin",
    });
    expect(pauseIssues([duty])).toEqual([]);
    expect(workBefore.actualMinutes).toBe(480);
    expect(calculateTimedDailyWorkCredit(duty.date, [duty], { timeZone: "Europe/Berlin" })).toEqual(
      workBefore,
    );
    expect(duty.breakMinutes).toBe(0);
    expect(duty.specialDuty?.parts[0].breakMinutes).toBe(0);
  });

  it("still requires 45 minutes for more than nine working hours even with short individual parts", () => {
    const issues = pauseIssues([
      splitDuty("06:00", "11:00", [{ start: 11 * 60 + 30, end: 16 * 60 + 30, breakMinutes: 0 }]),
    ]);
    expect(issues).toEqual([
      expect.objectContaining({
        rule: "ARBZG_4_BREAK",
        facts: { rule: "ARBZG_4_BREAK", recordedBreakMinutes: 30, requiredBreakMinutes: 45 },
      }),
    ]);
  });

  it("accepts an adequate 45-minute interruption for ten working hours", () => {
    expect(
      pauseIssues([
        splitDuty("06:00", "11:00", [{ start: 11 * 60 + 45, end: 16 * 60 + 45, breakMinutes: 0 }]),
      ]),
    ).toEqual([]);
  });

  it("does not count interruptions shorter than 15 minutes", () => {
    const issues = pauseIssues([
      splitDuty("06:00", "10:00", [{ start: 10 * 60 + 10, end: 14 * 60 + 10, breakMinutes: 0 }]),
    ]);
    expect(issues.map((issue) => issue.rule)).toEqual(
      expect.arrayContaining(["ARBZG_4_BREAK", "ARBZG_4_CONTINUOUS"]),
    );
  });

  it("retains a continuous-work violation before a long interruption", () => {
    expect(
      pauseIssues([
        splitDuty("06:00", "12:30", [{ start: 16 * 60, end: 18 * 60, breakMinutes: 0 }]),
      ]).map((issue) => issue.rule),
    ).toEqual(["ARBZG_4_CONTINUOUS"]);
  });

  it("adds qualifying split interruptions to entered breaks without duplicating them", () => {
    const duty = splitDuty("06:00", "11:15", [
      { start: 11 * 60 + 30, end: 16 * 60 + 30, breakMinutes: 0 },
    ]);
    expect(pauseIssues([{ ...duty, breakMinutes: 30 }])).toEqual([]);
  });

  it("keeps unrelated entries provisional even if their times resemble a split duty", () => {
    const duty = splitDuty();
    const first = { ...duty, specialDuty: null };
    expect(
      pauseIssues([first, { ...first, id: "second", startTime: "16:00", endTime: "20:00" }]).map(
        (issue) => issue.rule,
      ),
    ).toEqual(["ARBZG_4_INTERRUPTION"]);
  });

  it("does not credit a split interruption occupied by another shift", () => {
    const duty = splitDuty("06:00", "10:00", [
      { start: 10 * 60 + 30, end: 14 * 60 + 30, breakMinutes: 0 },
    ]);
    const occupied = forecastShift({
      id: "other-work",
      date: duty.date,
      startTime: "10:00",
      endTime: "10:30",
      breakMinutes: 0,
    });
    expect(pauseIssues([duty, occupied]).map((issue) => issue.rule)).toEqual(
      expect.arrayContaining(["ARBZG_4_BREAK", "ARBZG_4_CONTINUOUS"]),
    );
  });

  it("does not assume an overlapping on-call period without callouts is a freely available break", () => {
    const duty = splitDuty();
    const onCall = forecastShift({
      id: "on-call",
      date: duty.date,
      startTime: "10:00",
      endTime: "16:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "10:00", "16:00", "Europe/Berlin"),
        calloutsComplete: true,
      },
    });
    expect(pauseIssues([duty, onCall]).map((issue) => issue.rule)).toEqual([
      "ARBZG_4_INTERRUPTION",
    ]);
    expect(pauseIssues([duty, { ...onCall, deletedAt: "2026-07-06T20:00:00Z" }])).toEqual([]);
  });

  it("does not count a gap occupied by an overnight shift recorded on the previous date", () => {
    const duty = splitDuty("06:00", "10:00", [
      { start: 10 * 60 + 30, end: 14 * 60 + 30, breakMinutes: 0 },
    ]);
    const overnight = forecastShift({
      id: "overnight-work",
      date: "2026-07-05",
      startTime: "23:30",
      endTime: "10:30",
      breakMinutes: 0,
    });
    expect(
      pauseIssues([duty, overnight])
        .filter((issue) => issue.date === duty.date)
        .map((issue) => issue.rule),
    ).toEqual(["ARBZG_4_BREAK"]);
  });
});
