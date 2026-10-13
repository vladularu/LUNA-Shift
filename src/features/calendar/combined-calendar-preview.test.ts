import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "@/domain/types";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import { combinedCalendarPreview } from "./combined-calendar-preview";
import { calendarPrototypeLayout } from "./calendar-prototype-layout";

const own = { kind: "SHIFT", id: "own", title: "Spät" } as CalendarEntry;
const shared = {
  calendarId: "shared",
  entry: { id: "foreign", title: "Nacht" },
} as SharedCalendarDayEntry;
describe("own and shared calendar rows", () => {
  it.each([500, 550, 600, 650])(
    "keeps both services below the date in a six-week viewport of %s",
    (height) => {
      const layout = calendarPrototypeLayout("2026-03", 390, height);
      const preview = combinedCalendarPreview([own], [shared], layout.weekHeight, true);
      expect(preview.rows.map((row) => row.kind)).toEqual(["own", "shared"]);
      expect(preview.overflowCount).toBe(0);
      expect(preview.headerHeight + preview.lineHeight * 4 + 1).toBeLessThanOrEqual(
        layout.weekHeight,
      );
    },
  );
  it("puts dense overflow beside the date instead of removing the first own service", () => {
    const preview = combinedCalendarPreview(
      [own, { ...own, id: "own2" }],
      [shared, { ...shared, entry: { ...shared.entry, id: "foreign2" } }],
      85,
      true,
    );
    expect(preview.rows.map((row) => row.kind)).toEqual(["own", "shared"]);
    expect(preview.overflowCount).toBe(2);
  });
});

it.each([500, 550, 600, 650])(
  "keeps header and row geometry unchanged when filtering services at height=%s",
  (height) => {
    const week = calendarPrototypeLayout("2026-03", 390, height).weekHeight;
    const off = combinedCalendarPreview([own], [], week, true),
      on = combinedCalendarPreview([own], [shared], week, true),
      empty = combinedCalendarPreview([], [], week, true);
    expect(on.headerHeight).toBe(off.headerHeight);
    expect(on.lineHeight).toBe(off.lineHeight);
    expect(empty.lineHeight).toBe(off.lineHeight);
    expect(
      combinedCalendarPreview([own, { ...own, id: "extra" }], [shared], week, true).lineHeight,
    ).toBe(off.lineHeight);
  },
);
