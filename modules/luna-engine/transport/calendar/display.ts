import { EngineTransportError } from "../protocol";
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export interface CalendarEntryDisplayIntent {
  readonly labelMode: "FULL" | "SHORT" | "SYMBOL";
  readonly showShiftTimes: boolean;
  readonly showShiftDuration: boolean;
  readonly rowCapacity: number;
  readonly detailedShifts: boolean;
  readonly reserveOverflow: boolean;
}
/** Closed, small raw appearance intent. It contains no computed calendar facts. */
export function captureCalendarEntryDisplay(value: unknown): CalendarEntryDisplayIntent {
  if (
    !record(value) ||
    Object.keys(value).length !== 6 ||
    !Object.keys(value).every((k) =>
      [
        "labelMode",
        "showShiftTimes",
        "showShiftDuration",
        "rowCapacity",
        "detailedShifts",
        "reserveOverflow",
      ].includes(k),
    ) ||
    !["FULL", "SHORT", "SYMBOL"].includes(value.labelMode as string) ||
    typeof value.showShiftTimes !== "boolean" ||
    typeof value.showShiftDuration !== "boolean" ||
    typeof value.detailedShifts !== "boolean" ||
    typeof value.reserveOverflow !== "boolean" ||
    !Number.isSafeInteger(value.rowCapacity) ||
    (value.rowCapacity as number) < 0 ||
    (value.rowCapacity as number) > 128
  )
    throw new EngineTransportError("INVALID_CALENDAR_TRANSPORT");
  return Object.freeze({
    labelMode: value.labelMode as CalendarEntryDisplayIntent["labelMode"],
    showShiftTimes: value.showShiftTimes,
    showShiftDuration: value.showShiftDuration,
    rowCapacity: value.rowCapacity as number,
    detailedShifts: value.detailedShifts,
    reserveOverflow: value.reserveOverflow,
  });
}
