import { Temporal } from "@js-temporal/polyfill";
import type { ShiftEntry, MonthlyPayEstimate } from "@/domain/types";
import type { SfnClassificationResult } from "@/domain/net-pay-sfn";
import { buildPremiumBreakdown, premiumAmount } from "@/features/analysis/premium-breakdown";

export type SalaryClassification = Extract<SfnClassificationResult, { status: "available" }>;

// Keep German service labels independent of Temporal/Intl runtime localization.
export function salaryServiceDate(date: string, includeWeekday = false): string {
  const parsed = Temporal.PlainDate.from(date);
  const short = `${String(parsed.day).padStart(2, "0")}.${String(parsed.month).padStart(2, "0")}.`;
  const weekdays = ["Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa.", "So."] as const;
  return includeWeekday ? `${weekdays[parsed.dayOfWeek - 1]} ${short}` : short;
}

// Display dates follow the same next-day convention as the existing shift engine.
export function salaryShiftTime(shift: ShiftEntry | undefined) {
  if (!shift?.startTime || !shift.endTime)
    return { interval: "Ganztägig", endDate: null, nextDay: false };
  const nextDay =
    Temporal.PlainTime.compare(
      Temporal.PlainTime.from(shift.endTime),
      Temporal.PlainTime.from(shift.startTime),
    ) <= 0;
  const endDate = Temporal.PlainDate.from(shift.date)
    .add({ days: nextDay ? 1 : 0 })
    .toString();
  return { interval: `${shift.startTime}–${shift.endTime}`, endDate, nextDay };
}

export function salaryServiceRows(
  pay: MonthlyPayEstimate | undefined,
  classification: SalaryClassification | null,
  shifts: readonly ShiftEntry[],
  filter: string | null = null,
) {
  const byId = new Map(shifts.map((shift) => [shift.id, shift]));
  const classified = new Map(classification?.shifts.map((row) => [row.shiftId, row]) ?? []);
  const raw = pay ? buildPremiumBreakdown(pay.shiftBreakdowns, shifts, filter) : null;
  const ids = raw ? raw.rows.map((row) => row.shiftId) : [...classified.keys()];
  return ids
    .map((id) => {
      const detail = raw?.rows.find((row) => row.shiftId === id);
      const tax = classified.get(id) ?? null;
      const amountCents =
        filter === null && tax
          ? tax.paidPremiumCents
          : detail
            ? Math.round(premiumAmount(detail.premiumLines) * 100)
            : (tax?.paidPremiumCents ?? 0);
      return {
        id,
        shift: byId.get(id),
        date: detail?.date ?? byId.get(id)?.date ?? "",
        tax,
        premiumLines: detail?.premiumLines ?? [],
        amountCents,
      };
    })
    .filter((row) => row.amountCents > 0)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.shift?.startTime ?? "").localeCompare(b.shift?.startTime ?? "") ||
        a.id.localeCompare(b.id),
    );
}
