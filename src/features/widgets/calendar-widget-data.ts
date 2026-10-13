import { Temporal } from "@js-temporal/polyfill";

import type { CalendarEntry, CalendarPreferencesData, ShiftEntry } from "@/domain/types";
import { calendarShiftDetail } from "@/features/calendar/calendar-display";
import { calendarImageOverlayOpacity, type CalendarImageStrength } from "@/theme/calendar-image";
import type { AppearanceMode } from "@/domain/appearance";
import { CALENDAR_METRICS } from "@/theme/tokens";
import { compareCalendarEntries } from "@/engine/calendar-entry-order";
import { calendarChipPalette, readableTextColor } from "@/theme/color-contrast";
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from "@/theme/palette-values";

export interface WidgetShift {
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
  readonly weekNumber: number;
  readonly shortDate: string;
  readonly shifts: readonly WidgetShift[];
  readonly url: string;
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
>;
const DEFAULT_WIDGET_DISPLAY: WidgetCalendarDisplay = {
  labelMode: "FULL",
  showShiftTimes: true,
  showShiftDuration: false,
  showShifts: true,
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
    light: calendarChipPalette(entry.color, false),
    dark: calendarChipPalette(entry.color, true),
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
    sun: "sun.max",
    moon: "moon",
    home: "house",
    call: "phone",
    case: "briefcase",
    book: "book",
    list: "checklist",
    team: "person.2",
    time: "clock",
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

export function buildCalendarWidgetTimeline({
  entries,
  now,
  timeZone,
  scheme,
  hasProfile,
  display = DEFAULT_WIDGET_DISPLAY,
  themeMode = "system",
  backgroundFileName = null,
  backgroundStrength = "medium",
}: {
  readonly entries: readonly CalendarEntry[];
  readonly now: Date;
  readonly timeZone: string;
  readonly scheme: string;
  readonly hasProfile: boolean;
  readonly display?: WidgetCalendarDisplay;
  readonly themeMode?: AppearanceMode;
  readonly backgroundFileName?: string | null;
  readonly backgroundStrength?: CalendarImageStrength;
}): readonly CalendarWidgetTimelineEntry[] {
  const start = widgetToday(now, timeZone);
  const byDate = new Map<string, ShiftEntry[]>();
  for (const entry of [...entries].sort(compareCalendarEntries)) {
    if (entry.kind !== "SHIFT" || entry.deletedAt !== null) continue;
    const bucket = byDate.get(entry.date) ?? [];
    bucket.push(entry);
    byDate.set(entry.date, bucket);
  }
  const base = {
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
  function daysFrom(date: Temporal.PlainDate, count: number, url: string): WidgetDay[] {
    return Array.from({ length: count }, (_, index) => {
      const day = date.add({ days: index });
      const iso = day.toString();
      return {
        date: iso,
        weekday: WEEKDAYS[day.dayOfWeek - 1],
        weekdayIndex: day.dayOfWeek,
        weekNumber: day.weekOfYear!,
        shortDate: `${String(day.day).padStart(2, "0")}.${String(day.month).padStart(2, "0")}.`,
        shifts: display.showShifts
          ? (byDate.get(iso) ?? []).map((entry) => shiftData(entry, display, timeZone))
          : [],
        url,
      };
    });
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

  return Array.from({ length: WIDGET_TIMELINE_DAYS + 1 }, (_, offset) => {
    const date = start.add({ days: offset });
    const expired = offset === WIDGET_TIMELINE_DAYS;
    const monthStart = date.with({ day: 1 });
    const monthCount = Math.ceil((monthStart.dayOfWeek - 1 + date.daysInMonth) / 7) * 7;
    const url = `${scheme}:///?month=${date.toString().slice(0, 7)}`;
    return {
      date: offset === 0 ? now : new Date(date.toZonedDateTime(timeZone).epochMilliseconds),
      props: {
        ...base,
        ...dateFields(date),
        url,
        state: expired ? ("expired" as const) : ("ready" as const),
        days: expired ? [] : daysFrom(date, 6, url),
        weekDays: expired ? [] : daysFrom(monday(date), WIDGET_VISIBLE_DAYS, url),
        monthDays: expired ? [] : daysFrom(monday(monthStart), monthCount, url),
      },
    };
  });
}
