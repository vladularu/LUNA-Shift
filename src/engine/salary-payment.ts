import {
  SALARY_PAYMENT_GROUPS,
  salaryComponentPaymentMonth,
  salaryPaymentSources,
  type SalaryPaymentContribution,
  type SalaryPaymentGroup,
  type SalaryPaymentIssue,
  type SalaryPaymentPreferences,
  type SalaryPaymentProjection,
  type SalaryPaymentSource,
  type SalaryPerspective,
} from "@/domain/salary-payment";
import type { MonthlyPayEstimate } from "@/domain/types";

interface SalaryPaymentRequest {
  readonly month: string;
  readonly perspective: SalaryPerspective;
  readonly preferences: SalaryPaymentPreferences;
  readonly source: (month: string) => SalaryPaymentSource;
}

/** The generator and synchronous projection must prepare the same claim months. */
export function salaryPaymentRequiredMonths(
  month: string,
  preferences: SalaryPaymentPreferences,
  perspective: SalaryPerspective,
): readonly string[] {
  return [
    ...new Set([
      month,
      ...(perspective === "EARNED"
        ? []
        : SALARY_PAYMENT_GROUPS.flatMap(
            (group) => salaryPaymentSources(preferences, month, group).months,
          )),
    ]),
  ];
}

function groupAmount(source: SalaryPaymentSource, group: SalaryPaymentGroup): number {
  const { pay } = source;
  const monthly = (pay.confirmedAllowance ?? pay.assessment.suggestedAllowance).endsWith(
    "_MONTHLY",
  );
  switch (group) {
    case "PREMIUMS":
      return pay.timePremiumAmount;
    case "MONTHLY_ALLOWANCE":
      return monthly ? pay.allowanceAmount : 0;
    case "HOURLY_ALLOWANCE":
      return monthly ? 0 : pay.allowanceAmount;
    case "OVERTIME":
      return pay.overtimeAmount;
    case "SPECIAL_DUTY":
      return pay.specialDutyAmount ?? 0;
  }
}

function independentlyKnown(source: SalaryPaymentSource, group: SalaryPaymentGroup): boolean {
  const { profile, pay } = source;
  if (
    profile.manualMonthlyGrossCents != null &&
    !profile.tariff &&
    !profile.nursingTrainingTariff &&
    !profile.vkaETariff &&
    !profile.tvlKrTariff &&
    !profile.tvhKrTariff &&
    !profile.tvUkNursingTariff &&
    !profile.tvalPflegeTariff
  )
    return true;
  if (group === "MONTHLY_ALLOWANCE") return pay.confirmedAllowance !== null;
  return (
    group === "HOURLY_ALLOWANCE" &&
    pay.confirmedAllowance !== null &&
    (pay.confirmedAllowance === "NONE" || pay.confirmedAllowance.endsWith("_MONTHLY"))
  );
}

/** Move already calculated claims; tariff rates, assessments and shift dates stay at source. */
export function projectSalaryPayment(request: SalaryPaymentRequest): SalaryPaymentProjection {
  const { month, perspective, preferences } = request;
  const sources = salaryPaymentRequiredMonths(month, preferences, perspective).map(request.source);
  const byMonth = new Map(sources.map((source) => [source.month, source]));
  const current = byMonth.get(month)!;
  const sameMonth =
    perspective === "PAYOUT" &&
    sources.length === 1 &&
    SALARY_PAYMENT_GROUPS.every(
      (group) => salaryComponentPaymentMonth(preferences, month, group) === month,
    );
  const outgoingContributions: SalaryPaymentContribution[] =
    perspective === "PAYOUT"
      ? SALARY_PAYMENT_GROUPS.flatMap((group) => {
          const paymentMonth = salaryComponentPaymentMonth(preferences, month, group);
          const amountCents = Math.round(groupAmount(current, group) * 100);
          return paymentMonth !== month && amountCents > 0
            ? [{ group, claimMonth: month, paymentMonth, amountCents }]
            : [];
        })
      : [];
  const contributions: SalaryPaymentContribution[] = [
    {
      group: "BASE",
      claimMonth: month,
      paymentMonth: month,
      amountCents: Math.round((current.pay.personalBaseAmount ?? 0) * 100),
    },
    {
      group: "CARE_ALLOWANCE",
      claimMonth: month,
      paymentMonth: month,
      amountCents: Math.round(current.pay.careAllowanceAmount * 100),
    },
    {
      group: "TARIFF_ALLOWANCE",
      claimMonth: month,
      paymentMonth: month,
      amountCents: Math.round(current.pay.tvoedAllowanceAmount * 100),
    },
  ];
  const issues: SalaryPaymentIssue[] = [];
  const warnings = new Set<string>([
    "Gehaltsbeträge sind Prognosen. Prüfe die Ansprüche und Auszahlungsmonate anhand deiner Abrechnung.",
  ]);
  if (!current.pay.available || current.pay.personalBaseAmount === null)
    issues.push({
      kind: "UNAVAILABLE",
      month,
      message: `Die Gehaltsgrundlage für ${month} fehlt. Prüfe deine Gehaltsangaben.`,
    });

  for (const group of SALARY_PAYMENT_GROUPS) {
    const plan =
      perspective === "EARNED"
        ? { months: [month], unresolvedMonths: [] }
        : salaryPaymentSources(preferences, month, group);
    for (const unresolved of plan.unresolvedMonths)
      issues.push({
        kind: "UNCONFIGURED",
        month: unresolved,
        group,
        message: `Der Auszahlungszeitpunkt für Ansprüche aus ${unresolved} fehlt. Richte die Auszahlungsmonate ein.`,
      });
    for (const claimMonth of plan.months) {
      const source = byMonth.get(claimMonth)!;
      const paymentMonth = salaryComponentPaymentMonth(preferences, claimMonth, group);
      contributions.push({
        group,
        claimMonth,
        paymentMonth,
        amountCents: Math.round(groupAmount(source, group) * 100),
      });
      if (perspective === "EARNED" && paymentMonth === null)
        warnings.add(
          "Der Auszahlungszeitpunkt ist noch nicht eingerichtet. Die Ansicht zeigt den Anspruchsmonat.",
        );
      if (!source.pay.available)
        issues.push({
          kind: "UNAVAILABLE",
          month: claimMonth,
          group,
          message: `Ansprüche aus ${claimMonth} konnten nicht vollständig berechnet werden. Prüfe die Gehaltsangaben und Dienste dieses Monats.`,
        });
      if (
        !sameMonth &&
        (claimMonth < month || group === "MONTHLY_ALLOWANCE") &&
        source.shifts.length === 0 &&
        !preferences.reviewedEmptyMonths.includes(claimMonth) &&
        !independentlyKnown(source, group)
      )
        issues.push({
          kind: "MISSING_MONTH",
          month: claimMonth,
          group,
          message: `Für ${claimMonth} fehlen Dienste. Ergänze den Monat oder bestätige ausdrücklich, dass keine Dienste vorliegen.`,
        });
      if (
        !sameMonth &&
        (group === "MONTHLY_ALLOWANCE" || group === "HOURLY_ALLOWANCE") &&
        source.pay.confirmedAllowance === null &&
        source.pay.assessment.requiresConfirmation &&
        source.pay.assessment.criteria.some((criterion) => criterion.state === "OPEN") &&
        !independentlyKnown(source, group)
      )
        issues.push({
          kind: "UNAVAILABLE",
          month: claimMonth,
          group,
          message: `Für die Zulage aus ${claimMonth} fehlen erforderliche Angaben. Prüfe den Zulagenanspruch und deine Schichtmodell-Angaben.`,
        });
      if (source.pay.confirmedAllowance === null && source.pay.allowanceAmount !== 0)
        warnings.add(
          `Die Zulage für ${claimMonth} ist ein Vorschlag. Prüfe den Anspruch für diesen Monat.`,
        );
      if (source.pay.assessment.estimateNote) warnings.add(source.pay.assessment.estimateNote);
    }
  }
  const sum = (...groups: readonly SalaryPaymentContribution["group"][]) =>
    contributions
      .filter((part) => groups.includes(part.group))
      .reduce((total, part) => total + part.amountCents, 0) / 100;
  const selectedSources = (groups: readonly SalaryPaymentGroup[]) =>
    sources.filter((source) =>
      contributions.some(
        (part) =>
          part.claimMonth === source.month && groups.includes(part.group as SalaryPaymentGroup),
      ),
    );
  const specialSources = selectedSources(["SPECIAL_DUTY"]);
  const available = issues.length === 0;
  const pay: MonthlyPayEstimate = {
    ...current.pay,
    available,
    shiftBreakdowns: selectedSources(["PREMIUMS", "OVERTIME"]).flatMap(
      (source) => source.pay.shiftBreakdowns,
    ),
    timePremiumAmount: sum("PREMIUMS"),
    overtimeAmount: sum("OVERTIME"),
    allowanceAmount: sum("MONTHLY_ALLOWANCE", "HOURLY_ALLOWANCE"),
    ...(specialSources.some((source) => source.pay.specialDutyAmount !== undefined) ||
    current.pay.specialDutyAmount !== undefined
      ? { specialDutyAmount: sum("SPECIAL_DUTY") }
      : {}),
    ...(current.pay.specialDutyBreakdowns !== undefined ||
    specialSources.some((source) => source.pay.specialDutyBreakdowns !== undefined)
      ? {
          specialDutyBreakdowns: specialSources.flatMap(
            (source) => source.pay.specialDutyBreakdowns ?? [],
          ),
        }
      : {}),
    ...(current.pay.specialDutyNotes !== undefined ||
    specialSources.some((source) => source.pay.specialDutyNotes !== undefined)
      ? {
          specialDutyNotes: [
            ...new Set(specialSources.flatMap((source) => source.pay.specialDutyNotes ?? [])),
          ],
        }
      : {}),
    estimatedGrossAmount: available
      ? contributions.reduce((total, part) => total + part.amountCents, 0) / 100
      : null,
  };
  return {
    month,
    perspective,
    pay,
    sources,
    contributions,
    outgoingContributions,
    issues,
    warnings: [...warnings],
    available,
  };
}
