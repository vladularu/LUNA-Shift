import { isNetPayPensionScheme, netPayPensionMaxOwnRate } from "./net-pay-pension-schemes";
import type { NetPayPensionScheme } from "./net-pay-pension-schemes";
import { validateAnnualSalaryPayments, type AnnualSalaryPayment } from "./annual-salary-payment";
export type { NetPayPensionScheme } from "./net-pay-pension-schemes";

export interface NetPayAutomation {
  readonly fullMonthAndPayConfirmed: true;
  readonly plannedWorkConfirmed: true;
  readonly additionalRecurringGrossCents: number;
  readonly additionalNetDeductionCents: number;
  readonly pensionScheme: NetPayPensionScheme;
  /** Optional EZVK employee share; missing/null means unknown, zero explicitly means none. */
  readonly pensionEmployeeRateBps?: number | null;
  readonly annualPayments?: readonly AnnualSalaryPayment[];
}

export function validateNetPayAutomation(value: unknown): NetPayAutomation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Die Grundlagen der automatischen Netto-Prognose fehlen.");
  const row = value as Record<string, unknown>;
  const hasOwnRate = Object.hasOwn(row, "pensionEmployeeRateBps");
  const maxOwnRate = isNetPayPensionScheme(row.pensionScheme)
    ? netPayPensionMaxOwnRate(row.pensionScheme)
    : null;
  const keys = [
    "fullMonthAndPayConfirmed",
    "plannedWorkConfirmed",
    "additionalRecurringGrossCents",
    "additionalNetDeductionCents",
    "pensionScheme",
    ...(hasOwnRate ? ["pensionEmployeeRateBps"] : []),
    ...(Object.hasOwn(row, "annualPayments") ? ["annualPayments"] : []),
  ];
  if (
    Object.keys(row).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(row, key)) ||
    row.fullMonthAndPayConfirmed !== true ||
    row.plannedWorkConfirmed !== true ||
    !isNetPayPensionScheme(row.pensionScheme) ||
    (hasOwnRate &&
      (maxOwnRate === null ||
        (row.pensionEmployeeRateBps !== null &&
          (typeof row.pensionEmployeeRateBps !== "number" ||
            !Number.isSafeInteger(row.pensionEmployeeRateBps) ||
            row.pensionEmployeeRateBps < 0 ||
            row.pensionEmployeeRateBps > maxOwnRate)))) ||
    ![row.additionalRecurringGrossCents, row.additionalNetDeductionCents].every(
      (amount) =>
        typeof amount === "number" &&
        Number.isSafeInteger(amount) &&
        amount >= 0 &&
        amount <= 10_000_000,
    )
  )
    throw new Error("Die Grundlagen der automatischen Netto-Prognose sind unvollständig.");
  return Object.freeze({
    ...row,
    ...(Object.hasOwn(row, "annualPayments")
      ? { annualPayments: validateAnnualSalaryPayments(row.annualPayments) }
      : {}),
  }) as unknown as NetPayAutomation;
}
