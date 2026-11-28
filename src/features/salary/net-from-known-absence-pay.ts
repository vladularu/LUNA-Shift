import { absencePayTariffAt } from "@/domain/absence-pay";
import { useMemo } from "react";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import type { MonthlyNetPaySettings, SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { SalaryPaymentPreferences, SalaryPaymentProjection } from "@/domain/salary-payment";
import type { MonthlyPayEstimate, UserProfile } from "@/domain/types";
import {
  prepareAutomaticSalaryProofSteps,
  type AutomaticNetPayForecast,
  type AutomaticNetPayInput,
} from "@/engine/net-pay-automatic-forecast";
import { calculateAutomaticPaymentNetPayForecast } from "@/engine/net-pay-payment-forecast";
import type { RuleResolver } from "@/rules/rule-resolver";

export type AbsenceNetBasis = {
  profile: UserProfile | null;
  resolver: RuleResolver;
  attribution: SalaryPaymentPreferences["socialInsuranceAttribution"];
};

function knownPay(pay: MonthlyPayEstimate) {
  if (pay.available) return pay;
  if (
    !pay.absencePayNotes?.length ||
    pay.knownGrossAmount == null ||
    pay.specialDutyNotes?.length ||
    pay.specialDutyBreakdowns?.some((line) => !line.complete)
  )
    return null;
  // Only for the labelled estimate. The stored claim and unresolved days keep their original status.
  return { ...pay, estimatedGrossAmount: pay.knownGrossAmount, available: true };
}

/** The worked shifts retain their own SFN evidence while a separate absence claim is open. */
export function classifyServicesWithOpenAbsence(
  input: AutomaticNetPayInput,
  resolver: RuleResolver,
) {
  if (input.pay.available || !input.pay.absencePayNotes?.length) return null;
  const pay = knownPay(input.pay);
  if (!pay) return null;
  const proof = prepareAutomaticSalaryProofSteps({ ...input, pay }, resolver);
  let step = proof.next();
  while (!step.done) step = proof.next();
  return step.value.status === "available" ? step.value.classification : null;
}

export function netFromKnownAbsencePay(
  base: AutomaticNetPayForecast | null,
  projection: SalaryPaymentProjection | undefined,
  basis: AbsenceNetBasis | undefined,
  settings: MonthlyNetPaySettings | null,
  timeline: readonly SavedMonthlyNetPaySettings[],
  annual: readonly AnnualSalaryPayment[],
): { forecast: AutomaticNetPayForecast | null; notice?: string } {
  if (
    !projection ||
    !basis?.profile ||
    !settings?.automation ||
    !base ||
    base.result.status === "available" ||
    projection.perspective !== "PAYOUT" ||
    projection.issues.some((i) => i.kind !== "UNAVAILABLE" || i.group !== "ABSENCE_PAY")
  )
    return { forecast: base };
  const reason = base.result.reason;
  if (
    reason !== "Die vollständige Brutto-Gehaltsprognose fehlt." &&
    // Build 57 returns this when a cash month is complete but its source has an open claim.
    reason !==
      "Die Anspruchs- und Auszahlungsgrundlagen konnten nicht vollständig zugeordnet werden." &&
    !projection.issues.some((i) => i.message === reason)
  )
    return { forecast: base };
  const pending = projection.sources.flatMap((s) => s.pay.absencePayNotes ?? []);
  if (!pending.length) return { forecast: base };
  const pay = knownPay(projection.pay);
  if (!pay) return { forecast: base };
  const sources = [];
  for (const source of projection.sources) {
    const known = knownPay(source.pay);
    if (!known) return { forecast: base };
    sources.push(known === source.pay ? source : { ...source, pay: known });
  }
  const forecast = calculateAutomaticPaymentNetPayForecast(
    {
      month: projection.month,
      profile: basis.profile,
      sourceSettings: timeline,
      settings: { ...settings, automation: { ...settings.automation, annualPayments: annual } },
      socialInsuranceAttribution: basis.attribution,
      projection: { ...projection, available: true, issues: [], pay, sources },
    },
    basis.resolver,
  );
  if (forecast.result.status !== "available") return { forecast };
  const dates = [
    ...new Set(
      pending.map((note) => note.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ].sort();
  const day = dates[0]?.split("-").reverse().join(".");
  const when = day
    ? dates.length === 1
      ? " für den " + day
      : " für " + dates.length + " Tage ab " + day
    : "";
  return {
    forecast,
    notice:
      (dates[0] && absencePayTariffAt(basis.profile, dates[0]) === "VKA"
        ? "Der Aufschlag nach § 21"
        : "Der U/K-Aufschlag") +
      when +
      " ist noch offen. " +
      (pending.find((note) => note.startsWith(dates[0] + " · "))?.slice(13) ?? "") +
      " Das vorläufige Netto berücksichtigt die bekannten Beträge.",
  };
}

export function useNetFromKnownAbsencePay(
  ...[base, projection, basis, settings, timeline, annual]: Parameters<
    typeof netFromKnownAbsencePay
  >
) {
  const profile = basis?.profile,
    resolver = basis?.resolver,
    attribution = basis?.attribution;
  return useMemo(
    () =>
      netFromKnownAbsencePay(
        base,
        projection,
        resolver ? { profile: profile ?? null, resolver, attribution } : undefined,
        settings,
        timeline,
        annual,
      ),
    [base, projection, profile, resolver, attribution, settings, timeline, annual],
  );
}
