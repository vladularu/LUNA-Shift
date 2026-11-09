import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { ShiftEntry } from "@/domain/types";
import { calculateMonthlyCompliance, calculateMonthlyComplianceSteps } from "./compliance";
import { newSpecialDuty } from "@/domain/special-duty";

const shift = (change: Partial<ShiftEntry> = {}): ShiftEntry => ({
  kind: "SHIFT",
  id: "next",
  templateId: null,
  date: "2026-11-08",
  title: "Dienst",
  type: "DAY",
  startTime: "06:00",
  endTime: "14:00",
  breakMinutes: 0,
  color: "#227766",
  symbol: "D",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  deletedAt: null,
  ...change,
});

function nights(count: number, first = "2026-11-05") {
  return Array.from({ length: count }, (_, index) => {
    const date = Temporal.PlainDate.from(first).add({ days: index }).toString();
    return shift({
      id: `night-${date}`,
      date,
      type: "NIGHT",
      startTime: "22:00",
      endTime: "06:00",
    });
  });
}

function calculate(
  entries: readonly ShiftEntry[],
  recorded: boolean | null = true,
  month = "2026-11",
) {
  return calculateMonthlyCompliance(month, entries, "Europe/Berlin", {
    allEmploymentWorkRecorded: recorded,
    regularRotatingNightWork: true,
    referenceDate: "2026-11-07",
  });
}

const nightIssues = (
  entries: readonly ShiftEntry[],
  recorded: boolean | null = true,
  month?: string,
) =>
  calculate(entries, recorded, month).issues.filter((item) =>
    ["PLANNING_NIGHT_SERIES", "PLANNING_NIGHT_RECOVERY"].includes(item.rule),
  );

describe("scientific night sequences and recovery", () => {
  it.each([
    ["2026-03-26", "2026-03-29", "2026-03"],
    ["2026-10-22", "2026-10-25", "2026-10"],
  ])(
    "does not invent an instant for a missing or repeated local clock at %s",
    (first, date, month) => {
      expect(
        nightIssues([...nights(2, first), shift({ date, startTime: "02:30" })], true, month),
      ).toEqual([]);
    },
  );

  it("does not prove a fourth night from an ambiguous clock", () => {
    const entries = nights(4, "2026-10-21").map((entry) =>
      entry.date === "2026-10-24" ? { ...entry, endTime: "02:30" } : entry,
    );
    expect(nightIssues(entries, true, "2026-10")).toEqual([]);
  });
  it("returns identical recovery findings from incremental and direct calculation", () => {
    const entries = [...nights(4, "2026-11-03"), shift({ startTime: "05:59" })];
    const steps = calculateMonthlyComplianceSteps("2026-11", entries, "Europe/Berlin", {
      allEmploymentWorkRecorded: true,
      regularRotatingNightWork: true,
      referenceDate: "2026-11-07",
    });
    let step = steps.next();
    while (!step.done) step = steps.next();
    expect(step.value).toEqual(calculate(entries));
  });

  it("treats two calendar days across spring DST as 47 elapsed hours", () => {
    expect(
      nightIssues([...nights(2, "2026-03-26"), shift({ date: "2026-03-30" })], true, "2026-03")[0]
        .facts,
    ).toMatchObject({ nightSequence: { restMinutes: 2820, recoveryStatus: "under48" } });
  });

  it("treats two calendar days across autumn DST as 49 elapsed hours", () => {
    expect(
      nightIssues([...nights(2, "2026-10-22"), shift({ date: "2026-10-26" })], true, "2026-10"),
    ).toEqual([]);
  });
  it("keeps a year-boundary sequence intact", () => {
    expect(nightIssues(nights(4, "2026-12-29"), true, "2027-01")[0]).toMatchObject({
      date: "2027-01-01",
      facts: { count: 4 },
    });
  });

  it("uses the first following work assignment even when later time is free", () => {
    const entries = [
      ...nights(2),
      shift({
        id: "training",
        date: "2026-11-07",
        type: "TRAINING",
        startTime: "18:00",
        endTime: "22:00",
      }),
      shift({ date: "2026-11-10" }),
    ];
    expect(nightIssues(entries)[0].facts).toMatchObject({
      nightSequence: { restMinutes: 720, nextShiftId: "training" },
    });
  });

  it("measures to the end of the whole last night duty", () => {
    expect(
      nightIssues([...nights(2).map((entry) => ({ ...entry, endTime: "07:30" })), shift()])[0]
        .facts,
    ).toMatchObject({ nightSequence: { restMinutes: 1350 } });
  });

  it("does not assume that an on-call period is unrestricted recovery", () => {
    const onCall = shift({
      id: "on-call",
      date: "2026-11-07",
      startTime: "12:00",
      endTime: "20:00",
      specialDuty: newSpecialDuty("ON_CALL", "12:00", "20:00", "Europe/Berlin"),
    });
    expect(nightIssues([...nights(2), onCall, shift()])).toEqual([]);
  });

  it("does not close a series on a night with uncertain pause allocation", () => {
    const uncertain = shift({
      id: "uncertain",
      date: "2026-11-07",
      startTime: "22:00",
      endTime: "01:10",
      breakMinutes: 30,
    });
    expect(nightIssues([...nights(2), uncertain, shift()])).toEqual([]);
  });

  it("does not manufacture recovery from overlapping duties", () => {
    const findings = nightIssues([
      ...nights(4, "2026-11-01"),
      shift({ date: "2026-11-05", startTime: "05:30", endTime: "13:00" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].facts).toMatchObject({
      nightSequence: { recoveryStatus: "unknown", restMinutes: null },
    });
  });
  it.each([1, 2, 3])(
    "does not flag a sequence of %i nights without a known recovery deficit",
    (count) => {
      expect(nightIssues(nights(count))).toEqual([]);
    },
  );

  it("starts at the fourth actual night, retaining an open recovery state", () => {
    const findings = nightIssues(nights(4));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "PLANNING",
      rule: "PLANNING_NIGHT_SERIES",
      facts: { count: 4, nightSequence: { recoveryStatus: "open", policyVersion: "2026-11-07" } },
    });
  });

  it.each([
    ["2026-11-08", "05:59", "under24", 1439],
    ["2026-11-08", "06:00", "under48", 1440],
    ["2026-11-09", "05:59", "under48", 2879],
  ])("uses the exact recovery boundary at %s %s", (date, startTime, status, minutes) => {
    const findings = nightIssues([...nights(2), shift({ date, startTime })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "PLANNING",
      rule: "PLANNING_NIGHT_RECOVERY",
      facts: { count: 2, nightSequence: { recoveryStatus: status, restMinutes: minutes } },
    });
    expect(findings[0].description).toContain(
      `${Math.floor(Number(minutes) / 60)}:${String(Number(minutes) % 60).padStart(2, "0")} h`,
    );
  });

  it("does not declare recovery or a violation at exactly 48 hours", () => {
    expect(nightIssues([...nights(2), shift({ date: "2026-11-09" })])).toEqual([]);
  });

  it("keeps isolated nights outside the recovery rule", () => {
    expect(
      nightIssues([
        ...nights(1),
        shift({ date: "2026-11-06", startTime: "18:00", endTime: "22:00" }),
      ]),
    ).toEqual([]);
  });

  it("combines a long sequence and short recovery in one finding", () => {
    const findings = nightIssues([
      ...nights(6, "2026-11-01"),
      shift({ date: "2026-11-08", startTime: "05:59" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "PLANNING_NIGHT_SERIES",
      facts: { count: 6, nightSequence: { recoveryStatus: "under24", restMinutes: 1439 } },
    });
  });

  it("measures from the last night, never from an intermediate night", () => {
    const findings = nightIssues([...nights(3), shift({ date: "2026-11-09", startTime: "05:59" })]);
    expect(findings).toHaveLength(1);
    expect(findings[0].facts).toMatchObject({ count: 3, nightSequence: { restMinutes: 1439 } });
  });

  it.each([null, false])(
    "does not infer free time with incomplete employment evidence (%s)",
    (recorded) => {
      expect(nightIssues([...nights(2), shift()], recorded)).toEqual([]);
      expect(
        nightIssues([...nights(4), shift({ date: "2026-11-10" })], recorded)[0].facts,
      ).toMatchObject({
        nightSequence: { recoveryStatus: "unknown", restMinutes: null },
      });
    },
  );

  it("does not ignore an intervening work entry with missing times", () => {
    expect(
      nightIssues([
        ...nights(2),
        shift({ id: "missing", date: "2026-11-07", startTime: null, endTime: null }),
        shift(),
      ]),
    ).toEqual([]);
  });

  it("counts actual night windows regardless of shift labels or midnight start dates", () => {
    const entries = nights(4, "2026-11-02").map((item) => ({
      ...item,
      type: "CUSTOM" as const,
      startTime: "01:00",
      endTime: "07:00",
    }));
    expect(nightIssues(entries)[0].facts).toMatchObject({
      count: 4,
      nightSequence: { firstNight: "2026-11-01", lastNight: "2026-11-04" },
    });
  });

  it("aggregates split work within one night without counting two nights", () => {
    const entries = nights(4).flatMap((item) => [
      { ...item, id: `${item.id}-a`, startTime: "23:00", endTime: "23:59" },
      {
        ...item,
        id: `${item.id}-b`,
        date: Temporal.PlainDate.from(item.date).add({ days: 1 }).toString(),
        startTime: "00:00",
        endTime: "01:02",
      },
    ]);
    expect(nightIssues(entries)[0].facts).toMatchObject({ count: 4 });
  });

  it.each([
    ["01:00", 0],
    ["01:01", 1],
  ])("requires more than 120 night minutes (end %s)", (endTime, count) => {
    expect(
      nightIssues(nights(4).map((item) => ({ ...item, startTime: "23:00", endTime }))),
    ).toHaveLength(count);
  });

  it("deduplicates identical work intervals", () => {
    expect(
      nightIssues(nights(4).flatMap((item) => [item, { ...item, id: `${item.id}-duplicate` }]))[0]
        .facts,
    ).toMatchObject({ count: 4 });
  });

  it("does not use an uncertain pause allocation to prove a night", () => {
    expect(
      nightIssues(
        nights(4).map((item) => ({
          ...item,
          startTime: "22:00",
          endTime: "01:10",
          breakMinutes: 30,
        })),
      ),
    ).toEqual([]);
  });

  it.each([
    ["2026-03-26", "2026-03-29", "2026-03", 1380, "under24"],
    ["2026-10-22", "2026-10-25", "2026-10", 1500, "under48"],
  ])("uses elapsed time at DST transitions from %s", (first, date, month, minutes, status) => {
    expect(nightIssues([...nights(2, first), shift({ date })], true, month)[0].facts).toMatchObject(
      {
        nightSequence: { restMinutes: minutes, recoveryStatus: status },
      },
    );
  });

  it("anchors one cross-month sequence on its fourth night", () => {
    const entries = nights(6, "2026-11-28");
    expect(nightIssues(entries, true, "2026-11")).toEqual([]);
    expect(nightIssues(entries, true, "2026-12")).toHaveLength(1);
    expect(nightIssues(entries, true, "2026-12")[0]).toMatchObject({
      date: "2026-12-01",
      facts: { count: 6 },
    });
  });

  it("does not introduce adult recovery rules into the youth check", () => {
    const result = calculateMonthlyCompliance("2026-11", [...nights(2), shift()], "Europe/Berlin", {
      youthProtection: true,
      allEmploymentWorkRecorded: true,
    });
    expect(result.issues.some((item) => item.rule === "PLANNING_NIGHT_RECOVERY")).toBe(false);
  });
});
