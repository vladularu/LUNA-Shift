import type { PilotDay, PilotInterval, PilotRequest, PilotShift } from "./protocol";

export const YEAR_ENGINE_VERSION = "luna-rest-year-v1";
export interface SharedYearRequest extends Omit<PilotRequest, "days" | "shifts" | "intervals"> {
  readonly days: readonly number[];
  readonly shifts: readonly number[];
  readonly intervals: readonly number[];
}
export interface SharedYearBatch {
  readonly schemaVersion: 2;
  readonly requestId: string;
  readonly days: readonly PilotDay[];
  readonly shifts: readonly PilotShift[];
  readonly intervals: readonly PilotInterval[];
  readonly requests: readonly SharedYearRequest[];
}

/** Pool shared values once; keep ordered references and complete per-job windows. */
export function packYearRequests(requestId: string, requests: readonly PilotRequest[]) {
  const days: PilotDay[] = [],
    shifts: PilotShift[] = [],
    intervals: PilotInterval[] = [];
  const dayIds = new Map<string, number>(),
    shiftIds = new Map<string, number>(),
    intervalIds = new Map<string, number>();
  const pool = <T>(values: T[], ids: Map<string, number>, key: string, value: T) => {
    const found = ids.get(key);
    if (found !== undefined) return found;
    const index = values.length;
    values.push(value);
    ids.set(key, index);
    return index;
  };
  const unique: SharedYearRequest[] = [],
    keys = new Map<string, number>();
  const indices = requests.map((request) => {
    const prepared = {
      ...request,
      days: request.days.map((day) =>
        pool(
          days,
          dayIds,
          JSON.stringify([request.timeZone, day.day, day.startMs, day.endMs]),
          day,
        ),
      ),
      shifts: request.shifts.map((shift) => pool(shifts, shiftIds, JSON.stringify(shift), shift)),
      intervals: request.intervals.map((interval) =>
        pool(intervals, intervalIds, JSON.stringify(interval), interval),
      ),
    };
    // month/id are protocol identity only; the kernel uses explicit windows.
    const { id: _id, month: _month, ...facts } = prepared;
    const key = JSON.stringify(facts);
    const found = keys.get(key);
    if (found !== undefined) return found;
    const index = unique.length;
    keys.set(key, index);
    unique.push({ ...prepared, id: `r${index}` });
    return index;
  });
  const batch: SharedYearBatch = {
    schemaVersion: 2,
    requestId,
    days,
    shifts,
    intervals,
    requests: unique,
  };
  return { batch, indices };
}
