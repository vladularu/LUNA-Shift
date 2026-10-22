import { addMonths, createMonthGrid } from "@/engine/calendar";
import { it, expect } from "vitest";
import { calendarMonthRows, calendarDataMonths } from "./calendar-render-data";
it("retains unchanged month data when another month changes, but exposes updates/deletions in grid edge days", () => {
  const oldRow = { id: "a", title: "Früh", revision: 1 };
  const initial = calendarMonthRows(new Map(), new Map([["2026-10-01", [oldRow]]]), "2026-10");
  const unrelated = new Map([
    ["2026-10-01", [{ ...oldRow }]],
    ["2026-12-01", [{ ...oldRow, id: "b" }]],
  ]);
  expect(calendarMonthRows(initial, unrelated, "2026-10")).toBe(initial);
  const edge = new Map(unrelated).set("2026-09-30", [{ ...oldRow, id: "edge" }]);
  const next = calendarMonthRows(initial, edge, "2026-10");
  expect(next).not.toBe(initial);
  expect(next.get("2026-10-01")).toBe(initial.get("2026-10-01"));
  expect(next.has("2026-09-30")).toBe(true);
  expect(calendarMonthRows(next, new Map(), "2026-10").size).toBe(0);
});

it("covers every prepared own month and its edge days across both year boundaries", () => {
  for (const year of ["2026", "2027"]) {
    const data = calendarDataMonths(year);
    const first = createMonthGrid(data[0])[0].date;
    const last = createMonthGrid(data.at(-1)!).at(-1)!.date;
    for (let m = 1; m <= 12; m++) {
      const center = year + "-" + String(m).padStart(2, "0");
      const requiredFirst = createMonthGrid(addMonths(center, -2))[0].date;
      const requiredLast = createMonthGrid(addMonths(center, 2)).at(-1)!.date;
      expect(first <= requiredFirst).toBe(true);
      expect(last >= requiredLast).toBe(true);
    }
  }
});
