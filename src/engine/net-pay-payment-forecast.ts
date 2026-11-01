import { Temporal } from "@js-temporal/polyfill";
import { captureEmploymentProfile } from "@/domain/employment-history";
import {
  resolveNetPaySettings,
  type MonthlyNetPaySettings,
  type SavedMonthlyNetPaySettings,
} from "@/domain/net-pay-profile";
import {
  SALARY_PAYMENT_GROUPS,
  type SalaryPaymentContribution,
  type SalaryPaymentProjection,
  type SalaryPaymentSource,
  type SalaryPaymentSocialInsuranceAttribution,
} from "@/domain/salary-payment";
import type { MonthlyPayEstimate, UserProfile } from "@/domain/types";
import type { NetPayResult } from "@/domain/net-pay";
import type { RuleResolver } from "@/rules/rule-resolver";
import { resolveNetPayCalculationBasis } from "./net-pay-calculation-basis";
import {
  calculateAutomaticNetPayForecastSteps,
  finalizeAutomaticSalaryNetSteps,
  prepareAutomaticSalaryProofSteps,
  type AutomaticNetPayForecast,
  type AutomaticNetPayRecovery,
  type AutomaticSalaryProof,
} from "./net-pay-automatic-forecast";

export interface AutomaticPaymentNetPayInput {
  readonly month: string;
  readonly profile: UserProfile;
  readonly settings: MonthlyNetPaySettings;
  readonly projection: SalaryPaymentProjection;
  readonly sourceSettings: readonly SavedMonthlyNetPaySettings[];
  /** Confirmed employer practice for regularly delayed variable remuneration only. */
  readonly socialInsuranceAttribution?: SalaryPaymentSocialInsuranceAttribution;
}

type Group = SalaryPaymentContribution["group"];

function cents(amount: number) {
  const value = Math.round(amount * 100);
  if (!Number.isSafeInteger(value) || value < 0 || Math.abs(value - amount * 100) > 0.000001)
    throw new Error("Ungültiger Geldbetrag.");
  return value;
}

function groupAmount(pay: MonthlyPayEstimate, group: Group): number {
  const monthly = (pay.confirmedAllowance ?? pay.assessment.suggestedAllowance).endsWith(
    "_MONTHLY",
  );
  switch (group) {
    case "BASE":
      return cents(pay.personalBaseAmount!);
    case "CARE_ALLOWANCE":
      return cents(pay.careAllowanceAmount);
    case "TARIFF_ALLOWANCE":
      return cents(pay.tvoedAllowanceAmount);
    case "PREMIUMS":
      return cents(pay.timePremiumAmount);
    case "MONTHLY_ALLOWANCE":
      return monthly ? cents(pay.allowanceAmount) : 0;
    case "HOURLY_ALLOWANCE":
      return monthly ? 0 : cents(pay.allowanceAmount);
    case "OVERTIME":
      return cents(pay.overtimeAmount);
    case "SPECIAL_DUTY":
      return cents(pay.specialDutyAmount ?? 0);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}

function rowsFor(proof: AutomaticSalaryProof, groups: readonly Group[]) {
  const ids = new Set([
    ...(groups.includes("PREMIUMS") ? proof.regularShiftIds : []),
    ...(groups.includes("SPECIAL_DUTY") ? proof.specialDutyShiftIds : []),
  ]);
  return proof.classification.shifts.filter((row) => ids.has(row.shiftId));
}

type AvailablePay = Extract<NetPayResult, { status: "available" }>;

function completeShiftedBundle(
  month: string,
  selected: readonly SalaryPaymentContribution[],
  sources: ReadonlyMap<string, SalaryPaymentSource>,
) {
  const variables = selected.filter((line) =>
    SALARY_PAYMENT_GROUPS.some((group) => group === line.group),
  );
  if (
    variables.length !== SALARY_PAYMENT_GROUPS.length ||
    new Set(variables.map((line) => line.group)).size !== SALARY_PAYMENT_GROUPS.length ||
    new Set(variables.map((line) => line.claimMonth)).size !== 1
  )
    return null;
  const source = sources.get(variables[0].claimMonth);
  if (!source || source.month === month) return null;
  const lag = Temporal.PlainYearMonth.from(source.month).until(
    Temporal.PlainYearMonth.from(month),
    { largestUnit: "months" },
  ).months;
  return lag === 1 || lag === 2 ? { source, lag: lag as 1 | 2 } : null;
}

/** Ordinary endpoints exclude one-offs and source personal deductions from both sides. */
function ordinarySettings(settings: MonthlyNetPaySettings, month: string): MonthlyNetPaySettings {
  return {
    ...settings,
    specialCases: settings.automation?.annualPayments?.some((payment) =>
      payment.payoutMonth.startsWith(month.slice(0, 4)),
    )
      ? settings.specialCases.filter((value) => value !== "ONE_OFF_PAYMENT")
      : settings.specialCases,
    automation: {
      ...settings.automation!,
      annualPayments: [],
      additionalNetDeductionCents: 0,
    },
  };
}

/** A monetary counterfactual after validating the unchanged original source evidence. */
function baseProof(
  proof: AutomaticSalaryProof,
  pay: MonthlyPayEstimate,
  settings: MonthlyNetPaySettings,
): AutomaticSalaryProof {
  const grossCents =
    cents(pay.personalBaseAmount!) +
    cents(pay.careAllowanceAmount) +
    cents(pay.tvoedAllowanceAmount) +
    settings.automation!.additionalRecurringGrossCents;
  return {
    ...proof,
    classification: Object.freeze({
      ...proof.classification,
      shifts: Object.freeze([]),
      paidPremiumCents: 0,
      taxFreeCents: 0,
      socialInsuranceFreeCents: 0,
      amounts: Object.freeze({
        grossCents,
        taxableGrossCents: grossCents,
        socialInsuranceGrossCents: grossCents,
        // Expected regular income still includes an eligible recurring monthly allowance.
        regularMonthlySocialInsuranceGrossCents: proof.regularGrossCents,
      }),
    }),
  };
}

function addDifference<T extends object>(
  base: T,
  added: T,
  removed: T,
  signedFields: readonly (keyof T)[] = [],
): T {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(base).map(([key, value]) => {
        const plus = added[key as keyof T],
          minus = removed[key as keyof T];
        if (typeof value !== "number") {
          if (value !== plus || value !== minus)
            throw new Error("Unterschiedliche Berechnungsgrundlagen.");
          return [key, value];
        }
        if (typeof plus !== "number" || typeof minus !== "number")
          throw new Error("Ungültige Abzüge.");
        const sum = value + plus - minus;
        if (!Number.isSafeInteger(sum) || (sum < 0 && !signedFields.includes(key as keyof T)))
          throw new Error("Ungültiger marginaler Abzug.");
        return [key, sum];
      }),
    ),
  ) as T;
}

function addPayrollDifference(
  base: AvailablePay,
  added: AvailablePay,
  removed: AvailablePay,
): AvailablePay {
  if (!!base.pension !== !!added.pension || !!base.pension !== !!removed.pension)
    throw new Error("Unterschiedliche Zusatzversorgungsgrundlagen.");
  const pay = Object.freeze({
    ...base,
    amounts: addDifference(base.amounts, added.amounts, removed.amounts),
    tax: addDifference(base.tax, added.tax, removed.tax),
    socialInsurance: addDifference(
      base.socialInsurance,
      added.socialInsurance,
      removed.socialInsurance,
    ),
    ...(base.pension
      ? {
          pension: addDifference(base.pension, added.pension!, removed.pension!, [
            "taxableAdjustmentCents",
            "socialInsuranceAdjustmentCents",
          ]),
        }
      : {}),
    netCents: base.netCents + added.netCents - removed.netCents,
  });
  if (
    !Number.isSafeInteger(pay.netCents) ||
    pay.netCents < 0 ||
    pay.netCents !==
      pay.amounts.grossCents -
        pay.tax.totalCents -
        pay.socialInsurance.totalCents -
        (pay.pension?.employeeCents ?? 0) -
        (pay.additionalNetDeductionCents ?? 0)
  )
    throw new Error("Die marginalen Abzüge passen nicht zum Auszahlungsbrutto.");
  return pay;
}

function* sourceAdjustmentEstimateSteps(
  input: AutomaticPaymentNetPayInput,
  current: SalaryPaymentSource,
  currentProof: AutomaticSalaryProof,
  source: SalaryPaymentSource,
  lag: 1 | 2,
  selected: readonly SalaryPaymentContribution[],
  resolver: RuleResolver,
): Generator<number, AutomaticNetPayForecast, void> {
  const { month, settings, projection } = input;
  const stop = (reason: string, recovery?: AutomaticNetPayRecovery): AutomaticNetPayForecast => ({
    sourceMonth: settings.month,
    result: { status: "unavailable", stage: "net-pay", reason },
    ...(recovery ? { recovery } : {}),
  });
  if (source.month.slice(0, 4) !== month.slice(0, 4))
    return stop(
      "Für verzögerte Zulagen über den Kalenderjahreswechsel fehlen die erforderlichen Abrechnungsgrundlagen.",
    );
  const sourceSettings = resolveNetPaySettings(source.month, input.sourceSettings)?.settings;
  if (sourceSettings?.version !== 2 || !sourceSettings.automation)
    return stop(`Für den Anspruchsmonat ${source.month} fehlen fortgeltende Netto-Grundlagen.`, {
      kind: "net-settings",
      month: source.month,
    });
  const sourceResult = yield* prepareAutomaticSalaryProofSteps(
    { ...source, settings: sourceSettings },
    resolver,
  );
  if (sourceResult.status !== "available")
    return {
      ...sourceResult.forecast,
      sourceMonth: settings.month,
      ...(sourceResult.forecast.recovery?.kind === "net-settings"
        ? { recovery: { kind: "net-settings", month: source.month } as const }
        : {}),
    };
  if (
    (projection.outgoingContributions ?? []).some(
      (line) =>
        line.paymentMonth !== Temporal.PlainYearMonth.from(month).add({ months: lag }).toString(),
    )
  )
    return stop(
      "Für uneinheitlich verschobene Zulagen ist diese Netto-Schätzung noch nicht verfügbar.",
    );
  const currentMonthly = groupAmount(current.pay, "MONTHLY_ALLOWANCE");
  const sourceMonthly = groupAmount(source.pay, "MONTHLY_ALLOWANCE");
  const currentOrdinary = ordinarySettings(settings, month);
  const sourceOrdinary = ordinarySettings(sourceSettings, source.month);
  const fingerprint = (value: MonthlyNetPaySettings) =>
    canonical({
      profile: value.profile,
      specialCases: value.specialCases,
      pensionScheme: value.automation!.pensionScheme,
      pensionEmployeeRateBps: value.automation!.pensionEmployeeRateBps,
      additionalRecurringGrossCents: value.automation!.additionalRecurringGrossCents,
    });
  if (
    canonical(captureEmploymentProfile(currentProof.profile)) !==
      canonical(captureEmploymentProfile(sourceResult.profile)) ||
    // A roster-derived monthly allowance may legitimately change. Compare only the
    // fixed endpoints that will cancel; retain each original month's allowance and
    // regular gross in its SFN/pension proof rather than rewriting either claim.
    currentProof.regularGrossCents - currentMonthly !==
      sourceResult.regularGrossCents - sourceMonthly ||
    canonical(currentProof.classification.calculationBasis) !==
      canonical(sourceResult.classification.calculationBasis) ||
    fingerprint(currentOrdinary) !== fingerprint(sourceOrdinary)
  )
    return stop(
      "Bei geänderten Beschäftigungs-, Steuer- oder Versicherungsgrundlagen ist die verzögerte Netto-Schätzung noch nicht verfügbar.",
    );
  const currentBase = yield* finalizeAutomaticSalaryNetSteps(
    { month, settings: currentOrdinary },
    baseProof(currentProof, current.pay, settings),
  );
  const sourceBase = yield* finalizeAutomaticSalaryNetSteps(
    { month: source.month, settings: sourceOrdinary },
    baseProof(sourceResult, source.pay, sourceSettings),
  );
  const sourceFull = yield* finalizeAutomaticSalaryNetSteps(
    { month: source.month, settings: sourceOrdinary },
    sourceResult,
  );
  if (currentBase.result.status !== "available") return currentBase;
  if (sourceBase.result.status !== "available" || sourceFull.result.status !== "available") {
    const failure = sourceBase.result.status !== "available" ? sourceBase : sourceFull;
    return {
      ...failure,
      sourceMonth: settings.month,
      recovery: { kind: "net-settings", month: source.month },
    };
  }
  // Catches dated PV/age changes even when the saved settings rows are identical.
  const deductions = (pay: AvailablePay) =>
    canonical({ tax: pay.tax, socialInsurance: pay.socialInsurance, pension: pay.pension });
  if (deductions(currentBase.result.pay) !== deductions(sourceBase.result.pay))
    return stop(
      "Die Steuer- oder Versicherungsgrundlagen unterscheiden sich zwischen Dienst- und Auszahlungsmonat.",
    );
  const bundleGross = selected
    .filter((line) => line.claimMonth === source.month)
    .reduce((sum, line) => sum + line.amountCents, 0);
  if (
    sourceFull.result.pay.amounts.grossCents - sourceBase.result.pay.amounts.grossCents !==
    bundleGross
  )
    return stop("Das verschobene Zulagenpaket ist nicht vollständig.");
  let pay = addPayrollDifference(
    currentBase.result.pay,
    sourceFull.result.pay,
    sourceBase.result.pay,
  );
  // Estimate the bundle's withholding with its payout: recompute its marginal
  // deductions in the earned month (including that month's monthly allowance).
  // This does not assert when an employer actually withheld employee SV, nor
  // silently apply the optional cash-period SV simplification to monthly claims.
  const grossCents =
    cents(projection.pay.estimatedGrossAmount!) +
    settings.automation!.additionalRecurringGrossCents;
  const classification = Object.freeze({
    ...sourceResult.classification,
    amounts: Object.freeze({
      grossCents,
      taxableGrossCents: grossCents - sourceResult.classification.taxFreeCents,
      socialInsuranceGrossCents: grossCents - sourceResult.classification.socialInsuranceFreeCents,
      regularMonthlySocialInsuranceGrossCents: currentProof.regularGrossCents,
    }),
  });
  let annualPayment: AutomaticNetPayForecast["annualPayment"];
  if (
    settings.automation!.annualPayments?.some(
      (payment) => payment.payoutMonth === month && payment.grossCents > 0,
    )
  ) {
    // Derive only the one-off increment on a single current-period payroll. Applying
    // addAnnualSalaryPayment to the combined result would overwrite its source tax.
    const nominalSettings = ordinarySettings(settings, month);
    const nominal = yield* finalizeAutomaticSalaryNetSteps(
      { month, settings: nominalSettings },
      { ...currentProof, classification },
    );
    const withAnnual = yield* finalizeAutomaticSalaryNetSteps(
      {
        month,
        settings: {
          ...settings,
          automation: { ...settings.automation!, additionalNetDeductionCents: 0 },
        },
      },
      { ...currentProof, classification },
    );
    if (nominal.result.status !== "available" || withAnnual.result.status !== "available")
      return stop(
        "Die Jahreszahlung konnte nicht getrennt von den verzögerten Zulagen berechnet werden.",
      );
    pay = addPayrollDifference(pay, withAnnual.result.pay, nominal.result.pay);
    annualPayment = withAnnual.annualPayment;
  }
  if (
    pay.amounts.grossCents !==
    grossCents + (annualPayment?.netIncluded ? annualPayment.grossCents : 0)
  )
    return stop("Die Netto-Schätzung passt nicht zum Auszahlungsbrutto.");
  const personalDeduction = settings.automation!.additionalNetDeductionCents;
  if (pay.netCents < personalDeduction)
    return stop("Die persönlichen Netto-Abzüge übersteigen die geschätzte Auszahlung.", {
      kind: "net-settings",
    });
  if (personalDeduction > 0)
    pay = Object.freeze({
      ...pay,
      netCents: pay.netCents - personalDeduction,
      additionalNetDeductionCents: personalDeduction,
    });
  return {
    sourceMonth: settings.month,
    basicHourlyPayCents: sourceResult.basicHourlyPayCents,
    regularGrossCents: currentProof.regularGrossCents,
    pensionOmitted: currentBase.pensionOmitted || sourceFull.pensionOmitted,
    ...(annualPayment ? { annualPayment } : {}),
    payrollTimingEstimate: Object.freeze({
      method: "SOURCE_ADJUSTMENT",
      sourceMonth: source.month,
      lag,
    }),
    result: { status: "available", classification, pay },
  };
}

/** Classify original earned-month evidence, then calculate one cash payroll. */
export function* calculateAutomaticPaymentNetPayForecastSteps(
  input: AutomaticPaymentNetPayInput,
  resolver: RuleResolver,
): Generator<number, AutomaticNetPayForecast, void> {
  const { month, settings, projection } = input;
  const stop = (reason: string): AutomaticNetPayForecast => ({
    sourceMonth: settings.month,
    result: { status: "unavailable", stage: "sfn", reason },
  });
  try {
    if (projection.month !== month || projection.pay.month !== month)
      return stop("Die Auszahlungsgrundlagen gehören zu unterschiedlichen Monaten.");
    if (!projection.available || projection.issues.length > 0)
      return stop(
        projection.issues[0]?.message ?? "Die vollständigen Auszahlungsgrundlagen fehlen.",
      );
    const sources = new Map<string, SalaryPaymentSource>();
    for (const source of projection.sources) {
      if (sources.has(source.month) || source.pay.month !== source.month)
        return stop("Die Anspruchsmonate der Auszahlung sind widersprüchlich.");
      sources.set(source.month, source);
    }
    const current = sources.get(month);
    if (!current) return stop("Die Gehaltsgrundlage des Auszahlungsmonats fehlt.");
    if (projection.perspective === "EARNED")
      return yield* calculateAutomaticNetPayForecastSteps(
        { ...current, profile: input.profile, settings },
        resolver,
      );
    const selected = projection.contributions.filter((line) => line.paymentMonth === month);
    const seen = new Set<string>();
    for (const line of selected) {
      const source = sources.get(line.claimMonth);
      const key = `${line.claimMonth}:${line.group}`;
      const difference = Temporal.PlainYearMonth.from(line.claimMonth).until(
        Temporal.PlainYearMonth.from(month),
        { largestUnit: "months" },
      ).months;
      if (
        !source ||
        seen.has(key) ||
        difference < 0 ||
        difference > 2 ||
        !Number.isSafeInteger(line.amountCents) ||
        line.amountCents < 0 ||
        groupAmount(source.pay, line.group) !== line.amountCents
      )
        return stop("Die Auszahlungsbeträge passen nicht zu ihren Anspruchsmonaten.");
      if (["BASE", "CARE_ALLOWANCE", "TARIFF_ALLOWANCE"].includes(line.group) && difference !== 0)
        return stop("Die laufende Gehaltsgrundlage gehört zu einem anderen Monat.");
      seen.add(key);
    }
    const grossCents = selected.reduce((sum, line) => sum + line.amountCents, 0);
    const pay = projection.pay;
    if (
      !pay.available ||
      pay.estimatedGrossAmount === null ||
      pay.personalBaseAmount === null ||
      grossCents !== cents(pay.estimatedGrossAmount) ||
      [
        pay.personalBaseAmount,
        pay.careAllowanceAmount,
        pay.tvoedAllowanceAmount,
        pay.timePremiumAmount,
        pay.allowanceAmount,
        pay.overtimeAmount,
        pay.specialDutyAmount ?? 0,
      ].reduce((sum, amount) => sum + cents(amount), 0) !== grossCents
    )
      return stop("Die Bestandteile passen nicht zum Auszahlungsbrutto.");
    // The unchanged earned calculation remains the reference for all-zero delays.
    if (
      (projection.outgoingContributions?.length ?? 0) === 0 &&
      selected.every((line) => line.claimMonth === month || line.amountCents === 0) &&
      grossCents === cents(current.pay.estimatedGrossAmount!)
    )
      return yield* calculateAutomaticNetPayForecastSteps(
        { ...current, profile: input.profile, settings },
        resolver,
      );

    const currentResult = yield* prepareAutomaticSalaryProofSteps(
      { ...current, profile: input.profile, settings },
      resolver,
    );
    if (currentResult.status !== "available") return currentResult.forecast;
    const outgoing = projection.outgoingContributions ?? [];
    for (const line of outgoing) {
      if (
        line.claimMonth !== month ||
        !SALARY_PAYMENT_GROUPS.some((group) => group === line.group) ||
        !Number.isSafeInteger(line.amountCents) ||
        line.amountCents <= 0 ||
        seen.has(`${month}:${line.group}`) ||
        groupAmount(current.pay, line.group) !== line.amountCents ||
        !line.paymentMonth
      )
        return stop("Die verzögerten Ansprüche des Auszahlungsmonats sind widersprüchlich.");
      seen.add(`${month}:${line.group}`);
      const difference = Temporal.PlainYearMonth.from(month).until(
        Temporal.PlainYearMonth.from(line.paymentMonth),
        { largestUnit: "months" },
      ).months;
      if (difference < 1 || difference > 2)
        return stop("Für diese Verzögerung fehlen Berechnungsgrundlagen der Sozialversicherung.");
    }
    if (
      SALARY_PAYMENT_GROUPS.some(
        (group) =>
          selected
            .filter((line) => line.claimMonth === month && line.group === group)
            .reduce((sum, line) => sum + line.amountCents, 0) +
            outgoing
              .filter((line) => line.group === group)
              .reduce((sum, line) => sum + line.amountCents, 0) !==
          groupAmount(current.pay, group),
      )
    )
      return stop("Die Zuordnung der aktuellen und verzögerten Ansprüche ist unvollständig.");
    const bundle = completeShiftedBundle(month, selected, sources);
    if (bundle)
      return yield* sourceAdjustmentEstimateSteps(
        input,
        current,
        currentResult,
        bundle.source,
        bundle.lag,
        selected,
        resolver,
      );
    if (outgoing.some((line) => line.group === "MONTHLY_ALLOWANCE"))
      return stop(
        "Die Sozialversicherung einer verzögerten monatlichen Zulage muss dem Anspruchsmonat zugeordnet werden; diese Netto-Prognose ist noch nicht verfügbar.",
      );
    const outgoingGross = outgoing.reduce((sum, line) => sum + line.amountCents, 0);
    const outgoingFree = rowsFor(
      currentResult,
      outgoing.map((line) => line.group),
    ).reduce((sum, row) => sum + row.socialInsuranceFreeCents, 0);
    if (outgoingGross !== outgoingFree && input.socialInsuranceAttribution !== "CASH_VARIABLE")
      return stop(
        "Für beitragspflichtige verzögerte Bezüge fehlt die bestätigte Zuordnung der Sozialversicherung zum Auszahlungsmonat.",
      );
    const currentBasis = resolveNetPayCalculationBasis(month, "FORECAST");
    const proofRows: AutomaticSalaryProof["classification"]["shifts"][number][] = [];
    for (const [sourceMonth, source] of sources) {
      const lines = selected.filter((line) => line.claimMonth === sourceMonth);
      if (!lines.some((line) => line.amountCents > 0)) continue;
      const delayed = sourceMonth !== month;
      const sourceSettings = delayed
        ? (resolveNetPaySettings(sourceMonth, input.sourceSettings)?.settings ?? null)
        : settings;
      if (!sourceSettings?.automation)
        return stop(`Für den Anspruchsmonat ${sourceMonth} fehlen fortgeltende Netto-Grundlagen.`);
      const result = delayed
        ? yield* prepareAutomaticSalaryProofSteps({ ...source, settings: sourceSettings }, resolver)
        : currentResult;
      if (result.status !== "available") return { ...result.forecast, sourceMonth: settings.month };
      const groups = lines.map((line) => line.group);
      const rows = rowsFor(result, groups);
      if (delayed) {
        const sourceBasis = result.classification.calculationBasis;
        if (!currentBasis || !sourceBasis || sourceBasis.rulesYear !== currentBasis.rulesYear)
          return stop(
            "Für die Anspruchs- und Auszahlungsjahre fehlen gemeinsame Berechnungsgrundlagen.",
          );
        if (
          canonical(captureEmploymentProfile(result.profile)) !==
            canonical(captureEmploymentProfile(currentResult.profile)) ||
          result.regularGrossCents !== currentResult.regularGrossCents
        )
          return stop(
            "Bei geänderten Beschäftigungs- oder laufenden Gehaltsgrundlagen ist die verzögerte Netto-Prognose noch nicht verfügbar.",
          );
        if (lines.some((line) => line.group === "MONTHLY_ALLOWANCE" && line.amountCents > 0))
          return stop(
            "Die Sozialversicherung einer verzögerten monatlichen Zulage muss dem Anspruchsmonat zugeordnet werden; diese Netto-Prognose ist noch nicht verfügbar.",
          );
        const delayedGross = lines.reduce((sum, line) => sum + line.amountCents, 0);
        const freeGross = rows.reduce((sum, row) => sum + row.socialInsuranceFreeCents, 0);
        // DRV GRA §23 SGB IV: only an explicitly confirmed employer practice permits
        // regularly delayed variable earnings in the next/over-next SV payroll period.
        if (delayedGross !== freeGross && input.socialInsuranceAttribution !== "CASH_VARIABLE")
          return stop(
            "Für beitragspflichtige verzögerte Bezüge fehlt die bestätigte Zuordnung der Sozialversicherung zum Auszahlungsmonat.",
          );
        if (
          delayedGross !== freeGross &&
          (sourceSettings.automation.pensionScheme !== settings.automation!.pensionScheme ||
            sourceSettings.automation.pensionEmployeeRateBps !==
              settings.automation!.pensionEmployeeRateBps)
        )
          return stop(
            "Bei geänderter Zusatzversorgung ist die verzögerte Netto-Prognose noch nicht verfügbar.",
          );
      }
      if (
        SALARY_PAYMENT_GROUPS.some(
          (group) =>
            selected
              .filter((line) => line.claimMonth === month && line.group === group)
              .reduce((sum, line) => sum + line.amountCents, 0) +
              outgoing
                .filter((line) => line.group === group)
                .reduce((sum, line) => sum + line.amountCents, 0) !==
            groupAmount(current.pay, group),
        )
      )
        return stop("Die Zuordnung der aktuellen und verzögerten Ansprüche ist unvollständig.");
      proofRows.push(...rows);
      yield 0;
    }
    if (new Set(proofRows.map((row) => row.shiftId)).size !== proofRows.length)
      return stop("Die Diensteinträge der Auszahlung sind nicht eindeutig.");
    const taxFreeCents = proofRows.reduce((sum, row) => sum + row.taxFreeCents, 0);
    const socialInsuranceFreeCents = proofRows.reduce(
      (sum, row) => sum + row.socialInsuranceFreeCents,
      0,
    );
    const paidPremiumCents = proofRows.reduce((sum, row) => sum + row.paidPremiumCents, 0);
    const totalGrossCents = grossCents + settings.automation!.additionalRecurringGrossCents;
    if (
      paidPremiumCents > totalGrossCents ||
      socialInsuranceFreeCents > taxFreeCents ||
      taxFreeCents > totalGrossCents
    )
      return stop("Die SFN-Nachweise passen nicht zum Auszahlungsbrutto.");
    return yield* finalizeAutomaticSalaryNetSteps(
      { month, settings },
      {
        ...currentResult,
        classification: Object.freeze({
          ...currentResult.classification,
          calculationBasis: currentBasis!,
          shifts: Object.freeze(proofRows),
          paidPremiumCents,
          taxFreeCents,
          socialInsuranceFreeCents,
          amounts: Object.freeze({
            grossCents: totalGrossCents,
            taxableGrossCents: totalGrossCents - taxFreeCents,
            socialInsuranceGrossCents: totalGrossCents - socialInsuranceFreeCents,
            regularMonthlySocialInsuranceGrossCents: currentResult.regularGrossCents,
          }),
        }),
      },
    );
  } catch {
    return stop(
      "Die Anspruchs- und Auszahlungsgrundlagen konnten nicht vollständig zugeordnet werden.",
    );
  }
}

export function calculateAutomaticPaymentNetPayForecast(
  input: AutomaticPaymentNetPayInput,
  resolver: RuleResolver,
): AutomaticNetPayForecast {
  const steps = calculateAutomaticPaymentNetPayForecastSteps(input, resolver);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
