import { describe, expect, it } from "vitest";
import type { ShiftEntry } from "@/domain/types";
import { newSpecialDuty, validateSpecialDuty } from "@/domain/special-duty";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";
import { validPlanningWeekendAssessment } from "@/domain/planning-weekend-policy";
import { calculateMonthlyCompliance } from "./compliance";
import { checkPlanningWeekendsSteps } from "./planning-weekends";

const shift = (date: string, extra: Partial<ShiftEntry> = {}): ShiftEntry => ({
  kind: "SHIFT",
  id: date,
  date,
  templateId: null,
  title: "Tag",
  type: "DAY",
  startTime: "08:00",
  endTime: "16:00",
  breakMinutes: 30,
  color: "#000000",
  symbol: "sun",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
  ...extra,
});
const saturdays = (dates: readonly string[]) => dates.map((date) => shift(date));
const complete = {
  allEmploymentWorkRecorded: true,
  coverageStart: "2025-01-01",
  coverageEnd: "2028-01-01",
};
function check(entries: readonly ShiftEntry[], month = "2026-11", options = complete) {
  const steps = checkPlanningWeekendsSteps(month, entries, "Europe/Berlin", options);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
const last = (result: ReturnType<typeof check>) => result.assessment.windows.at(-1)!;

describe("two complete free weekends in four calendar weeks", () => {
  it("reuses duty evidence across months without retaining same-revision edits or deleted work", () => {
    const duty = shift("2026-11-07");
    const first = check([duty]);
    expect(first.assessment.occupiedCount).toBe(1);
    check([duty], "2026-12");
    expect(check([duty])).toEqual(first);
    Object.assign(duty, { type: "FREE", startTime: null, endTime: null });
    expect(check([duty]).assessment.occupiedCount).toBe(0);
    Object.assign(duty, { type: "DAY", startTime: "08:00", endTime: "16:00" });
    expect(check([duty])).toEqual(first);
    Object.assign(duty, { deletedAt: "2026-11-10" });
    expect(check([duty]).assessment.occupiedCount).toBe(0);
  });
  it("counts Sunday-owned month weekends and four complete Monday-Sunday weeks", () => {
    const { assessment, issues } = check([]);
    expect(assessment).toMatchObject({
      month: "2026-11",
      totalCount: 5,
      freeCount: 5,
      occupiedCount: 0,
      unknownCount: 0,
    });
    expect(assessment.weekends[0]).toMatchObject({
      saturday: "2026-10-31",
      sunday: "2026-11-01",
      status: "FREE",
    });
    expect(assessment.windows[0]).toMatchObject({
      from: "2026-10-05",
      until: "2026-11-01",
      freeCount: 4,
    });
    expect(assessment.windows[0].weekends).toHaveLength(4);
    expect(issues).toEqual([]);
  });
  it("accepts exactly two free weekends instead of a monthly duty threshold", () => {
    const result = check(saturdays(["2026-11-07", "2026-11-21"]));
    expect(last(result)).toMatchObject({ freeCount: 2, occupiedCount: 2, unknownCount: 0 });
    expect(result.issues).toEqual([]);
  });
  it("emits a single voluntary finding for known adverse windows, with inclusive bounds", () => {
    const result = check(saturdays(["2026-11-07", "2026-11-14", "2026-11-28"]));
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: "PLANNING",
      severity: "info",
      rule: "PLANNING_WEEKEND_RECOVERY",
      date: "2026-11-29",
    });
    expect(last(result)).toMatchObject({
      from: "2026-11-02",
      until: "2026-11-29",
      freeCount: 1,
      occupiedCount: 3,
      unknownCount: 0,
    });
    expect(result.issues[0].facts).toEqual({
      rule: "PLANNING_WEEKEND_RECOVERY",
      assessment: result.assessment,
    });
    expect(validComplianceIssueFacts(result.issues[0].facts, result.issues[0].rule)).toEqual(
      result.issues[0].facts,
    );
    expect(result.issues[0].assessmentRanges).toEqual([
      { from: "2026-11-02", through: "2026-11-29" },
    ]);
  });
  it("keeps all affected rolling windows but never emits the retired rule", () => {
    const result = check(
      saturdays([
        "2026-10-17",
        "2026-10-24",
        "2026-10-31",
        "2026-11-07",
        "2026-11-14",
        "2026-11-21",
        "2026-11-28",
      ]),
    );
    expect(result.issues).toHaveLength(1);
    expect(result.assessment.windows.filter((w) => w.freeCount < 2)).toHaveLength(5);
    expect(result.issues.some((i) => i.rule === "PLANNING_WEEKENDS")).toBe(false);
  });
  it("does not infer FREE from blank dates without explicit completeness confirmation", () => {
    const result = check(saturdays(["2026-11-07", "2026-11-14", "2026-11-28"]), "2026-11", {
      ...complete,
      allEmploymentWorkRecorded: false,
    });
    expect(result.assessment).toMatchObject({ freeCount: 0, occupiedCount: 3, unknownCount: 2 });
    expect(result.assessment.weekends[0].reasons).toContain("WORK_NOT_CONFIRMED_COMPLETE");
    expect(result.issues).toEqual([]);
  });
  it("does not emit a negative criterion for an incomplete four-week lookback", () => {
    const result = check(saturdays(["2026-10-17", "2026-10-24", "2026-10-31"]), "2026-11", {
      ...complete,
      coverageStart: "2026-10-20",
    });
    expect(result.assessment.windows[0].unknownCount).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
  });
  it("does not call a partially covered weekend free even with an explicit FREE entry", () => {
    const result = check(
      [shift("2026-11-28", { type: "FREE", allDay: true, startTime: null, endTime: null })],
      "2026-11",
      { ...complete, coverageEnd: "2026-11-29" },
    );
    expect(result.assessment.weekends.at(-1)).toMatchObject({
      status: "UNKNOWN",
      reasons: expect.arrayContaining(["OUTSIDE_COVERAGE"]),
    });
  });
  it("does not prove a boundary weekend free without loaded preceding duty entry dates", () => {
    const result = check([], "2026-11", {
      ...complete,
      coverageStart: "2026-10-31",
      coverageEnd: "2026-12-01",
    });
    expect(result.assessment.weekends[0]).toMatchObject({
      status: "UNKNOWN",
      reasons: expect.arrayContaining(["OUTSIDE_COVERAGE"]),
    });
  });
  it("keeps a four-week window open when carried fourteen-day duties could predate coverage", () => {
    const result = check([], "2026-11", {
      ...complete,
      coverageStart: "2026-10-31",
      coverageEnd: "2026-12-01",
    });
    expect(last(result).assessmentComplete).toBe(false);
    expect(last(result).unknownCount).toBeGreaterThan(0);
  });
  it("preserves occupied facts but does not claim complete assessment under narrow entry coverage", () => {
    const result = check(
      saturdays(["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"]),
      "2026-11",
      { ...complete, coverageStart: "2026-10-31", coverageEnd: "2026-12-01" },
    );
    expect(last(result)).toMatchObject({
      occupiedCount: 4,
      unknownCount: 0,
      assessmentComplete: false,
    });
    expect(result.issues).toEqual([]);
  });
  it("does not call Sunday free if stored-zone Monday entries have not been loaded", () => {
    const result = check([], "2026-11", { ...complete, coverageEnd: "2026-11-30" });
    expect(result.assessment.weekends.at(-1)?.status).toBe("UNKNOWN");
  });
  it("retains metadata on empty, ordinary, and youth compliance paths", () => {
    for (const youthProtection of [false, true])
      for (const entries of [[], saturdays(["2026-11-07", "2026-11-14", "2026-11-28"])]) {
        const result = calculateMonthlyCompliance("2026-11", entries, "Europe/Berlin", {
          allEmploymentWorkRecorded: true,
          youthProtection,
          referenceDate: "2027-01-01",
        });
        expect(result.weekendAssessment?.totalCount).toBe(5);
        expect(result.issues.some((i) => i.rule === "PLANNING_WEEKENDS")).toBe(false);
      }
  });
  it("carries a four-week window over the calendar year", () => {
    const result = check(saturdays(["2026-12-19", "2026-12-26", "2027-01-02"]), "2027-01");
    expect(result.assessment.weekends[0]).toMatchObject({
      saturday: "2027-01-02",
      sunday: "2027-01-03",
    });
    expect(result.assessment.windows[0]).toMatchObject({
      from: "2026-12-07",
      until: "2027-01-03",
      freeCount: 1,
    });
    expect(result.issues).toHaveLength(1);
  });
  it("counts Friday-night spillovers and Sunday work", () => {
    const result = check([
      shift("2026-11-06", { type: "NIGHT", startTime: "21:00", endTime: "07:30" }),
      shift("2026-11-15"),
      shift("2026-11-28"),
    ]);
    expect(last(result)).toMatchObject({ occupiedCount: 3, freeCount: 1 });
  });
  it("keeps midnight exact and an unlocated boundary pause unknown", () => {
    expect(
      check([shift("2026-11-06", { startTime: "16:00", endTime: "00:00" })]).assessment.weekends[1]
        .status,
    ).toBe("FREE");
    expect(
      check([shift("2026-11-06", { startTime: "21:00", endTime: "00:10", breakMinutes: 30 })])
        .assessment.weekends[1].status,
    ).toBe("UNKNOWN");
  });
  it.each([
    { breakStart: 1420, status: "FREE" },
    { breakStart: 1320, status: "OCCUPIED" },
  ])("uses the actual positioned boundary pause ($breakStart)", ({ breakStart, status }) => {
    const specialDuty = validateSpecialDuty({
      ...newSpecialDuty("STANDBY", "21:00", "00:10", "Europe/Berlin"),
      version: 3,
      standbyAgreement: null,
      breakStart,
    })!;
    expect(
      check([
        shift("2026-11-06", {
          startTime: "21:00",
          endTime: "00:10",
          breakMinutes: 30,
          specialDuty,
        }),
      ]).assessment.weekends[1].status,
    ).toBe(status);
  });
  it("counts known on-call binding without asserting statutory working time", () => {
    const specialDuty = {
      ...newSpecialDuty("ON_CALL", "08:00", "16:00", "Europe/Berlin"),
      calloutsComplete: true,
    };
    expect(check([shift("2026-11-07", { specialDuty })]).assessment.weekends[1].status).toBe(
      "OCCUPIED",
    );
  });
  it("keeps unresolved on-call records and missing/all-day work UNKNOWN", () => {
    for (const extra of [
      { specialDuty: newSpecialDuty("ON_CALL", "08:00", "16:00", "Europe/Berlin") },
      { allDay: true },
      { startTime: null },
    ])
      expect(check([shift("2026-11-07", extra)]).assessment.weekends[1].status).toBe("UNKNOWN");
  });
  it("uses the latest revision including tombstones, moved duties and updatedAt ties", () => {
    const old = shift("2026-11-07"),
      deleted = { ...old, revision: 2, deletedAt: "2026-11-08T00:00:00Z" };
    for (const entries of [
      [deleted, old],
      [old, { ...old, revision: 2, date: "2026-11-09" }],
      [old, { ...deleted, revision: 1, updatedAt: "2026-11-09T00:00:00Z" }],
    ])
      expect(check(entries).assessment.weekends[1].status).toBe("FREE");
  });
  it("does not prove FREE from equally ranked contradictory duplicate entries", () => {
    const old = shift("2026-11-07");
    const moved = { ...old, date: "2026-11-09" };
    for (const entries of [
      [old, moved],
      [moved, old],
    ])
      expect(check(entries).assessment.weekends[1]).toMatchObject({
        status: "UNKNOWN",
        reasons: expect.arrayContaining(["INVALID_DUTY"]),
      });
  });
  it("does not call an invalid special-duty duration a free weekend", () => {
    const specialDuty = {
      ...newSpecialDuty("STANDBY", "16:00", "08:00", "Europe/Berlin"),
      endDay: 0,
    };
    expect(
      check([shift("2026-11-07", { startTime: "16:00", endTime: "08:00", specialDuty })]).assessment
        .weekends[1].status,
    ).toBe("UNKNOWN");
  });
  it("counts split parts after midnight and stored-zone binding on Saturday", () => {
    const split = {
      ...newSpecialDuty("SPLIT", "16:00", "20:00", "Europe/Berlin"),
      parts: [{ start: 1410, end: 1530, breakMinutes: 0 }],
    };
    const oncall = {
      ...newSpecialDuty("ON_CALL", "20:00", "22:00", "America/New_York"),
      calloutsComplete: true,
    };
    for (const specialDuty of [split, oncall])
      expect(
        check([
          shift("2026-11-06", {
            specialDuty,
            startTime: specialDuty.kind === "SPLIT" ? "16:00" : "20:00",
            endTime: specialDuty.kind === "SPLIT" ? "20:00" : "22:00",
            breakMinutes: 0,
          }),
        ]).assessment.weekends[1].status,
      ).toBe("OCCUPIED");
  });
  it.each(["2026-03-29", "2026-10-25"])("counts a DST weekend only once (%s)", (date) => {
    expect(
      check(
        [shift(date, { type: "NIGHT", startTime: "00:00", endTime: "06:00" })],
        date.slice(0, 7),
      ).assessment.occupiedCount,
    ).toBe(1);
  });
  it("validates exact counts and four-week fact membership", () => {
    const result = check(saturdays(["2026-11-07", "2026-11-14", "2026-11-28"])),
      facts = result.issues[0].facts!;
    expect(
      validComplianceIssueFacts(
        { ...facts, assessment: { ...result.assessment, freeCount: 999 } },
        "PLANNING_WEEKEND_RECOVERY",
      ),
    ).toBeNull();
    expect(
      validComplianceIssueFacts(
        {
          ...facts,
          assessment: { ...result.assessment, windows: [{ ...last(result), weekends: [] }] },
        },
        "PLANNING_WEEKEND_RECOVERY",
      ),
    ).toBeNull();
  });
  it("rejects contradictory complete status and invalid cached assessment identity", () => {
    const result = check([], "2026-11", { ...complete, allEmploymentWorkRecorded: false });
    expect(validPlanningWeekendAssessment(result.assessment)).toBe(true);
    expect(validPlanningWeekendAssessment({ ...result.assessment, month: "2026-13" })).toBe(false);
    expect(
      validPlanningWeekendAssessment({
        ...result.assessment,
        windows: result.assessment.windows.map((window) => ({
          ...window,
          assessmentComplete: true,
        })),
      }),
    ).toBe(false);
    expect(
      validComplianceIssueFacts(
        { rule: "PLANNING_WEEKEND_RECOVERY", assessment: check([]).assessment },
        "PLANNING_WEEKEND_RECOVERY",
      ),
    ).toBeNull();
  });
  it("yields bounded cooperative batches over a large loaded history", () => {
    const entries = Array.from({ length: 1000 }, (_, n) =>
      shift("2026-11-" + String((n % 28) + 1).padStart(2, "0"), { id: "large-" + n }),
    );
    const steps = checkPlanningWeekendsSteps("2026-11", entries, "Europe/Berlin", complete);
    let previous = -1,
      yielded = 0;
    while (true) {
      const next = steps.next();
      if (next.done) {
        expect(next.value.assessment.occupiedCount).toBe(5);
        break;
      }
      expect(next.value).toBeGreaterThan(previous);
      expect(next.value - previous).toBeLessThanOrEqual(8);
      previous = next.value;
      yielded++;
    }
    expect(yielded).toBeGreaterThan(300);
  });
});
