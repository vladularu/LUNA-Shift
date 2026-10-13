import type { SharedCalendarEntry } from "@/domain/calendar-sharing";

/** Public IDs may be assigned later; every actually shared field remains bound. */
export function sharingProjectionSignature(entries: readonly SharedCalendarEntry[]): string {
  return JSON.stringify(
    entries
      .map((entry) =>
        JSON.stringify([
          entry.startsAt,
          entry.endsAt,
          entry.timeZone,
          entry.allDay,
          entry.title,
          entry.color,
          entry.symbol,
          entry.kind ?? null,
          entry.note ?? null,
        ]),
      )
      .sort(),
  );
}
