import { describe, expect, it } from "vitest";
import { calendarPageWindow, prepareCalendarPages } from "./calendar-page-window";
import { createMonthWindow } from "./month-window";

describe("prepared calendar destinations", () => {
  const months = createMonthWindow("2026-09", 24, 36);

  it("retains ready neighbours and adds only the selected distant destination", () => {
    const initial = prepareCalendarPages(calendarPageWindow("a", "2026-09", months), months);
    expect(initial.prepared).toHaveLength(5);
    const same = calendarPageWindow("b", "2026-09", months, initial.prepared);
    expect(same.prepared).toEqual(initial.prepared);
    const distant = calendarPageWindow("c", "2026-01", months, same.prepared);
    expect(distant.prepared).toEqual(["2026-01"]);
    const prepared = prepareCalendarPages(distant, months);
    expect(prepared.prepared).toEqual(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(prepareCalendarPages(prepared, months)).toBe(prepared);
  });

  it("stays bounded through forward and reverse year boundaries and rapid unprepared jumps", () => {
    let window = calendarPageWindow("a", "2026-09", months);
    for (const center of ["2026-11", "2027-01", "2026-12", "2026-01", "2026-03"]) {
      const previous = window.prepared;
      window = calendarPageWindow(center, center, months, previous);
      expect(window.prepared).toContain(center);
      expect(window.prepared.filter((month) => !previous.includes(month))).toEqual([center]);
      expect(window.prepared.length).toBeLessThanOrEqual(5);
    }
    window = prepareCalendarPages(window, months);
    expect(window.prepared).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
  });
});
