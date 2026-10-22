import { describe, expect, it } from "vitest";
import type { SharedCalendarEntry } from "@/domain/calendar-sharing";
import { sharingProjectionSignature } from "./sharing-publication-confirmation";
const entry: SharedCalendarEntry = {
  id: "id",
  startsAt: "2026-10-24T19:00:00Z",
  endsAt: "2026-10-25T06:30:00Z",
  timeZone: "Europe/Berlin",
  allDay: false,
  title: "Nacht",
  color: "#123456",
  symbol: "moon",
};
describe("publication confirmation projection", () => {
  it("is independent of later public ID assignment and source ordering", () => {
    const second = { ...entry, id: "other", title: "Termin" };
    expect(sharingProjectionSignature([entry, second])).toBe(
      sharingProjectionSignature([
        { ...second, id: "assigned" },
        { ...entry, id: "assigned-2" },
      ]),
    );
  });
  it("changes when any actually shared value or entry changes", () => {
    for (const patch of [
      { startsAt: "2026-10-24T20:00:00Z" },
      { endsAt: "2026-10-25T07:30:00Z" },
      { timeZone: "UTC" },
      { allDay: true },
      { title: "Termin" },
      { color: "#654321" },
      { symbol: "calendar" },
      { breakMinutes: 30 },
    ])
      expect(sharingProjectionSignature([{ ...entry, ...patch }])).not.toBe(
        sharingProjectionSignature([entry]),
      );
    expect(sharingProjectionSignature([entry, entry])).not.toBe(
      sharingProjectionSignature([entry]),
    );
  });
});
