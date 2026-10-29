import { describe, expect, it } from "vitest";
import { calendarPrototypeLayout, prototypeShift } from "./calendar-prototype-layout";

describe("prototype shared calendar coordinates", () => {
  it.each([2024, 2026, 2027, 2030])("contains every date in %s without measurements", (year) => {
    for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const layout = calendarPrototypeLayout(key, 430, 640);
      expect(layout.days.length).toBe(new Date(year, month, 0).getDate());
      expect(new Set(layout.days.map((day) => day.date)).size).toBe(layout.days.length);
      for (const day of layout.days) {
        expect(day.fromX).toBeGreaterThan(0);
        expect(day.fromX).toBeLessThan(430);
        expect(day.fromY).toBeGreaterThan(0);
        expect(day.fromY).toBeLessThan(640);
        expect(day.toX).toBeGreaterThan(0);
        expect(day.toX).toBeLessThan(430);
        expect(day.toY).toBeGreaterThan(0);
        expect(day.toY).toBeLessThan(640);
      }
      expect(calendarPrototypeLayout(key, 430, 640)).toEqual(layout);
    }
  });
  it.each([84, 154, 210])(
    "preserves month and year geometry with a scrolling header of %s",
    (inset) => {
      for (const month of ["2026-02", "2026-08", "2026-12", "2027-01"]) {
        const previous = calendarPrototypeLayout(month, 430, 640);
        const page = calendarPrototypeLayout(month, 430, 640 + inset, inset);
        expect(page.weekHeight).toBe(previous.weekHeight);
        expect(page.tile).toEqual({ ...previous.tile, y: previous.tile.y + inset });
        page.days.forEach((day, index) => {
          expect(day.fromY - inset).toBeCloseTo(previous.days[index].fromY);
          expect(day.toY - inset).toBeCloseTo(previous.days[index].toY);
        });
        const cells = [...page.days, ...page.adjacentDays];
        expect(Math.max(...cells.map((day) => day.toY - 20 + page.weekHeight))).toBeCloseTo(
          640 + inset,
        );
      }
    },
  );
  it("recalculates coordinates after a viewport change", () => {
    const first = calendarPrototypeLayout("2026-01", 430, 640);
    const resized = calendarPrototypeLayout("2026-01", 390, 580);
    expect(resized.days[0].toX).not.toBe(first.days[0].toX);
    expect(resized.weekHeight).not.toBe(first.weekHeight);
  });
  it("keeps boundary dates out of the moving year glyphs, including leap years", () => {
    for (const month of ["2024-02", "2026-01", "2026-12", "2027-01"]) {
      const layout = calendarPrototypeLayout(month, 430, 640);
      const cells = [...layout.days, ...layout.adjacentDays];
      expect(cells.length % 7).toBe(0);
      expect(new Set(cells.map((cell) => cell.date)).size).toBe(cells.length);
      expect(layout.adjacentDays.every((cell) => !cell.date.startsWith(month))).toBe(true);
      expect(layout.days.every((cell) => cell.date.startsWith(month))).toBe(true);
      expect(layout.adjacentDays.every((cell) => cell.toY > 0 && cell.toY < 640)).toBe(true);
    }
    expect(
      calendarPrototypeLayout("2026-01", 430, 640).adjacentDays.map((cell) => cell.date),
    ).toContain("2025-12-31");
  });
  it("uses fixed fixtures rather than user records", () => {
    expect(prototypeShift(1)?.title).toBe("Früh");
    expect(prototypeShift(3)?.title).toBe("Nacht");
    expect(prototypeShift(5)).toBeNull();
  });
});
