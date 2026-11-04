import type { NetPayResult } from "@/domain/net-pay";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";

export function netPayEuro(cents: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

type AvailableNetPay = Extract<NetPayResult, { status: "available" }>;

export function netPayForecastEuro(result: AvailableNetPay) {
  if (result.calculationBasis?.status !== "PREVIOUS_YEAR_ESTIMATE")
    return netPayEuro(result.netCents);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(result.netCents / 1_000) * 10);
}

export function netPayForecastLabel(result: AvailableNetPay) {
  const basis = result.calculationBasis;
  return basis?.status === "PREVIOUS_YEAR_ESTIMATE"
    ? `${basis.payrollYear} vorläufig · Abzüge nach Stand ${basis.rulesYear}`
    : null;
}

export function netPayCrossYearLabel(timing: AutomaticNetPayForecast["payrollTimingEstimate"]) {
  const estimate = timing?.crossYearTaxEstimate;
  if (!estimate) return null;
  return estimate.annualBasis === "PAYROLL"
    ? "Jahreswechsel geschätzt · Auszahlung zum Monatsende, mit deinen Jahreswerten."
    : "Jahreswechsel geschätzt · Auszahlung zum Monatsende, Jahresbrutto hochgerechnet.";
}
