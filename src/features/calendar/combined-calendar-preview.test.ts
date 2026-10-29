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
  const appointments = Array.from(
    { length: 8 },
    (_, index) =>
      ({
        kind: "APPOINTMENT",
        id: `appointment-${index}`,
        title: "Ohne Titel",
      }) as CalendarEntry,
  );

  it("fits one service and two appointment lines in the two service heights", () => {
    const preview = combinedCalendarPreview([own, ...appointments.slice(0, 2)], [], 100, true);
    expect(preview.rows).toHaveLength(3);
    expect(preview.overflowCount).toBe(0);
    expect(preview.heights[0]).toBe(preview.heights[1] + preview.heights[2]);
    expect(preview.gaps[1]).toBeGreaterThanOrEqual(3);
    expect(preview.gaps[2]).toBe(0);
  });

  it("fits four appointment lines and returns only hidden entries for the overflow dots", () => {
    const preview = combinedCalendarPreview(appointments, [], 100, true);
    expect(preview.rows).toHaveLength(4);
    expect(preview.hiddenRows).toEqual(
      appointments.slice(4).map((entry) => ({ kind: "own", entry })),
    );
    expect(preview.overflowCount).toBe(4);
  });

  it("fits two own appointments beneath a shared service even in a short six-week month", () => {
    const { weekHeight } = calendarPrototypeLayout("2026-03", 390, 500);
    const preview = combinedCalendarPreview(appointments.slice(0, 2), [shared], weekHeight, true);
    expect(preview.rows.map((row) => row.kind)).toEqual(["shared", "own", "own"]);
    expect(preview.overflowCount).toBe(0);
    expect(preview.headerHeight + preview.usedHeight + 2).toBeLessThanOrEqual(weekHeight);
  });

  it("treats a shared appointment as one line while retaining own/shared priority", () => {
    const sharedAppointment = {
      ...shared,
      entry: { ...shared.entry, kind: "APPOINTMENT" as const },
    };
    const preview = combinedCalendarPreview([own, appointments[0]], [sharedAppointment], 100, true);
    expect(preview.rows.map((row) => row.kind)).toEqual(["own", "shared", "own"]);
    expect(preview.heights[1]).toBe(preview.lineHeight);
    expect(preview.overflowCount).toBe(0);
  });

  it.each([240, 390, 500, 540, 650, 760])(
    "bounds mixed entries at viewport height=%s",
    (height) => {
      for (const month of ["2026-02", "2026-03", "2026-10"]) {
        const { weekHeight } = calendarPrototypeLayout(month, 390, height);
        for (const detailed of [false, true]) {
          const preview = combinedCalendarPreview(
            [own, ...appointments],
            [shared],
            weekHeight,
            detailed,
          );
          expect(preview.headerHeight + preview.usedHeight + 2).toBeLessThanOrEqual(weekHeight);
          expect(preview.rows.length + preview.hiddenRows.length).toBe(10);
          expect(preview.overflowCount).toBe(preview.hiddenRows.length);
        }
      }
    },
  );

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
