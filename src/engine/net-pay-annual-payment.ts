import { Temporal } from "@js-temporal/polyfill";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { validateAnnualSalaryPayments } from "@/domain/annual-salary-payment";
import type { NetPayProfile, NetPayResult, NetPaySocialInsurance } from "@/domain/net-pay";
import { calculateTax2026 } from "./net-pay";
import { calculateNetPaySocialInsurance2026, NET_PAY_RULES_2026 } from "./net-pay-social-insurance";

type AvailablePay = Extract<NetPayResult, { status: "available" }>;
export interface AnnualPaymentForecast {
  readonly grossCents: number;
  readonly totalGrossCents: number;
  readonly netIncluded: boolean;
  readonly pensionOmitted: boolean;
  readonly note: string;
}

export function addAnnualSalaryPayment(
  pay: AvailablePay,
  profile: NetPayProfile,
  payments: readonly AnnualSalaryPayment[],
): { readonly pay: AvailablePay; readonly annualPayment?: AnnualPaymentForecast } {
  const confirmed = validateAnnualSalaryPayments(payments);
  const payment = confirmed.find((p) => p.payoutMonth === pay.month);
  if (!payment || payment.grossCents === 0) return { pay };
  const totalGrossCents = pay.amounts.grossCents + payment.grossCents;
  const pensionOmitted = !!pay.pension && pay.pension.scheme !== "NONE";
  const excluded = (note: string) => ({
    pay,
    annualPayment: {
      grossCents: payment.grossCents,
      totalGrossCents,
      netIncluded: false,
      pensionOmitted,
      note,
    },
  });
  if (!payment.netBasis) return excluded("Netto ohne Sonderzahlung · Jahresgrundlagen ergänzen.");
  const month = Number(pay.month.slice(5));
  const rules = NET_PAY_RULES_2026;
  let days: number;
  let annualTaxableGrossCents: number;
  let healthAssessed: number;
  let pensionAssessed: number;
  if (payment.netBasis.kind === "PAYROLL") {
    days = payment.netBasis.socialInsuranceDays;
    annualTaxableGrossCents = payment.netBasis.annualTaxableGrossCents;
    healthAssessed = payment.netBasis.healthAssessedCents;
    pensionAssessed = payment.netBasis.pensionAssessedCents;
  } else {
    days = month * 30;
    annualTaxableGrossCents = pay.amounts.taxableGrossCents * 12;
    healthAssessed =
      Math.min(pay.amounts.socialInsuranceGrossCents, rules.healthMonthlyLimitCents) * month;
    pensionAssessed =
      Math.min(pay.amounts.socialInsuranceGrossCents, rules.pensionMonthlyLimitCents) * month;
    // Earlier payments consume each branch's annual room, not another monthly BBG.
    for (const prior of confirmed
      .filter((p) => p.payoutMonth.startsWith(pay.month.slice(0, 4)) && p.payoutMonth < pay.month)
      .sort((a, b) => a.payoutMonth.localeCompare(b.payoutMonth))) {
      const priorMonth = Number(prior.payoutMonth.slice(5));
      const regularHealth = Math.min(
        pay.amounts.socialInsuranceGrossCents,
        rules.healthMonthlyLimitCents,
      );
      const regularPension = Math.min(
        pay.amounts.socialInsuranceGrossCents,
        rules.pensionMonthlyLimitCents,
      );
      const usedHealthBonuses = healthAssessed - regularHealth * month;
      const usedPensionBonuses = pensionAssessed - regularPension * month;
      healthAssessed += Math.min(
        prior.grossCents,
        Math.max(
          0,
          (rules.healthMonthlyLimitCents - regularHealth) * priorMonth - usedHealthBonuses,
        ),
      );
      pensionAssessed += Math.min(
        prior.grossCents,
        Math.max(
          0,
          (rules.pensionMonthlyLimitCents - regularPension) * priorMonth - usedPensionBonuses,
        ),
      );
      annualTaxableGrossCents += prior.grossCents;
    }
  }
  const healthLimit = Math.floor((rules.healthMonthlyLimitCents * days) / 30);
  const pensionLimit = Math.floor((rules.pensionMonthlyLimitCents * days) / 30);
  if (
    annualTaxableGrossCents < pay.amounts.taxableGrossCents ||
    healthAssessed < pay.socialInsurance.healthBasisCents ||
    pensionAssessed < pay.socialInsurance.pensionBasisCents
  )
    return excluded(
      "Netto ohne Sonderzahlung · Die Jahreswerte müssen den laufenden Auszahlungsmonat einschließen.",
    );
  if (healthAssessed > healthLimit || pensionAssessed > pensionLimit)
    return excluded(
      "Die bisherigen SV-Beitragsgrundlagen überschreiten die anteiligen Jahresgrenzen. Bitte prüfen.",
    );
  const limits = {
    healthCents: healthLimit - healthAssessed,
    pensionCents: pensionLimit - pensionAssessed,
  };
  if (
    month <= 3 &&
    (payment.grossCents > limits.healthCents || payment.grossCents > limits.pensionCents)
  )
    return excluded("Netto ohne Sonderzahlung · Für die Märzklausel fehlen die Vorjahresdaten.");
  const birth = Temporal.PlainDate.from(profile.birthDate);
  const childless =
    !profile.isParent &&
    Temporal.PlainDate.compare(
      birth.add({ years: 23 }),
      Temporal.PlainDate.from(`${pay.month}-01`),
    ) < 0;
  const extraInsurance = calculateNetPaySocialInsurance2026(
    payment.grossCents,
    profile,
    childless,
    limits,
  );
  const socialInsurance = Object.fromEntries(
    Object.keys(pay.socialInsurance).map((key) => [
      key,
      pay.socialInsurance[key as keyof NetPaySocialInsurance] +
        extraInsurance[key as keyof NetPaySocialInsurance],
    ]),
  ) as unknown as NetPaySocialInsurance;
  const tax = calculateTax2026(pay.amounts.taxableGrossCents, profile, childless, {
    grossCents: payment.grossCents,
    annualTaxableGrossCents,
  });
  const netCents =
    totalGrossCents -
    tax.totalCents -
    socialInsurance.totalCents -
    (pay.pension?.employeeCents ?? 0) -
    (pay.additionalNetDeductionCents ?? 0);
  if (!Number.isSafeInteger(netCents) || netCents < 0)
    return excluded(
      "Netto ohne Sonderzahlung · Die Jahresgrundlagen ergeben kein gültiges Ergebnis.",
    );
  return {
    pay: {
      ...pay,
      amounts: {
        ...pay.amounts,
        grossCents: totalGrossCents,
        taxableGrossCents: pay.amounts.taxableGrossCents + payment.grossCents,
        socialInsuranceGrossCents: pay.amounts.socialInsuranceGrossCents + payment.grossCents,
      },
      tax,
      socialInsurance,
      netCents,
    },
    annualPayment: {
      grossCents: payment.grossCents,
      totalGrossCents,
      netIncluded: true,
      pensionOmitted,
      note: [
        payment.netBasis.kind === "CONSTANT_PAY"
          ? "Sonderzahlung enthalten · Jahresprognose mit gleichbleibendem laufendem Entgelt und durchgehender SV-Pflicht seit Januar."
          : "Sonderzahlung enthalten · mit deinen Jahresgrundlagen.",
        pensionOmitted
          ? "Zusatzversorgung und deren Steuer-/SV-Auswirkungen für die Sonderzahlung fehlen noch."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}
