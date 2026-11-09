import { describe, expect, it } from "vitest";
import { captureEmploymentProfile } from "@/domain/employment-history";
import { calculateMonthlyCompliance } from "./compliance";
import { history, shift, work } from "./remuneration-test-fixtures";

const entries = ["2026-11-07", "2026-11-14", "2026-11-28"].map((date) =>
  shift({ id: date, date, type: "DAY", startTime: "08:00", endTime: "16:00" }),
);
function profile(change: Partial<typeof work> = {}) {
  return {
    ...work,
    employmentTimeline: [
      { ...history("2026-01-01"), employment: captureEmploymentProfile(work) },
      { ...history("2026-11-15"), employment: captureEmploymentProfile({ ...work, ...change }) },
    ],
  };
}
const calculate = (p = profile()) =>
  calculateMonthlyCompliance("2026-11", entries, p.timeZone, {
    employmentProfile: p,
    allEmploymentWorkRecorded: true,
    referenceDate: "2027-01-01",
  });

describe("weekend metadata across dated employment contexts", () => {
  it("keeps the full loaded weekend horizon on the dated youth path", () => {
    const p = profile();
    const result = calculateMonthlyCompliance("2026-11", entries, p.timeZone, {
      employmentProfile: p,
      youthProtection: true,
    });
    expect(result.weekendAssessment?.windows[0].assessmentComplete).toBe(true);
    expect(result.weekendAssessment?.windows[0].freeCount).toBe(4);
  });
  it("retains the complete monthly model and Sunday-anchored finding across a salary-only change", () => {
    const result = calculate(profile({ weeklyMinutes: 2200 }));
    expect(result.weekendAssessment).toMatchObject({
      totalCount: 5,
      occupiedCount: 3,
      freeCount: 2,
      unknownCount: 0,
    });
    expect(result.weekendAssessment?.windows.at(-1)).toMatchObject({
      assessmentComplete: true,
      freeCount: 1,
    });
    expect(result.issues.filter((i) => i.rule === "PLANNING_WEEKEND_RECOVERY")).toHaveLength(1);
    expect(result.issues.find((i) => i.rule === "PLANNING_WEEKEND_RECOVERY")?.date).toBe(
      "2026-11-29",
    );
  });
  it("resolves completeness per original profile date, instead of reusing the first slice", () => {
    const result = calculate(profile({ allEmploymentWorkRecorded: false }));
    expect(result.weekendAssessment?.weekends.at(-2)).toMatchObject({
      status: "UNKNOWN",
      reasons: expect.arrayContaining(["WORK_NOT_CONFIRMED_COMPLETE"]),
    });
    expect(result.weekendAssessment?.windows.at(-1)?.assessmentComplete).toBe(false);
    expect(result.issues.filter((i) => i.rule === "PLANNING_WEEKEND_RECOVERY")).toEqual([]);
  });
  it("keeps a true timezone change and a boundary weekend unassessable", () => {
    const result = calculate(profile({ timeZone: "America/New_York" }));
    expect(result.weekendAssessment?.windows.at(-1)?.assessmentComplete).toBe(false);
    expect(result.issues.filter((i) => i.rule === "PLANNING_WEEKEND_RECOVERY")).toEqual([]);
  });
  it("does not confuse four occupied weekends with complete evidence confirmation", () => {
    const p = profile({ allEmploymentWorkRecorded: false });
    const result = calculateMonthlyCompliance(
      "2026-11",
      [
        ...entries,
        shift({
          id: "extra",
          date: "2026-11-21",
          type: "DAY",
          startTime: "08:00",
          endTime: "16:00",
        }),
      ],
      p.timeZone,
      { employmentProfile: p },
    );
    expect(result.weekendAssessment?.windows.at(-1)).toMatchObject({
      occupiedCount: 4,
      unknownCount: 0,
      assessmentComplete: false,
    });
    expect(result.issues.filter((i) => i.rule === "PLANNING_WEEKEND_RECOVERY")).toEqual([]);
  });
});
