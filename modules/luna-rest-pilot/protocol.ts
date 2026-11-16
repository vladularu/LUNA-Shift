// Wire contract for the explicitly invoked Preview comparison only.
export const PROTOCOL_VERSION = 1 as const;
const DAY_MS = 86_400_000;

export interface PilotDay {
  readonly day: number;
  readonly date: string;
  readonly startMs: number;
  readonly endMs: number;
}
export interface PilotShift {
  readonly id: string;
  readonly date: string;
  readonly type: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly deletedAt: string | null;
}
export interface PilotInterval {
  readonly shiftId: string;
  readonly startMs: number;
  readonly endMs: number;
}
export interface PilotRequest {
  readonly schemaVersion: typeof PROTOCOL_VERSION;
  readonly id: string;
  readonly month: string;
  readonly timeZone: string;
  readonly coverageStart: number;
  readonly coverageEnd: number;
  readonly sundayPeriodDays: number;
  readonly holidayPeriodDays: number;
  readonly requiredRestMinutes: number;
  readonly evidenceShiftType: string;
  readonly days: readonly PilotDay[];
  readonly holidays: readonly number[];
  readonly shifts: readonly PilotShift[];
  readonly intervals: readonly PilotInterval[];
}
export interface PilotObligation {
  readonly kind: "SUNDAY" | "WEEKDAY_HOLIDAY";
  readonly day: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly shiftIds: readonly string[];
}
export interface PilotCandidate {
  readonly day: number;
  readonly evidenceShiftIds: readonly string[];
  readonly observedRestMinutes: number | null;
}
export interface PilotResult {
  readonly workDates: readonly { readonly day: number; readonly shiftIds: readonly string[] }[];
  readonly obligations: readonly PilotObligation[];
  readonly candidateDates: readonly number[];
  readonly candidates: readonly PilotCandidate[];
  readonly matched: readonly {
    readonly obligationIndex: number;
    readonly candidateIndex: number;
  }[];
  readonly unmatched: readonly number[];
}

export function epochDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid ISO calendar date");
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value)
    throw new Error("Invalid ISO calendar date");
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 4099) throw new Error("Unsupported calendar year");
  return parsed / DAY_MS;
}

export function validateRequest(request: PilotRequest): void {
  const integer = (n: number) => Number.isSafeInteger(n);
  if (request.schemaVersion !== PROTOCOL_VERSION) throw new Error("Unsupported pilot protocol");
  if (!request.id || !/^\d{4}-\d{2}$/.test(request.month) || !request.timeZone)
    throw new Error("Invalid request identity");
  epochDay(`${request.month}-01`);
  if (
    !integer(request.coverageStart) ||
    !integer(request.coverageEnd) ||
    request.coverageStart > request.coverageEnd ||
    request.days.length === 0 ||
    request.days.length > 4000 ||
    request.intervals.length > 100_000 ||
    request.shifts.length > 100_000
  )
    throw new Error("Invalid pilot coverage");
  if (
    !integer(request.sundayPeriodDays) ||
    !integer(request.holidayPeriodDays) ||
    request.sundayPeriodDays < 1 ||
    request.holidayPeriodDays < 1 ||
    request.sundayPeriodDays > 366 ||
    request.holidayPeriodDays > 366 ||
    !integer(request.requiredRestMinutes) ||
    request.requiredRestMinutes < 0
  )
    throw new Error("Invalid pilot rest parameters");
  let previous: PilotDay | undefined;
  for (const day of request.days) {
    if (
      !integer(day.day) ||
      epochDay(day.date) !== day.day ||
      !integer(day.startMs) ||
      !integer(day.endMs) ||
      day.startMs >= day.endMs ||
      (previous && (day.day !== previous.day + 1 || day.startMs !== previous.endMs))
    )
      throw new Error("Invalid pilot calendar boundaries");
    previous = day;
  }
  const first = request.days[0];
  const last = request.days[request.days.length - 1];
  if (request.coverageStart < first.day || request.coverageEnd > last.day)
    throw new Error("Pilot coverage exceeds day table");
  const ids = new Set<string>();
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  for (const shift of request.shifts) {
    epochDay(shift.date);
    if (
      !shift.id ||
      ids.has(shift.id) ||
      typeof shift.type !== "string" ||
      !nullableString(shift.startTime) ||
      !nullableString(shift.endTime) ||
      !nullableString(shift.deletedAt)
    )
      throw new Error("Invalid or duplicate shift identity");
    ids.add(shift.id);
  }
  let previousStart = -Infinity;
  for (const interval of request.intervals) {
    if (
      !ids.has(interval.shiftId) ||
      !integer(interval.startMs) ||
      !integer(interval.endMs) ||
      interval.startMs >= interval.endMs ||
      interval.startMs < previousStart ||
      interval.startMs < first.startMs ||
      interval.endMs > last.endMs
    )
      throw new Error("Invalid or unsorted pilot interval");
    previousStart = interval.startMs;
  }
  if (request.holidays.some((day) => !integer(day))) throw new Error("Invalid holiday day");
}
