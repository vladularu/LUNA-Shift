import { Temporal } from "@js-temporal/polyfill";
import type { NetPayProfile, NetPayResult } from "@/domain/net-pay";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { calculateTax2026 } from "./net-pay";

type AvailablePay = Extract<NetPayResult, { status: "available" }>;

/**
 * R 39b.2(2) no. 8 / R 39b.6 LStR: prior-year arrears received after
 * January 21 are other remuneration, not another recurring monthly wage.
 * The app knows a payout month, not a bank date: explicitly assume month-end.
 * Only tax changes here; these are still recurring earnings for source-period SV.
 */
export function estimateCrossYearArrearsTax(
  base: AvailablePay,
  regular: AvailablePay,
  profile: NetPayProfile,
  settings: MonthlyNetPaySettings,
  priorYearTaxableCents: number,
  includedAnnualGrossCents: number,
) {
  if (base.calculationBasis?.rulesYear !== 2026)
    throw new Error("Die Steuergrundlagen des Auszahlungsjahres fehlen.");
  const payments = settings.automation!.annualPayments ?? [];
  const payment = payments.find((value) => value.payoutMonth === base.month);
  // Explicit annual payroll evidence wins over a constant-current-pay forecast.
  const annualTaxableGrossCents =
    payment?.netBasis?.kind === "PAYROLL"
      ? payment.netBasis.annualTaxableGrossCents
      : regular.amounts.taxableGrossCents * 12 +
        payments
          .filter(
            (value) =>
              value.payoutMonth.startsWith(base.month.slice(0, 4)) &&
              value.payoutMonth < base.month,
          )
          .reduce((sum, value) => sum + value.grossCents, 0);
  if (
    !Number.isSafeInteger(priorYearTaxableCents) ||
    priorYearTaxableCents < 0 ||
    !Number.isSafeInteger(annualTaxableGrossCents) ||
    annualTaxableGrossCents < base.amounts.taxableGrossCents
  )
    throw new Error("Die Jahressteuergrundlagen der Nachzahlung sind widersprüchlich.");
  const childless =
    !profile.isParent &&
    Temporal.PlainDate.compare(
      Temporal.PlainDate.from(profile.birthDate).add({ years: 23 }),
      Temporal.PlainDate.from(`${base.month}-01`),
    ) < 0;
  return {
    tax: calculateTax2026(base.amounts.taxableGrossCents, profile, childless, {
      // Combine both other-remuneration amounts once so progression is not duplicated.
      grossCents: priorYearTaxableCents + includedAnnualGrossCents,
      annualTaxableGrossCents,
    }),
    estimate: Object.freeze({
      assumedPayment: "MONTH_END" as const,
      annualTaxableGrossCents,
      annualBasis:
        payment?.netBasis?.kind === "PAYROLL"
          ? ("PAYROLL" as const)
          : ("CURRENT_REGULAR_PAY" as const),
    }),
  };
}
