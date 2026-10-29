import { Temporal } from "@js-temporal/polyfill";

/** Wall-clock minutes relative to the entry's local date; dates survive copying. */
export interface DutyPart {
  readonly start: number;
  readonly end: number;
  readonly breakMinutes: number;
}

export interface DutyCallout extends DutyPart {
  readonly kind: "REMOTE" | "ON_SITE";
  readonly departure: number;
  readonly returned: number;
}

export interface SpecialDuty {
  readonly version: 1;
  readonly kind: "SPLIT" | "ON_CALL" | "STANDBY";
  readonly timeZone: string;
  /** Explicit local end day, 0 = start date. */
  readonly endDay: number;
  readonly parts: readonly DutyPart[];
  readonly callouts: readonly DutyCallout[];
  readonly calloutsComplete: boolean;
  readonly standbyLevel: "UNKNOWN" | "I" | "II" | "III" | "A" | "B" | "C" | "D";
  readonly settlement: "UNKNOWN" | "PAY" | "TIME_OFF";
}

export const DUTY_LABELS = {
  SPLIT: "Geteilter Dienst",
  ON_CALL: "Rufbereitschaft",
  STANDBY: "Bereitschaftsdienst",
} as const;

export function clockMinute(time: string): number {
  const value = Temporal.PlainTime.from(time);
  return value.hour * 60 + value.minute;
}

export function dutyClock(minute: number): string {
  const value = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function newSpecialDuty(
  kind: SpecialDuty["kind"],
  startTime: string,
  endTime: string,
  timeZone: string,
): SpecialDuty {
  return {
    version: 1,
    kind,
    timeZone,
    endDay: clockMinute(endTime) <= clockMinute(startTime) ? 1 : 0,
    parts: [],
    callouts: [],
    calloutsComplete: false,
    standbyLevel: "UNKNOWN",
    settlement: "UNKNOWN",
  };
}

function invalid(): never {
  throw new Error("Bitte prüfe die Zeiten und Angaben zum Sonderdienst.");
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !(key in row)))
    return invalid();
  return row;
}

function minute(value: unknown, max = 14 * 1440): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max)
    return invalid();
  return value;
}

function part(value: unknown, callout: boolean): DutyPart | DutyCallout {
  const raw = record(
    value,
    callout
      ? ["start", "end", "breakMinutes", "kind", "departure", "returned"]
      : ["start", "end", "breakMinutes"],
  );
  const start = minute(raw.start);
  const end = minute(raw.end);
  const breakMinutes = minute(raw.breakMinutes, 1440);
  if (end <= start || end - start > 1440 || breakMinutes >= end - start) return invalid();
  if (!callout) return Object.freeze({ start, end, breakMinutes });
  if (raw.kind !== "REMOTE" && raw.kind !== "ON_SITE") return invalid();
  const departure = minute(raw.departure);
  const returned = minute(raw.returned);
  if (departure > start || returned < end || returned - departure > 1440) return invalid();
  if (raw.kind === "REMOTE" && (departure !== start || returned !== end)) return invalid();
  return Object.freeze({ start, end, breakMinutes, kind: raw.kind, departure, returned });
}

/** The same validator guards UI persistence, SQLite reads and backup import. */
export function validateSpecialDuty(value: unknown): SpecialDuty | null {
  if (value === undefined || value === null) return null;
  const raw = record(value, [
    "version",
    "kind",
    "timeZone",
    "endDay",
    "parts",
    "callouts",
    "calloutsComplete",
    "standbyLevel",
    "settlement",
  ]);
  if (raw.version !== 1 || !["SPLIT", "ON_CALL", "STANDBY"].includes(String(raw.kind)))
    return invalid();
  if (typeof raw.timeZone !== "string") return invalid();
  Temporal.Now.zonedDateTimeISO(raw.timeZone);
  const endDay = minute(raw.endDay, 14);
  if (
    !Array.isArray(raw.parts) ||
    raw.parts.length > 8 ||
    !Array.isArray(raw.callouts) ||
    raw.callouts.length > 64
  )
    return invalid();
  const parts = raw.parts.map((item) => part(item, false) as DutyPart);
  const callouts = raw.callouts.map((item) => part(item, true) as DutyCallout);
  if (typeof raw.calloutsComplete !== "boolean") return invalid();
  if (!["UNKNOWN", "I", "II", "III", "A", "B", "C", "D"].includes(String(raw.standbyLevel)))
    return invalid();
  if (!["UNKNOWN", "PAY", "TIME_OFF"].includes(String(raw.settlement))) return invalid();
  if (raw.kind !== "SPLIT" && parts.length > 0) return invalid();
  if (raw.kind !== "ON_CALL" && (callouts.length > 0 || raw.calloutsComplete)) return invalid();
  for (const intervals of [
    parts,
    callouts.map((item) => ({ start: item.departure, end: item.returned })),
  ]) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    if (sorted.some((item, index) => index > 0 && sorted[index - 1].end > item.start))
      return invalid();
  }
  return Object.freeze({
    version: 1,
    kind: raw.kind as SpecialDuty["kind"],
    timeZone: raw.timeZone,
    endDay,
    parts: Object.freeze(parts),
    callouts: Object.freeze(callouts),
    calloutsComplete: raw.calloutsComplete,
    standbyLevel: raw.standbyLevel as SpecialDuty["standbyLevel"],
    settlement: raw.settlement as SpecialDuty["settlement"],
  });
}

export function validateDutyParent(
  duty: SpecialDuty | null,
  parent: {
    readonly date?: string;
    readonly startTime?: string | null;
    readonly endTime?: string | null;
    readonly allDay?: boolean;
    readonly type: string;
    readonly breakMinutes?: number;
  },
): void {
  if (!duty) return;
  if (
    parent.allDay ||
    !parent.startTime ||
    !parent.endTime ||
    ["TRAINING", "VACATION", "SICK", "FREE"].includes(parent.type)
  )
    return invalid();
  const start = clockMinute(parent.startTime);
  const end = duty.endDay * 1440 + clockMinute(parent.endTime);
  if (end <= start || end - start > 14 * 1440) return invalid();
  if (duty.kind !== "ON_CALL" && end - start > 1440) return invalid();
  if ((parent.breakMinutes ?? 0) >= end - start) return invalid();
  if (duty.kind === "ON_CALL" && (parent.breakMinutes ?? 0) !== 0) return invalid();
  if (duty.parts.some((item) => item.start < end || item.end - start > 1440)) return invalid();
  if (duty.callouts.some((item) => item.departure < start || item.returned > end)) return invalid();
  if (parent.date) {
    const intervals = [
      { start, end },
      ...duty.parts,
      ...duty.callouts,
      ...duty.callouts.map((item) => ({ start: item.departure, end: item.returned })),
    ];
    intervals.forEach((item) => {
      // Missing or ambiguous local times must be corrected, never silently invented.
      dutyInstant(parent.date!, item.start, duty.timeZone);
      dutyInstant(parent.date!, item.end, duty.timeZone);
    });
  }
}

export function dutyInstant(
  date: string,
  minute: number,
  timeZone: string,
): Temporal.ZonedDateTime {
  const day = Temporal.PlainDate.from(date).add({ days: Math.floor(minute / 1440) });
  return day
    .toPlainDateTime(dutyClock(minute))
    .toZonedDateTime(timeZone, { disambiguation: "reject" });
}

/** Actual events never become a planned template or a future copy. */
export function plannedSpecialDuty(duty: SpecialDuty | null | undefined): SpecialDuty | null {
  return duty ? { ...duty, callouts: [], calloutsComplete: false } : null;
}
