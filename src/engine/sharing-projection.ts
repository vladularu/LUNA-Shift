import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEntry, ShiftType } from "@/domain/types";
import type { CalendarSharingVisibility, SharedCalendarEntry } from "@/domain/calendar-sharing";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPEARANCE: Readonly<Record<ShiftType, readonly [string, string]>> = {
  EARLY: ["Früh", "sunrise"],
  LATE: ["Spät", "sun"],
  NIGHT: ["Nacht", "moon"],
  DAY: ["Tag", "home"],
  TRAINING: ["Schule", "book"],
  VACATION: ["Nicht verfügbar", "unavailable"],
  SICK: ["Nicht verfügbar", "unavailable"],
  FREE: ["Frei", "star"],
  CUSTOM: ["Dienst", "clock"],
};
export interface SharingProjectionOptions {
  readonly timeZone: string;
  readonly visibility: CalendarSharingVisibility;
  readonly selectedAppointmentIds?: readonly string[];
  readonly publicId: (entry: CalendarEntry) => string;
}
export function projectSharingEntries(
  entries: readonly CalendarEntry[],
  options: SharingProjectionOptions,
): readonly SharedCalendarEntry[] {
  const selected = new Set(options.selectedAppointmentIds ?? []);
  const result: SharedCalendarEntry[] = [];
  for (const entry of entries) {
    if (entry.deletedAt !== null || (entry.kind === "SHIFT" && entry.type === "FREE")) continue;
    if (entry.kind === "APPOINTMENT" && !selected.has(entry.id)) continue;
    const id = options.publicId(entry);
    if (!UUID.test(id)) throw new Error("SHARE_INVALID_PUBLIC_ID");
    const allDay = entry.allDay === true || (entry.startTime === null && entry.endTime === null);
    const day = Temporal.PlainDate.from(entry.date);
    const start = Temporal.PlainTime.from(allDay ? "00:00" : (entry.startTime ?? "00:00"));
    const end = Temporal.PlainTime.from(allDay ? "00:00" : (entry.endTime ?? "00:00"));
    const endDay =
      allDay || Temporal.PlainTime.compare(end, start) <= 0 ? day.add({ days: 1 }) : day;
    const neutral =
      options.visibility === "AVAILABILITY" ||
      (entry.kind === "SHIFT" && ["SICK", "VACATION"].includes(entry.type));
    const [title, symbol] = neutral
      ? ["Nicht verfügbar", "unavailable"]
      : entry.kind === "APPOINTMENT"
        ? ["Termin", "calendar"]
        : APPEARANCE[entry.type];
    result.push(
      Object.freeze({
        id,
        startsAt: day
          .toZonedDateTime({ timeZone: options.timeZone, plainTime: start })
          .toInstant()
          .toString(),
        endsAt: endDay
          .toZonedDateTime({ timeZone: options.timeZone, plainTime: end })
          .toInstant()
          .toString(),
        timeZone: options.timeZone,
        allDay,
        title,
        symbol,
        color: neutral
          ? "#737373"
          : /^#[0-9a-f]{6}$/i.test(entry.color)
            ? entry.color.toUpperCase()
            : "#737373",
      }),
    );
    if (result.length > 10000) throw new Error("SHARE_SNAPSHOT_TOO_LARGE");
  }
  return Object.freeze(result);
}
