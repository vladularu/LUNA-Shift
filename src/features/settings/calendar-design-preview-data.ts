import type { CalendarEntry, ShiftEntry, ShiftTemplate } from "@/domain/types";
import { createMonthGrid } from "@/engine/calendar";
import { SHIFT_TYPE_COLORS } from "@/theme/shift-colors";

const SAMPLES = {
  EARLY: { title: "Früh", symbol: "rise", startTime: "06:00", endTime: "14:00" },
  LATE: { title: "Spät", symbol: "sun", startTime: "14:00", endTime: "22:00" },
  NIGHT: { title: "Nacht", symbol: "moon", startTime: "22:00", endTime: "06:00" },
  FREE: { title: "Frei", symbol: "star", startTime: null, endTime: null },
} as const;

// Two-week rota: forward-rotating blocks, two recovery days after nights,
// then a shorter working week. Ten 7.5-hour shifts average 37.5 hours/week.
const ROTA = [
  "EARLY",
  "EARLY",
  "LATE",
  "LATE",
  "NIGHT",
  "NIGHT",
  "FREE",
  "FREE",
  "EARLY",
  "EARLY",
  "LATE",
  "LATE",
  "FREE",
  "FREE",
] as const;

/** Presentation-only examples: never pass these to the plan's persistence commands. */
export function calendarDesignPreviewData(
  month: string,
  templates: readonly ShiftTemplate[],
  existingEntries: readonly CalendarEntry[],
) {
  const date = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
  const metadata = {
    revision: 1,
    createdAt: `${date(1)}T00:00:00Z`,
    updatedAt: `${date(1)}T00:00:00Z`,
    deletedAt: null,
  };
  const days = createMonthGrid(month);
  const shifts = ROTA.flatMap<ShiftEntry>((type, index) => {
    const day = days[index];
    if (!day?.inMonth) return [];
    const sample = SAMPLES[type];
    const saved =
      templates.find((item) => item.type === type && item.deletedAt === null) ??
      existingEntries.find(
        (item): item is ShiftEntry =>
          item.kind === "SHIFT" && item.type === type && item.deletedAt === null,
      );
    return [
      {
        ...sample,
        ...metadata,
        kind: "SHIFT",
        type,
        id: `calendar-design-example-${day.date}`,
        date: day.date,
        templateId: null,
        allDay: sample.startTime === null,
        breakMinutes: sample.startTime === null ? 0 : 30,
        color: saved?.color ?? SHIFT_TYPE_COLORS[type],
        symbol: saved?.symbol ?? sample.symbol,
        note: null,
        overtimeMinutes: 0,
        holidayPremiumMode: "WITH_TIME_OFF",
      },
    ];
  });
  return {
    entries: shifts,
    holidays: new Map<string, { readonly name: string }>(),
  };
}
