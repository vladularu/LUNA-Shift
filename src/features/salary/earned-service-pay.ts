import type { SpecialDutyPayLine } from "@/domain/special-duty-pay";
import type { MonthlyPayEstimate, ShiftEntry } from "@/domain/types";
import { premiumCategory } from "@/engine/net-pay-premium-trace";
import { specialDutyPayrollTraces } from "@/engine/special-duty-payroll-trace";
import { salaryServiceRows, type SalaryClassification } from "./salary-service-presentation";

export const SPECIAL_DUTY_FILTER = "special-duty";

/** Same cash components as the monthly estimate, without turning incomplete evidence into zero. */
export function earnedSpecialDutyCents(line: SpecialDutyPayLine): number | null {
  if (!line.complete || line.baseAmountCents === null) return null;
  const callout = line.calloutPay;
  if (
    callout &&
    (callout.baseAmountCents === null ||
      callout.overtimePremiumCents === null ||
      callout.timePremiumCents === null)
  )
    return null;
  return (
    line.baseAmountCents +
    (callout?.baseAmountCents ?? 0) +
    (callout?.overtimePremiumCents ?? 0) +
    (callout?.timePremiumCents ?? 0)
  );
}

type EarnedServiceRow = Omit<ReturnType<typeof salaryServiceRows>[number], "amountCents"> & {
  readonly amountCents: number | null;
  readonly specialDuty?: SpecialDutyPayLine;
};

export function earnedServiceRows(
  pay: MonthlyPayEstimate | undefined,
  classification: SalaryClassification | null,
  shifts: readonly ShiftEntry[],
  filter: string | null,
): readonly EarnedServiceRow[] {
  const premiums = salaryServiceRows(pay, classification, shifts, filter);
  const duties = pay?.specialDutyBreakdowns ?? [];
  const byId = new Map(shifts.map((shift) => [shift.id, shift]));
  if (classification === null && filter?.startsWith("sfn:")) {
    const category = filter.slice(4);
    // Cash provenance exists before personal tax settings. These are paid tariff
    // components, never an assertion that any portion is tax/SV-free.
    const ordinary = salaryServiceRows(pay, null, shifts).map((row) => ({
      ...row,
      amountCents: row.premiumLines
        .filter((line) => premiumCategory(line.key) === category)
        .reduce((sum, line) => sum + Math.round(line.amount * 100), 0),
    }));
    const special = duties.map((line) => ({
      id: line.shiftId,
      date: line.date,
      shift: byId.get(line.shiftId),
      tax: null,
      premiumLines: [],
      amountCents: specialDutyPayrollTraces([line])
        .flatMap((trace) => trace.payments)
        .filter(
          (payment) =>
            (payment.category ?? (payment.kind === "NIGHT" ? "NIGHT" : "OTHER")) === category,
        )
        .reduce((sum, payment) => sum + payment.amountCents, 0),
    }));
    return [...ordinary, ...special]
      .filter((row) => row.amountCents > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  if (filter !== null && filter !== SPECIAL_DUTY_FILTER) return premiums;
  const specialIds = new Set(duties.map((line) => line.shiftId));
  const specialRows = duties.map((line) => ({
    id: line.shiftId,
    date: line.date,
    shift: byId.get(line.shiftId),
    tax: premiums.find((row) => row.id === line.shiftId)?.tax ?? null,
    premiumLines: [],
    amountCents: earnedSpecialDutyCents(line),
    specialDuty: line,
  }));
  // Full readiness cash already contains its SFN premiums. Replace that service's
  // premium row in All; category filters still select only the actual premium.
  return [
    ...(filter === null ? premiums.filter((row) => !specialIds.has(row.id)) : []),
    ...specialRows,
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.shift?.startTime ?? "").localeCompare(b.shift?.startTime ?? "") ||
      a.id.localeCompare(b.id),
  );
}
