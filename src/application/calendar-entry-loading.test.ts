import { describe, expect, it } from "vitest";
import {
  calendarRangeCoversMonth,
  calendarRangeCoversYear,
  reconcileCalendarRange,
  retainCalendarRanges,
} from "@/application/calendar-entry-loading";
import type { Appointment } from "@/domain/types";

const range = { startDate: "2026-01-01", endDate: "2028-12-31" };
const entry: Appointment = {
  id: "one",
  kind: "APPOINTMENT",
  title: "Termin",
  date: "2027-01-01",
  allDay: true,
  startTime: null,
  endTime: null,
  color: "#888888",
  note: null,
  revision: 1,
  createdAt: "2027-01-01T00:00:00Z",
  updatedAt: "2027-01-01T00:00:00Z",
  deletedAt: null,
};

describe("calendar range loading", () => {
  it("bounds completed windows while protecting the already loaded current year", () => {
    const current = { startDate: "2025-01-01", endDate: "2027-12-31" };
    let ranges = [current];
    for (const year of [2030, 2034, 2038, 2042])
      ranges = retainCalendarRanges(
        ranges,
        { startDate: `${year - 1}-01-01`, endDate: `${year + 1}-12-31` },
        2026,
      );
    expect(ranges).toHaveLength(3);
    expect(ranges).toContainEqual(current);
    expect(ranges.map((item) => item.startDate)).toEqual([
      "2025-01-01",
      "2037-01-01",
      "2041-01-01",
    ]);
  });
  it("retains other completed windows but keeps fresh query rows authoritative and local deletions gone", () => {
    const old = { ...entry, id: "old", date: "2025-06-01" };
    const recent = { ...entry, id: "recent" };
    const fresh = { ...recent, title: "Fresh SQL", revision: 2 };
    const keep = [{ startDate: "2025-01-01", endDate: "2027-12-31" }];
    expect(
      reconcileCalendarRange([fresh], [old, recent], [old, recent], range, new Set(), keep),
    ).toEqual([old, fresh]);
    expect(
      reconcileCalendarRange(
        [fresh],
        [old, recent],
        [recent],
        range,
        new Set(["APPOINTMENT:old"]),
        keep,
      ),
    ).toEqual([fresh]);
    const changed = { ...old, title: "Edited outside active range" };
    expect(
      reconcileCalendarRange([fresh], [old, recent], [changed, recent], range, new Set(), keep),
    ).toEqual([changed, fresh]);
    expect(reconcileCalendarRange([fresh], [old, recent], [changed, recent], range)).toEqual([
      fresh,
    ]);
  });
  it("requires coverage of adjacent grid days, not only the month itself", () => {
    expect(calendarRangeCoversMonth(null, "2027-01")).toBe(false);
    expect(calendarRangeCoversMonth(range, "2027-01")).toBe(true);
    expect(calendarRangeCoversMonth(range, "2026-01")).toBe(false);
    expect(calendarRangeCoversMonth(range, "2028-12")).toBe(false);
  });
  it("keeps a complete year available while the surrounding range refreshes", () => {
    expect(calendarRangeCoversYear(null, 2027)).toBe(false);
    expect(calendarRangeCoversYear(range, 2027)).toBe(true);
    expect(calendarRangeCoversYear(range, 2025)).toBe(false);
    expect(calendarRangeCoversYear(range, 2029)).toBe(false);
  });
  it("preserves additions and edits but bounds moved entries and recurring series correctly", () => {
    const changed = { ...entry, title: "Bearbeitet", revision: 2 };
    const added = { ...entry, id: "two", date: "2027-02-01" };
    expect(reconcileCalendarRange([entry], [entry], [added, changed], range)).toEqual([
      changed,
      added,
    ]);
    const moved = { ...changed, date: "2025-01-01" };
    expect(reconcileCalendarRange([entry], [entry], [moved], range)).toEqual([]);
    const series: Appointment = { ...moved, recurrence: { frequency: "WEEK", interval: 1 } };
    expect(reconcileCalendarRange([entry], [entry], [series], range)).toEqual([series]);
  });
  it("does not resurrect an entry created and deleted while a read was pending", () => {
    expect(reconcileCalendarRange([entry], [], [], range, new Set(["APPOINTMENT:one"]))).toEqual(
      [],
    );
    expect(
      reconcileCalendarRange([entry], [], [entry], range, new Set(["APPOINTMENT:one"])),
    ).toEqual([entry]);
  });
});
