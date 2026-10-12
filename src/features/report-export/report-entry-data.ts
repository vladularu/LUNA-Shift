import {
  SHIFT_TYPE_LABELS,
  type CalendarEntry,
  type ShiftEntry,
  type UserProfile,
} from "@/domain/types";
import { calculateDailyWorkCredit } from "@/engine/daily-summary";
import { calculateTimedShiftMinutes } from "@/engine/working-time";
import { RuleResolutionError, type RuleResolver } from "@/rules/rule-resolver";
import type { ReportEntry } from "./report-document";

export function reportEntries(
  entries: readonly CalendarEntry[],
  profile: UserProfile,
  resolver: RuleResolver,
): readonly ReportEntry[] {
  const shifts = entries.filter((entry): entry is ShiftEntry => entry.kind === "SHIFT");
  const credits = new Map<string, ReturnType<typeof calculateDailyWorkCredit> | null>();
  return entries.map((entry) => {
    const absence = entry.kind === "SHIFT" && ["VACATION", "SICK", "FREE"].includes(entry.type);
    const allDay = Boolean(entry.allDay || absence || !entry.startTime || !entry.endTime);
    let creditMinutes: number | null = 0;
    if (entry.kind === "SHIFT" && ["VACATION", "SICK"].includes(entry.type)) {
      if (!credits.has(entry.date)) {
        try {
          credits.set(entry.date, calculateDailyWorkCredit(entry.date, shifts, profile, resolver));
        } catch (error) {
          if (!(error instanceof RuleResolutionError)) throw error;
          credits.set(entry.date, null);
        }
      }
      const credit = credits.get(entry.date);
      // A day's absence credit is assigned once, with the same sick-before-vacation priority as the engine.
      const credited = shifts.find(
        (shift) =>
          shift.date === entry.date && shift.type === (credit?.sickMinutes ? "SICK" : "VACATION"),
      );
      creditMinutes = credit
        ? credited?.id === entry.id
          ? credit.sickMinutes + credit.vacationMinutes
          : 0
        : null;
    }
    return {
      date: entry.date,
      title: entry.title,
      kind: entry.kind,
      typeLabel: entry.kind === "SHIFT" ? SHIFT_TYPE_LABELS[entry.type] : "Termin",
      color: entry.color,
      allDay,
      startTime: allDay ? null : entry.startTime,
      endTime: allDay ? null : entry.endTime,
      nextDay: !allDay && entry.endTime! <= entry.startTime!,
      breakMinutes: allDay || entry.kind === "APPOINTMENT" ? null : entry.breakMinutes,
      durationMinutes: allDay
        ? null
        : calculateTimedShiftMinutes(
            { ...entry, breakMinutes: entry.kind === "SHIFT" ? entry.breakMinutes : 0 },
            profile.timeZone,
          ),
      creditMinutes: entry.kind === "APPOINTMENT" ? null : creditMinutes,
    };
  });
}
