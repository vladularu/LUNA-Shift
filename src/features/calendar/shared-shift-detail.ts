import type { SharedCalendarEntry } from "@/domain/calendar-sharing";
import { formatMinutes } from "@/engine/working-time";

export function sharedShiftNetMinutes(entry: SharedCalendarEntry): number | null {
  const gross = Math.round((Date.parse(entry.endsAt) - Date.parse(entry.startsAt)) / 60_000);
  const pause = entry.breakMinutes;
  return !entry.allDay &&
    typeof pause === "number" &&
    Number.isInteger(pause) &&
    pause >= 0 &&
    pause <= 2880 &&
    Number.isFinite(gross) &&
    gross > 0 &&
    gross <= 2880
    ? Math.max(0, gross - pause)
    : null;
}

/** Both surfaces use the viewer's settings; missing legacy pauses are not zero pauses. */
export function sharedShiftDetail(
  entry: SharedCalendarEntry,
  startTime: string,
  display: { readonly showShiftTimes: boolean; readonly showShiftDuration: boolean },
): string | null {
  if (!display.showShiftTimes && !display.showShiftDuration) return null;
  if (entry.allDay) return "GT";
  const parts: string[] = [];
  if (display.showShiftTimes) parts.push(startTime);
  if (display.showShiftDuration) {
    const minutes = sharedShiftNetMinutes(entry);
    parts.push(minutes === null ? "–" : `${formatMinutes(minutes)} h`);
  }
  return parts.join(" · ");
}
