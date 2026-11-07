import {
  summarizeAnnualNetPay,
  type AnnualNetPay,
  type AnnualNetPayMonth,
  type AnnualNetPayRequest,
} from "./annual-net-pay";

/** Complete inputs, including dated settings and restrictions; catalog is hashed separately. */
export function annualNetPayKey(request: AnnualNetPayRequest) {
  return (
    "annual-net:v1:" +
    JSON.stringify({ ...request, context: { ...request.context, resolver: undefined } })
  );
}

// Separate from the January salary row without changing the disposable SQLite schema.
export function annualNetPayPeriod(year: number) {
  return String(year);
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const cents = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isSafeInteger(value));
const notes = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 24 &&
  value.every((note: unknown) => typeof note === "string" && note.length <= 1000);

/** Reject incomplete/corrupt financial snapshots, including totals inconsistent with month rows. */
export function persistentAnnualNetPay(value: unknown, year: number): value is AnnualNetPay {
  if (
    !record(value) ||
    value.year !== year ||
    !Number.isInteger(year) ||
    !Array.isArray(value.months) ||
    value.months.length !== 12 ||
    !cents(value.netCents) ||
    !notes(value.notes) ||
    typeof value.preliminary !== "boolean"
  )
    return false;
  const months: AnnualNetPayMonth[] = [];
  for (let index = 0; index < 12; index++) {
    const month: unknown = value.months[index];
    if (
      !record(month) ||
      month.month !== `${year}-${String(index + 1).padStart(2, "0")}` ||
      !cents(month.netCents) ||
      !notes(month.notes) ||
      typeof month.preliminary !== "boolean" ||
      !(month.status === null || (typeof month.status === "string" && month.status.length <= 2000))
    )
      return false;
    if (
      month.netCents === null
        ? month.status === null || month.notes.length !== 0 || month.preliminary
        : month.status !== null
    )
      return false;
    // The preparation catch represents a failed attempt, not an authoritative empty month.
    if (month.status === "Die vollständige Gehaltsprognose konnte nicht berechnet werden.")
      return false;
    months.push(month as unknown as AnnualNetPayMonth);
  }
  const summary = summarizeAnnualNetPay(year, months);
  return (
    cents(summary.netCents) &&
    summary.netCents === value.netCents &&
    summary.availableMonthCount === value.availableMonthCount &&
    summary.preliminary === value.preliminary &&
    JSON.stringify(summary.notes) === JSON.stringify(value.notes)
  );
}
