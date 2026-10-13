import { describe, expect, it } from "vitest";
import type { CalendarEntry, ShiftEntry } from "@/domain/types";
import { projectSharingEntries } from "@/engine/sharing-projection";
const uuid = "10000000-0000-4000-8000-000000000001";
const shift: ShiftEntry = {
  kind: "SHIFT",
  id: "private-local-id",
  date: "2026-10-24",
  templateId: "private-template",
  title: "Patient Müller",
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
describe("sharing projection privacy and calendar times", () => {
  it("publishes a strict DTO without private titles, IDs, notes, places or salary fields", () => {
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
    expect(entry.title).toBe("Nacht");
    const wire = JSON.stringify(entry);
    for (const secret of [
      "Patient",
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
  it("neutralizes sensitive absences including symbols and colors", () => {
    const [entry] = make([
      { ...shift, type: "SICK", allDay: true, startTime: null, endTime: null },
    ]);
    expect(entry).toMatchObject({
      title: "Nicht verfügbar",
      color: "#737373",
      symbol: "unavailable",
      allDay: true,
    });
  });
  it("does not share free days or deleted records", () =>
    expect(
      make([
        { ...shift, type: "FREE" },
        { ...shift, deletedAt: "2026-10-22" },
      ]),
    ).toEqual([]));
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
