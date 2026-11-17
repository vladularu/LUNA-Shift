import { dutyCalendarDates } from "@/engine/special-duty";
import { Temporal } from "@js-temporal/polyfill";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import {
  sharedCalendarDays,
  SHARED_CALENDAR_CACHE_MAX_AGE,
} from "@/features/calendar/shared-calendar-display";

import type { CalendarEntry, CalendarPreferencesData, ShiftEntry } from "@/domain/types";
import { calendarShiftDetail } from "@/features/calendar/calendar-display";
import { sharedShiftDetail } from "@/features/calendar/shared-shift-detail";
import { calendarImageOverlayOpacity, type CalendarImageStrength } from "@/theme/calendar-image";
import type { AppearanceMode } from "@/domain/appearance";
import { CALENDAR_METRICS } from "@/theme/tokens";
import { compareCalendarEntries } from "@/engine/calendar-entry-order";
import {
  calendarChipPalette,
  readableTextColor,
  sharedCalendarChipPalette,
} from "@/theme/color-contrast";
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from "@/theme/palette-values";
import { calendarDayTints } from "@/theme/calendar-day-tints";

export interface WidgetShift {
  readonly ownerName?: string;
  readonly ownerColor?: string;
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly nextDay: boolean;
  readonly color: string;
  readonly textColor: string;
  readonly displayLabel: string;
  readonly symbol: string | null;
  readonly detail: string | null;
  readonly light: ReturnType<typeof calendarChipPalette>;
  readonly dark: ReturnType<typeof calendarChipPalette>;
}

export interface WidgetDay {
  readonly date: string;
  readonly weekday: string;
  readonly weekdayIndex: number;
  readonly shortDate: string;
  readonly shifts: readonly WidgetShift[];
  // Optional additions keep stored timelines from older binaries readable.
  readonly appointments?: readonly WidgetAppointment[];
  readonly dayLabel?: string;
  readonly tint?: { readonly light: string; readonly dark: string };
  readonly url: string;
}

export interface WidgetAppointment {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly nextDay: boolean;
  readonly ownerName?: string;
  readonly ownerColor?: string;
}

function widgetPalette(palette: Palette) {
  return {
    background: palette.calendarBackground,
    surface: palette.surfaceMuted,
    text: palette.text,
    muted: palette.textMuted,
    today: palette.calendarToday,
    onToday: palette.onCalendarToday,
    separator: palette.border,
  };
}

export interface CalendarWidgetProps {
  readonly pastelColors?: boolean;
  readonly days: readonly WidgetDay[];
  readonly weekDays: readonly WidgetDay[];
  readonly monthDays: readonly WidgetDay[];
  readonly todayDate: string;
  readonly month: string;
  readonly monthTitle: string;
  readonly themeMode: AppearanceMode;
  readonly backgroundFileName: string | null;
  readonly backgroundOpacity: number;
  readonly chipStyle: {
    readonly radius: number;
    readonly rowHeight: number;
    readonly fontSize: number;
    readonly textColor: string;
  };
  readonly state: "ready" | "setup" | "expired";
  readonly url: string;
  readonly light: ReturnType<typeof widgetPalette>;
  readonly dark: ReturnType<typeof widgetPalette>;
}

export interface CalendarWidgetTimelineEntry {
  readonly date: Date;
  readonly props: CalendarWidgetProps;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const WIDGET_TIMELINE_DAYS = 14;
export const WIDGET_VISIBLE_DAYS = 28;

function widgetToday(now: Date, timeZone: string) {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
}
function monday(date: Temporal.PlainDate) {
  return date.subtract({ days: date.dayOfWeek - 1 });
}
export function widgetEntryRange(now: Date, timeZone: string) {
  const today = widgetToday(now, timeZone);
  const last = today.add({ days: WIDGET_TIMELINE_DAYS - 1 });
  const monthEnd = last.with({ day: last.daysInMonth });
  const gridEnd = monthEnd.add({ days: 7 - monthEnd.dayOfWeek });
  const weekEnd = monday(last).add({ days: WIDGET_VISIBLE_DAYS - 1 });
  return {
    startDate: monday(today.with({ day: 1 })).toString(),
    endDate: (Temporal.PlainDate.compare(gridEnd, weekEnd) > 0 ? gridEnd : weekEnd).toString(),
  };
}

export function nextWidgetMidnight(now: Date, timeZone: string): Date {
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timeZone);
  return new Date(local.toPlainDate().add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds);
}

export type WidgetCalendarDisplay = Pick<
  CalendarPreferencesData,
  "labelMode" | "showShiftTimes" | "showShiftDuration" | "showShifts"
> &
  Partial<
    Pick<
      CalendarPreferencesData,
      "pastelColors" | "showAppointments" | "showHolidays" | "holidayColor"
    >
  >;
const DEFAULT_WIDGET_DISPLAY: WidgetCalendarDisplay = {
  labelMode: "FULL",
  showShiftTimes: true,
  showShiftDuration: false,
  showShifts: true,
  showAppointments: true,
};

function shiftData(
  entry: ShiftEntry,
  display: WidgetCalendarDisplay,
  timeZone: string,
): WidgetShift {
  const timed = !entry.allDay && entry.startTime !== null && entry.endTime !== null;
  return {
    id: entry.id,
    // Use the same abbreviation as the calendar's SHORT label mode.
    label: entry.title.slice(0, 1),
    displayLabel:
      display.labelMode === "SYMBOL"
        ? entry.symbol
        : display.labelMode === "SHORT"
          ? entry.title.slice(0, 1)
          : entry.title,
    symbol: display.labelMode === "SYMBOL" ? widgetSymbol(entry.symbol) : null,
    detail: calendarShiftDetail(entry, { ...display, timeZone }),
    light: calendarChipPalette(entry.color, false, display.pastelColors),
    dark: calendarChipPalette(entry.color, true, display.pastelColors),
    title: entry.title,
    start: timed ? entry.startTime! : "",
    end: timed ? entry.endTime! : "",
    nextDay: timed && entry.endTime! <= entry.startTime!,
    color: entry.color,
    textColor: readableTextColor(entry.color),
  };
}

// Native equivalents of the existing app symbols; unknown custom symbols remain text.
function widgetSymbol(value: string): string | null {
  const symbols: Record<string, string> = {
    coff: "cup.and.saucer",
    rise: "sunrise",
    sunrise: "sunrise",
    sun: "sun.max",
    moon: "moon",
    home: "house",
    call: "phone",
    case: "briefcase",
    book: "book",
    list: "checklist",
    team: "person.2",
    time: "clock",
    clock: "clock",
    calendar: "calendar",
    unavailable: "xmark.circle",
    med: "cross.case",
    ambu: "cross.case",
    cash: "eurosign",
    palm: "beach.umbrella",
    hosp: "cross",
    tool: "wrench",
    star: "star",
    smil: "face.smiling",
  };
  return symbols[value] ?? null;
}

export function* calendarWidgetTimelineSteps({
  entries,
  now,
  timeZone,
  scheme,
  hasProfile,
  display = DEFAULT_WIDGET_DISPLAY,
  themeMode = "system",
  backgroundFileName = null,
  backgroundStrength = "medium",
  sharedCalendars = [],
  dayLabels = new Map(),
}: {
  readonly sharedCalendars?: readonly CachedSharedCalendar[];
  readonly dayLabels?: ReadonlyMap<string, string>;
  readonly entries: readonly CalendarEntry[];
  readonly now: Date;
  readonly timeZone: string;
  readonly scheme: string;
  readonly hasProfile: boolean;
  readonly display?: WidgetCalendarDisplay;
  readonly themeMode?: AppearanceMode;
  readonly backgroundFileName?: string | null;
  readonly backgroundStrength?: CalendarImageStrength;
}): Generator<void, readonly CalendarWidgetTimelineEntry[]> {
  const start = widgetToday(now, timeZone);
  const byDate = new Map<string, ShiftEntry[]>();
  const appointmentsByDate = new Map<string, WidgetAppointment[]>();
  const shiftViews = new Map<ShiftEntry, WidgetShift>();
  for (const entry of [...entries].sort(compareCalendarEntries)) {
    if (entry.deletedAt !== null) continue;
    if (entry.kind === "APPOINTMENT") {
      if (display.showAppointments !== false) {
        const appointments = appointmentsByDate.get(entry.date) ?? [];
        const timed = !entry.allDay && entry.startTime !== null;
        appointments.push({
          id: entry.id,
          title: entry.title,
          start: timed ? entry.startTime! : "",
          end: timed ? (entry.endTime ?? "") : "",
          nextDay: timed && entry.endTime !== null && entry.endTime <= entry.startTime!,
        });
        appointmentsByDate.set(entry.date, appointments);
      }
      yield;
      continue;
    }
    for (const date of dutyCalendarDates(entry)) {
      const bucket = byDate.get(date) ?? [];
      bucket.push(entry);
      byDate.set(date, bucket);
    }
    yield;
  }
  const base = {
    pastelColors: display.pastelColors ?? false,
    themeMode,
    backgroundFileName: hasProfile ? backgroundFileName : null,
    backgroundOpacity: calendarImageOverlayOpacity(backgroundStrength),
    chipStyle: {
      radius: CALENDAR_METRICS.chipRadius,
      rowHeight: CALENDAR_METRICS.entryRowHeight,
      fontSize: CALENDAR_METRICS.entryFontSize,
      textColor: CALENDAR_METRICS.chipTextColor,
    },
    url: `${scheme}:///?month=${start.toString().slice(0, 7)}`,
    light: widgetPalette(LIGHT_PALETTE),
    dark: widgetPalette(DARK_PALETTE),
  };
  const monthNames = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];
  function dateFields(date: Temporal.PlainDate) {
    return {
      todayDate: date.toString(),
      month: date.toString().slice(0, 7),
      monthTitle: monthNames[date.month - 1],
    };
  }
  // All caches are local to this input snapshot; none survive a profile/data change.
  const ranges = new Map<string, readonly WidgetDay[]>();
  const days = new Map<string, WidgetDay>();
  const lightTints = calendarDayTints(LIGHT_PALETTE, display.holidayColor);
  const darkTints = calendarDayTints(DARK_PALETTE, display.holidayColor);
  function* daysFrom(
    date: Temporal.PlainDate,
    count: number,
    at: number,
    url: string,
  ): Generator<void, readonly WidgetDay[]> {
    // A shared cache can become valid or expire between timeline entries.
    const visibility = sharedCalendars.map((cached) => {
      const age = at - Date.parse(cached.fetchedAt);
      return Number.isFinite(age) && age >= 0 && age < SHARED_CALENDAR_CACHE_MAX_AGE;
    });
    const rangeKey = JSON.stringify([date.toString(), count, url, visibility]);
    const previous = ranges.get(rangeKey);
    if (previous) return previous;
    const shared = sharedCalendarDays(sharedCalendars, timeZone, at, {
      startDate: date.toString(),
      endDate: date.add({ days: count }).toString(),
    });
    const result: WidgetDay[] = [];
    for (let index = 0; index < count; index += 1) {
      const day = date.add({ days: index });
      const iso = day.toString();
      const dayKey = JSON.stringify([iso, url, visibility]);
      const retained = days.get(dayKey);
      if (retained) {
        result.push(retained);
        yield;
        continue;
      }
      const own = byDate.get(iso) ?? [];
      const ownViews: WidgetShift[] = [];
      if (display.showShifts) {
        for (const entry of own) {
          let view = shiftViews.get(entry);
          if (!view) {
            view = shiftData(entry, display, timeZone);
            shiftViews.set(entry, view);
          }
          ownViews.push(view);
          yield;
        }
      }
      const sharedRows = [...(shared.get(iso) ?? [])].sort(
        (a, b) =>
          Date.parse(a.entry.startsAt) - Date.parse(b.entry.startsAt) ||
          a.calendarId.localeCompare(b.calendarId) ||
          a.entry.id.localeCompare(b.entry.id),
      );
      // Sharing fills empty days only; hidden own shifts must not be replaced by another person's shift.
      const sharedFallback = own.length
        ? []
        : sharedRows.filter((row) => row.entry.kind !== "APPOINTMENT").slice(0, 1);
      const ownAppointments = appointmentsByDate.get(iso) ?? [];
      const appointments =
        display.showAppointments === false
          ? []
          : [
              ...ownAppointments,
              ...sharedRows
                .filter((row) => row.entry.kind === "APPOINTMENT")
                .map((row): WidgetAppointment => {
                  const entry = row.entry;
                  const from = Temporal.Instant.from(entry.startsAt).toZonedDateTimeISO(timeZone);
                  const to = Temporal.Instant.from(entry.endsAt).toZonedDateTimeISO(timeZone);
                  return {
                    id: `shared:${row.calendarId}:${entry.id}`,
                    title: entry.title,
                    start: entry.allDay ? "" : from.toPlainTime().toString().slice(0, 5),
                    end: entry.allDay ? "" : to.toPlainTime().toString().slice(0, 5),
                    nextDay: !from.toPlainDate().equals(to.toPlainDate()),
                    ownerName: row.calendarName,
                    ownerColor: row.calendarColor,
                  };
                }),
            ];
      const dayLabel = display.showHolidays === false ? undefined : dayLabels.get(iso);
      const tint = dayLabel
        ? { light: lightTints.specialDay, dark: darkTints.specialDay }
        : day.dayOfWeek >= 6
          ? { light: lightTints.weekend, dark: darkTints.weekend }
          : undefined;
      const prepared: WidgetDay = {
        date: iso,
        weekday: WEEKDAYS[day.dayOfWeek - 1],
        weekdayIndex: day.dayOfWeek,
        shortDate: `${String(day.day).padStart(2, "0")}.${String(day.month).padStart(2, "0")}.`,
        shifts: [
          ...ownViews,
          ...sharedFallback.map((row): WidgetShift => {
            const entry = row.entry;
            const from = Temporal.Instant.from(entry.startsAt).toZonedDateTimeISO(timeZone);
            const to = Temporal.Instant.from(entry.endsAt).toZonedDateTimeISO(timeZone);
            const startTime = entry.allDay ? "" : from.toPlainTime().toString().slice(0, 5);
            const endTime = entry.allDay ? "" : to.toPlainTime().toString().slice(0, 5);
            return {
              id: `shared:${row.calendarId}:${entry.id}`,
              label: entry.title.slice(0, 1),
              title: entry.title,
              displayLabel:
                display.labelMode === "SYMBOL"
                  ? entry.symbol
                  : display.labelMode === "SHORT"
                    ? entry.title.slice(0, 1)
                    : entry.title,
              start: startTime,
              end: endTime,
              nextDay: !from.toPlainDate().equals(to.toPlainDate()),
              color: entry.color,
              textColor: readableTextColor(entry.color),
              light: sharedCalendarChipPalette(entry.color, false, display.pastelColors),
              dark: sharedCalendarChipPalette(entry.color, true, display.pastelColors),
              symbol: display.labelMode === "SYMBOL" ? widgetSymbol(entry.symbol) : null,
              detail: sharedShiftDetail(entry, startTime, display),
              ownerName: row.calendarName,
              ownerColor: row.calendarColor,
            };
          }),
        ],
        appointments,
        ...(dayLabel ? { dayLabel } : {}),
        ...(tint ? { tint } : {}),
        url,
      };
      days.set(dayKey, prepared);
      result.push(prepared);
      yield;
    }
    ranges.set(rangeKey, result);
    return result;
  }
  if (!hasProfile)
    return [
      {
        date: now,
        props: {
          ...base,
          ...dateFields(start),
          state: "setup",
          days: [],
          weekDays: [],
          monthDays: [],
        },
      },
    ];

  const timestamps = new Set(
    Array.from({ length: WIDGET_TIMELINE_DAYS + 1 }, (_, offset) =>
      offset === 0
        ? now.getTime()
        : start.add({ days: offset }).toZonedDateTime(timeZone).epochMilliseconds,
    ),
  );
  const expiresAt = start
    .add({ days: WIDGET_TIMELINE_DAYS })
    .toZonedDateTime(timeZone).epochMilliseconds;
  for (const calendar of sharedCalendars) {
    const expiry = Date.parse(calendar.fetchedAt) + SHARED_CALENDAR_CACHE_MAX_AGE;
    if (expiry > now.getTime() && expiry < expiresAt) timestamps.add(expiry);
  }
  const result: CalendarWidgetTimelineEntry[] = [];
  for (const at of [...timestamps].sort((a, b) => a - b)) {
    const date = widgetToday(new Date(at), timeZone);
    const expired = at >= expiresAt;
    const monthStart = date.with({ day: 1 });
    const monthCount = Math.ceil((monthStart.dayOfWeek - 1 + date.daysInMonth) / 7) * 7;
    const url = `${scheme}:///?month=${date.toString().slice(0, 7)}`;
    result.push({
      date: new Date(at),
      props: {
        ...base,
        ...dateFields(date),
        url,
        state: expired ? ("expired" as const) : ("ready" as const),
        days: expired ? [] : yield* daysFrom(date, 6, at, url),
        weekDays: expired ? [] : yield* daysFrom(monday(date), WIDGET_VISIBLE_DAYS, at, url),
        monthDays: expired ? [] : yield* daysFrom(monday(monthStart), monthCount, at, url),
      },
    });
    yield;
  }
  return result;
}

/** Synchronous adapter retained for pure callers and release contracts. */
export function buildCalendarWidgetTimeline(
  input: Parameters<typeof calendarWidgetTimelineSteps>[0],
): readonly CalendarWidgetTimelineEntry[] {
  const work = calendarWidgetTimelineSteps(input);
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
}
