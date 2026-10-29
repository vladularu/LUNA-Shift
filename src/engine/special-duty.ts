import { Temporal } from "@js-temporal/polyfill";
import { clockMinute, dutyClock, dutyInstant, type DutyPart } from "@/domain/special-duty";
import type { ShiftEntry } from "@/domain/types";

type DutyShift = Pick<
  ShiftEntry,
  "date" | "startTime" | "endTime" | "breakMinutes" | "specialDuty"
>;

export function dutyWorkParts(shift: DutyShift): readonly DutyPart[] {
  const duty = shift.specialDuty;
  if (!duty || !shift.startTime || !shift.endTime) return [];
  if (duty.kind === "ON_CALL")
    return duty.callouts.map((call) => ({
      start: call.departure,
      end: call.returned,
      breakMinutes: call.breakMinutes,
    }));
  return [
    {
      start: clockMinute(shift.startTime),
      end: duty.endDay * 1440 + clockMinute(shift.endTime),
      breakMinutes: shift.breakMinutes,
    },
    ...duty.parts,
  ];
}

export function specialDutyWorkMinutes(shift: DutyShift): number {
  const duty = shift.specialDuty;
  if (!duty) return 0;
  return dutyWorkParts(shift).reduce(
    (sum, part) =>
      sum +
      Math.max(
        0,
        Number(
          dutyInstant(shift.date, part.end, duty.timeZone).epochMilliseconds -
            dutyInstant(shift.date, part.start, duty.timeZone).epochMilliseconds,
        ) /
          60000 -
          part.breakMinutes,
      ),
    0,
  );
}

const projections = new WeakMap<ShiftEntry, readonly ShiftEntry[]>();

/** A projection only: keep the original ID for editor links and delete/restore. */
export function projectDutyWork(shift: ShiftEntry): readonly ShiftEntry[] {
  if (!shift.specialDuty) return [shift];
  const cached = projections.get(shift);
  if (cached) return cached;
  const projected = Object.freeze(
    dutyWorkParts(shift).map((part, index) =>
      Object.freeze({
        ...shift,
        specialDuty: null,
        date: Temporal.PlainDate.from(shift.date)
          .add({ days: Math.floor(part.start / 1440) })
          .toString(),
        startTime: dutyClock(part.start),
        endTime: dutyClock(part.end),
        breakMinutes: part.breakMinutes,
        overtimeMinutes:
          shift.specialDuty?.kind === "SPLIT" && index === 0 ? shift.overtimeMinutes : 0,
        tariffOvertimeConfirmed:
          shift.specialDuty?.kind === "SPLIT" && index === 0
            ? shift.tariffOvertimeConfirmed
            : false,
      }),
    ),
  );
  projections.set(shift, projected);
  return projected;
}

export function projectDutyShifts(shifts: readonly ShiftEntry[]): readonly ShiftEntry[] {
  return shifts.some((shift) => shift.specialDuty) ? shifts.flatMap(projectDutyWork) : shifts;
}

/** Daily totals need midnight slices; legal checks retain the continuous interval. */
export function projectDutyCalendarDays(shifts: readonly ShiftEntry[]): readonly ShiftEntry[] {
  if (!shifts.some((shift) => shift.specialDuty)) return shifts;
  return shifts.flatMap((shift) => {
    if (!shift.specialDuty) return [shift];
    return dutyWorkParts(shift).flatMap((part) => {
      const slices: ShiftEntry[] = [];
      let remainingBreak = part.breakMinutes;
      for (let start = part.start; start < part.end;) {
        const end = Math.min(part.end, (Math.floor(start / 1440) + 1) * 1440);
        const elapsed =
          Number(
            dutyInstant(shift.date, end, shift.specialDuty!.timeZone).epochMilliseconds -
              dutyInstant(shift.date, start, shift.specialDuty!.timeZone).epochMilliseconds,
          ) / 60000;
        const pause = Math.min(remainingBreak, elapsed);
        remainingBreak -= pause;
        slices.push({
          ...shift,
          specialDuty: null,
          date: Temporal.PlainDate.from(shift.date)
            .add({ days: Math.floor(start / 1440) })
            .toString(),
          startTime: dutyClock(start),
          endTime: dutyClock(end),
          breakMinutes: pause,
          overtimeMinutes: 0,
          tariffOvertimeConfirmed: false,
        });
        start = end;
      }
      return slices;
    });
  });
}

export function dutyCalendarDates(shift: ShiftEntry): readonly string[] {
  if (!shift.specialDuty || !shift.startTime || !shift.endTime) return [shift.date];
  const end = Math.max(
    shift.specialDuty.endDay * 1440 + clockMinute(shift.endTime),
    ...shift.specialDuty.parts.map((part) => part.end),
  );
  const day = Temporal.PlainDate.from(shift.date);
  return Array.from({ length: Math.ceil(end / 1440) }, (_, index) =>
    day.add({ days: index }).toString(),
  );
}

export function projectRegularPayShifts(shifts: readonly ShiftEntry[]): readonly ShiftEntry[] {
  return shifts.some((shift) => shift.specialDuty)
    ? shifts.flatMap((shift) =>
        !shift.specialDuty
          ? [shift]
          : shift.specialDuty.kind === "SPLIT"
            ? projectDutyWork(shift).map((part, index) => ({
                ...part,
                id: `${shift.id}:part:${index}`,
              }))
            : [],
      )
    : shifts;
}

export function specialDutyOpenItems(
  shifts: readonly ShiftEntry[],
  month: string,
): readonly string[] {
  const result = new Set<string>();
  for (const shift of shifts) {
    if (shift.deletedAt !== null || !shift.specialDuty || shift.specialDuty.kind === "SPLIT")
      continue;
    const end = Temporal.PlainDate.from(shift.date)
      .add({ days: shift.specialDuty.endDay })
      .toString();
    if (shift.date.slice(0, 7) > month || end.slice(0, 7) < month) continue;
    if (shift.specialDuty.kind === "ON_CALL" && !shift.specialDuty.calloutsComplete)
      result.add("Rufbereitschaft: Einsätze noch nicht abgeschlossen.");
    result.add(
      shift.specialDuty.kind === "ON_CALL"
        ? "Rufbereitschaft: tarifliche Vergütung und Zeitgutschrift noch offen."
        : "Bereitschaftsdienst: tarifliche Vergütung und Zeitgutschrift noch offen.",
    );
  }
  return [...result];
}

export function specialDutyDescription(shift: DutyShift): string | null {
  const duty = shift.specialDuty;
  if (!duty) return null;
  if (duty.kind === "SPLIT")
    return [
      `${shift.startTime}–${shift.endTime}`,
      ...duty.parts.map(
        (part) =>
          `${dutyClock(part.start)}–${dutyClock(part.end)}${part.start >= 1440 ? ` (+${Math.floor(part.start / 1440)} Tag)` : ""}`,
      ),
    ].join(" / ");
  return duty.kind === "ON_CALL"
    ? `Rufbereitschaft · bis ${Temporal.PlainDate.from(shift.date).add({ days: duty.endDay })} ${shift.endTime} · ${duty.callouts.length} Einsätze${duty.calloutsComplete ? "" : " · offen"}`
    : `Bereitschaftsdienst · ${duty.standbyLevel === "UNKNOWN" ? "Stufe offen" : `Stufe ${duty.standbyLevel}`}`;
}
