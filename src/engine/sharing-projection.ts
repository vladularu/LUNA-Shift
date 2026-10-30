import { DUTY_LABELS } from "@/domain/special-duty";
import { projectDutyWork } from "./special-duty";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEntry, ShiftType } from "@/domain/types";
import type { CalendarSharingVisibility, SharedCalendarEntry } from "@/domain/calendar-sharing";
import type { SharingSourceContent } from "@/domain/sharing-content";
import { calculateTimedShiftBounds } from "./working-time";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPEARANCE: Readonly<Record<ShiftType, readonly [string, string]>> = {
  EARLY: ["Früh", "sunrise"],
  LATE: ["Spät", "sun"],
  NIGHT: ["Nacht", "moon"],
  DAY: ["Tag", "home"],
  TRAINING: ["Schule", "book"],
  VACATION: ["Urlaub", "star"],
  SICK: ["Krank", "unavailable"],
  FREE: ["Frei", "star"],
  CUSTOM: ["Dienst", "clock"],
};
export interface SharingProjectionOptions {
  readonly content?: SharingSourceContent;
  readonly timeZone: string;
  readonly visibility: CalendarSharingVisibility;
  readonly selectedAppointmentIds?: readonly string[];
  readonly publicId: (entry: CalendarEntry) => string;
}
export function projectSharingEntries(
  entries: readonly CalendarEntry[],
  options: SharingProjectionOptions,
): readonly SharedCalendarEntry[] {
  entries = entries.flatMap((entry): CalendarEntry[] => {
    if (entry.kind !== "SHIFT" || !entry.specialDuty) return [entry];
    if (entry.specialDuty.kind === "SPLIT")
      return projectDutyWork(entry).map((part, index) => ({
        ...part,
        id: index === 0 ? entry.id : `${entry.id}:part:${index}`,
        title: "Geteilter Dienst",
      }));
    return [{ ...entry, title: DUTY_LABELS[entry.specialDuty.kind] }];
  });
  const selected = new Set(options.selectedAppointmentIds ?? []);
  const result: SharedCalendarEntry[] = [];
  for (const entry of entries) {
    if (
      entry.deletedAt !== null ||
      (options.visibility === "AVAILABILITY" && entry.kind === "SHIFT" && entry.type === "FREE")
    )
      continue;
    if (entry.kind === "SHIFT" && options.content?.shifts === false) continue;
    if (
      entry.kind === "APPOINTMENT" &&
      !options.content?.allAppointments &&
      !selected.has(entry.id)
    )
      continue;
    const id = options.publicId(entry);
    if (!UUID.test(id)) throw new Error("SHARE_INVALID_PUBLIC_ID");
    const allDay = entry.allDay === true || (entry.startTime === null && entry.endTime === null);
    const day = Temporal.PlainDate.from(entry.date);
    const start = Temporal.PlainTime.from(allDay ? "00:00" : (entry.startTime ?? "00:00"));
    const end = Temporal.PlainTime.from(allDay ? "00:00" : (entry.endTime ?? "00:00"));
    const endDay =
      allDay || Temporal.PlainTime.compare(end, start) <= 0 ? day.add({ days: 1 }) : day;
    const neutral = options.visibility === "AVAILABILITY";
    const bounds =
      entry.kind === "SHIFT" ? calculateTimedShiftBounds(entry, options.timeZone) : null;
    const appearance =
      entry.kind === "APPOINTMENT" ? ["Termin", "calendar"] : APPEARANCE[entry.type];
    const title = neutral
      ? "Nicht verfügbar"
      : entry.kind === "APPOINTMENT"
        ? options.content
          ? entry.title
              .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
              .trim()
              .slice(0, 128) || "Termin"
          : "Termin"
        : entry.title
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
            .trim()
            .slice(0, 128) || appearance[0];
    const symbols = [
      "calendar",
      "sunrise",
      "sun",
      "moon",
      "home",
      "book",
      "clock",
      "star",
      "unavailable",
    ];
    const symbol = neutral
      ? "unavailable"
      : entry.kind === "SHIFT" && symbols.includes(entry.symbol)
        ? entry.symbol
        : appearance[1];
    result.push(
      Object.freeze({
        ...(options.content
          ? {
              kind: entry.kind,
              note:
                !neutral && options.content.notes
                  ? entry.note
                      ?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
                      .slice(0, 4096) || null
                  : null,
            }
          : {}),
        id,
        breakMinutes: !neutral && bounds && entry.kind === "SHIFT" ? entry.breakMinutes : null,
        startsAt: bounds
          ? Temporal.Instant.fromEpochMilliseconds(bounds.startEpochMinutes * 60_000).toString()
          : day
              .toZonedDateTime({ timeZone: options.timeZone, plainTime: start })
              .toInstant()
              .toString(),
        endsAt: bounds
          ? Temporal.Instant.fromEpochMilliseconds(bounds.endEpochMinutes * 60_000).toString()
          : endDay
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
