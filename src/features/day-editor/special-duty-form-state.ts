import { clockMinute, dutyInstant, type DutyPart, type SpecialDuty } from "@/domain/special-duty";

export function dutyDayLabel(day: number): string {
  return day === 0 ? "Gleicher Tag" : day === 1 ? "Folgetag" : `${day} Tage später`;
}

export function dutyDurationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} Std.${rest ? ` ${rest} Min.` : ""}` : `${rest} Min.`;
}

export function dutyParentPart(
  startTime: string,
  endTime: string,
  endDay: number,
  pause: string,
): DutyPart {
  try {
    return {
      start: clockMinute(startTime),
      end: endDay * 1440 + clockMinute(endTime),
      breakMinutes: Number(pause),
    };
  } catch {
    return { start: NaN, end: NaN, breakMinutes: Number(pause) };
  }
}

export function changeDutyClock(part: DutyPart, field: "start" | "end", time: string): DutyPart {
  const next = { ...part, [field]: Math.floor(part[field] / 1440) * 1440 + clockMinute(time) };
  // A backwards clock crosses midnight; an explicit day selection stays explicit.
  if (next.end <= next.start)
    next.end = (Math.floor(next.start / 1440) + 1) * 1440 + (next.end % 1440);
  return next;
}

export function dutyIntervalMinutes(
  start: number,
  end: number,
  timeZone: string,
  date?: string,
): number {
  if (!date) return end - start;
  return (
    Number(
      dutyInstant(date, end, timeZone).epochMilliseconds -
        dutyInstant(date, start, timeZone).epochMilliseconds,
    ) / 60000
  );
}

function blockError(
  part: DutyPart,
  maxDuration: number,
  timeZone: string,
  date?: string,
  maxEnd = 14 * 1440,
): string | null {
  if (![part.start, part.end, part.breakMinutes].every(Number.isInteger))
    return "Bitte gib gültige Uhrzeiten und ganze Pausenminuten ein.";
  if (part.start < 0 || part.end > maxEnd || part.end <= part.start)
    return "Das Ende muss nach dem Beginn liegen. Prüfe auch den Tag.";
  if (part.end - part.start > maxDuration)
    return maxDuration === 1440
      ? "Dieser Zeitraum darf höchstens 24 Stunden dauern."
      : "Rufbereitschaft darf höchstens 14 Tage dauern.";
  if (part.breakMinutes < 0 || part.breakMinutes >= part.end - part.start)
    return "Die Pause muss kürzer als dieser Zeitraum sein.";
  try {
    dutyIntervalMinutes(part.start, part.end, timeZone, date);
  } catch {
    return "Diese Uhrzeit ist bei der Zeitumstellung nicht eindeutig oder existiert nicht. Bitte korrigiere sie.";
  }
  return null;
}

export function dutyFormFeedback(duty: SpecialDuty, parent: DutyPart, date?: string) {
  const parentError = blockError(
    parent,
    duty.kind === "ON_CALL" ? 14 * 1440 : 1440,
    duty.timeZone,
    date,
    15 * 1440 - 1,
  );
  const partErrors = duty.parts.map((part, index) => {
    const error = blockError(part, 1440, duty.timeZone, date);
    if (error) return error;
    if (part.start < parent.end)
      return `Dienstteil ${index + 2} beginnt vor dem Ende von Dienstteil 1.`;
    const overlap = duty.parts.findIndex(
      (other, otherIndex) =>
        otherIndex !== index && part.start < other.end && part.end > other.start,
    );
    if (overlap >= 0)
      return `Dienstteil ${index + 2} überschneidet sich mit Dienstteil ${overlap + 2}.`;
    if (part.end - parent.start > 1440)
      return "Alle Dienstteile müssen innerhalb von 24 Stunden liegen.";
    return null;
  });
  const calloutErrors = duty.callouts.map((call, index) => {
    const error = blockError(call, 1440, duty.timeZone, date);
    if (error) return error;
    if (
      !Number.isInteger(call.departure) ||
      !Number.isInteger(call.returned) ||
      call.departure > call.start ||
      call.returned < call.end
    )
      return "Bitte prüfe die Minuten für Hin- und Rückweg.";
    if (call.departure < parent.start || call.returned > parent.end)
      return "Einsatz und Wege müssen innerhalb der Rufbereitschaft liegen.";
    const overlap = duty.callouts.findIndex(
      (other, otherIndex) =>
        otherIndex !== index && call.departure < other.returned && call.returned > other.departure,
    );
    if (overlap >= 0)
      return `Einsatz ${index + 1} überschneidet sich einschließlich der Wege mit Einsatz ${overlap + 1}.`;
    try {
      dutyIntervalMinutes(call.departure, call.returned, duty.timeZone, date);
    } catch {
      return "Prüfe die Wegezeiten an der Zeitumstellung.";
    }
    return null;
  });
  const valid = !parentError && !partErrors.some(Boolean) && !calloutErrors.some(Boolean);
  const parts = [parent, ...duty.parts].sort((a, b) => a.start - b.start);
  const workMinutes =
    valid && duty.kind === "SPLIT"
      ? parts.reduce(
          (sum, part) =>
            sum +
            Math.max(
              0,
              dutyIntervalMinutes(part.start, part.end, duty.timeZone, date) - part.breakMinutes,
            ),
          0,
        )
      : null;
  const interruptionMinutes =
    valid && duty.kind === "SPLIT"
      ? parts
          .slice(1)
          .reduce(
            (sum, part, index) =>
              sum + dutyIntervalMinutes(parts[index].end, part.start, duty.timeZone, date),
            0,
          )
      : null;
  return { parentError, partErrors, calloutErrors, workMinutes, interruptionMinutes };
}
