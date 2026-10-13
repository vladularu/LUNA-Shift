import { describe, expect, it } from "vitest";
import type { CalendarEntry, ShiftEntry } from "@/domain/types";
import { projectSharingEntries } from "@/engine/sharing-projection";
const uuid = "10000000-0000-4000-8000-000000000001";
const shift: ShiftEntry = {
  kind: "SHIFT",
  id: "private-local-id",
  date: "2026-10-24",
  templateId: "private-template",
  title: "ND Station 3",
  type: "NIGHT",
  allDay: false,
  startTime: "21:00",
  endTime: "07:30",
  breakMinutes: 60,
  color: "#123456",
  symbol: "moon",
  note: "Private Notiz",
  location: { name: "Private Klinik" } as ShiftEntry["location"],
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
  deletedAt: null,
};
const make = (
  entries: readonly CalendarEntry[],
  visibility: "DETAILS" | "AVAILABILITY" = "DETAILS",
  selected: readonly string[] = [],
) =>
  projectSharingEntries(entries, {
    timeZone: "Europe/Berlin",
    visibility,
    selectedAppointmentIds: selected,
    publicId: () => uuid,
  });
describe("explicit shift sharing and calendar times", () => {
  it("supports appointments-only consent including later appointments and their actual title", () => {
    const appointment = {
      ...shift,
      kind: "APPOINTMENT",
      id: "future",
      title: "Besprechung",
    } as unknown as CalendarEntry;
    const entries = projectSharingEntries([shift, appointment], {
      timeZone: "Europe/Berlin",
      visibility: "DETAILS",
      content: { version: 2, shifts: false, allAppointments: true, notes: false },
      publicId: () => uuid,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "APPOINTMENT", title: "Besprechung", note: null });
    expect(JSON.stringify(entries)).not.toContain("Private Klinik");
  });
  it("keeps note line breaks but strips control characters and still excludes places", () => {
    const entries = projectSharingEntries(
      [{ ...shift, note: "Erste Zeile\nZweite\tZeile\u0001" }],
      {
        timeZone: "Europe/Berlin",
        visibility: "DETAILS",
        content: { version: 2, shifts: true, allAppointments: false, notes: true },
        publicId: () => uuid,
      },
    );
    expect(entries[0].note).toBe("Erste Zeile\nZweite\tZeile");
    expect(JSON.stringify(entries)).not.toContain("Private Klinik");
  });
  it("publishes entered shift titles in a strict DTO without local IDs, notes, places or salary fields", () => {
    const [entry] = make([shift]);
    expect(Object.keys(entry).sort()).toEqual([
      "allDay",
      "color",
      "endsAt",
      "id",
      "startsAt",
      "symbol",
      "timeZone",
      "title",
    ]);
    expect(entry.title).toBe(shift.title);
    const wire = JSON.stringify(entry);
    for (const secret of [
      "private-local",
      "private-template",
      "Private Notiz",
      "Private Klinik",
      "breakMinutes",
      "overtime",
    ])
      expect(wire).not.toContain(secret);
  });
  it("keeps overnight shifts and DST offsets correct", () => {
    const [entry] = make([shift]);
    expect(entry.startsAt).toBe("2026-10-24T19:00:00Z");
    expect(entry.endsAt).toBe("2026-10-25T06:30:00Z");
  });
  it("shares explicitly entered absences with their own title and color", () => {
    const [entry] = make([
      { ...shift, title: "Krank", type: "SICK", allDay: true, startTime: null, endTime: null },
    ]);
    expect(entry).toMatchObject({
      title: "Krank",
      color: shift.color,
      symbol: shift.symbol,
      allDay: true,
    });
  });
  it("shares vacation and free days but excludes deleted records", () => {
    const rows = make([
      { ...shift, type: "VACATION", title: "Urlaub" },
      { ...shift, type: "FREE", title: "Frei" },
      { ...shift, deletedAt: "2026-10-22" },
    ]);
    expect(rows.map((row) => row.title)).toEqual(["Urlaub", "Frei"]);
  });
  it("only shares explicitly selected appointments, always with a neutral public title", () => {
    const appointment = {
      ...shift,
      kind: "APPOINTMENT",
      id: "appointment-private",
      title: "Arzt privat",
      recurrence: null,
    } as unknown as CalendarEntry;
    expect(make([appointment])).toEqual([]);
    expect(make([appointment], "DETAILS", ["appointment-private"])[0].title).toBe("Termin");
  });
  it("availability contains no shift type, private color or symbol", () =>
    expect(make([shift], "AVAILABILITY")[0]).toMatchObject({
      title: "Nicht verfügbar",
      color: "#737373",
      symbol: "unavailable",
    }));
  it("handles empty calendars", () => expect(make([])).toEqual([]));
  it("rejects invalid public IDs instead of exposing local IDs", () =>
    expect(() =>
      projectSharingEntries([shift], {
        timeZone: "Europe/Berlin",
        visibility: "DETAILS",
        publicId: () => shift.id,
      }),
    ).toThrow());
});
