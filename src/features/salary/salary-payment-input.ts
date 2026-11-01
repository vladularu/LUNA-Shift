import { employmentMonthPeriods, employmentProfileAt } from "@/domain/employment-history";
import { resolveRemunerationProfile } from "@/domain/remuneration-profile";
import {
  SALARY_PAYMENT_GROUPS,
  addSalaryPaymentMonths,
  resolveSalaryPaymentPeriod,
  validateSalaryPaymentPreferences,
  type SalaryPaymentDelays,
  type SalaryPaymentPreferences,
  type SalaryPaymentProjection,
  type SalaryPaymentSource,
  type SalaryPerspective,
} from "@/domain/salary-payment";
import type { UserProfile } from "@/domain/types";
import { createManualMonthlyPayEstimate } from "@/engine/pay-fallback";
import { projectSalaryPayment, salaryPaymentRequiredMonths } from "@/engine/salary-payment";
import { selectMonthlyAnalysisEntries } from "@/features/analysis/analysis-data";
import { RuleResolutionError } from "@/rules/rule-resolver";
import { salaryMonthInputSteps, type SalaryMonthContext } from "./salary-month-input";

function actualContext(context: SalaryMonthContext): SalaryMonthContext {
  if (!context.testMonths?.length) return context;
  const testMonths = new Set(context.testMonths);
  return {
    ...context,
    entries: context.entries.filter((entry) => !testMonths.has(entry.date.slice(0, 7))),
    tariffDecisions: context.tariffDecisions.filter((decision) => !testMonths.has(decision.month)),
  };
}

function failedSource(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
): SalaryPaymentSource {
  return {
    month,
    profile: employmentProfileAt(profile, `${month}-01`),
    shifts: selectMonthlyAnalysisEntries(context.entries, month).monthShifts,
    pay: {
      ...createManualMonthlyPayEstimate(month, 0),
      available: false,
      personalBaseAmount: null,
      estimatedGrossAmount: null,
      tariffLabel: null,
    },
  };
}

function manualFixedMonth(profile: UserProfile, month: string): boolean {
  if (profile.salaryBasisConflict) return false;
  const history = profile.employmentTimeline;
  // A missing dated history entry must never inherit today's manual profile backwards.
  if (history?.length && !resolveRemunerationProfile(history, `${month}-01`).profile?.employment)
    return false;
  return employmentMonthPeriods(profile, month, `${month}-31`).every(
    ({ profile: period }) =>
      period.manualMonthlyGrossCents != null &&
      !period.tariff &&
      !period.nursingTrainingTariff &&
      !period.vkaETariff &&
      !period.tvlKrTariff &&
      !period.tvhKrTariff &&
      !period.tvUkNursingTariff &&
      !period.tvalPflegeTariff,
  );
}

function* sourceSteps(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
  cache: Map<string, SalaryPaymentSource>,
  requestedMonth: string,
): Generator<number, SalaryPaymentSource, void> {
  const saved = cache.get(month);
  if (saved) return saved;
  let source: SalaryPaymentSource;
  try {
    const calculated = yield* salaryMonthInputSteps(month, profile, context);
    source = { month, profile: employmentProfileAt(profile, `${month}-01`), ...calculated };
  } catch (cause) {
    if (month === requestedMonth || !(cause instanceof RuleResolutionError)) throw cause;
    source = failedSource(month, profile, context);
  }
  cache.set(month, source);
  return source;
}

/** Local zero timing describes proved fixed pay; it never changes the saved rhythm. */
function* fixedPaymentPreferencesSteps(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
  preferences: SalaryPaymentPreferences,
  perspective: SalaryPerspective,
  cache: Map<string, SalaryPaymentSource>,
): Generator<number, SalaryPaymentPreferences, void> {
  const candidates = (perspective === "PAYOUT" ? [-2, -1, 0] : [0]).map((delta) =>
    addSalaryPaymentMonths(month, delta),
  );
  const fixed = new Set<string>();
  for (const claimMonth of candidates) {
    if (!manualFixedMonth(profile, claimMonth) || context.testMonths?.includes(claimMonth))
      continue;
    const { pay } = yield* sourceSteps(claimMonth, profile, context, cache, month);
    if (
      pay.available &&
      [
        pay.timePremiumAmount,
        pay.allowanceAmount,
        pay.overtimeAmount,
        pay.specialDutyAmount ?? 0,
      ].every((amount) => amount === 0)
    )
      fixed.add(claimMonth);
  }
  if (!fixed.size) return preferences;
  return validateSalaryPaymentPreferences({
    ...preferences,
    periods: [
      ...preferences.periods.filter((period) => !candidates.includes(period.effectiveMonth)),
      ...candidates.map((claimMonth) => ({
        effectiveMonth: claimMonth,
        // Restore each non-manual month's original policy so an override cannot leak.
        delays: fixed.has(claimMonth)
          ? (Object.fromEntries(
              SALARY_PAYMENT_GROUPS.map((group) => [group, 0]),
            ) as SalaryPaymentDelays)
          : (resolveSalaryPaymentPeriod(preferences, claimMonth)?.delays ??
            (Object.fromEntries(
              SALARY_PAYMENT_GROUPS.map((group) => [group, 0]),
            ) as SalaryPaymentDelays)),
      })),
    ],
  });
}

function project(
  month: string,
  context: SalaryMonthContext,
  preferences: SalaryPaymentPreferences,
  perspective: SalaryPerspective,
  sources: readonly SalaryPaymentSource[],
): SalaryPaymentProjection {
  const projection = projectSalaryPayment({
    month,
    preferences,
    perspective,
    source: (claimMonth) => sources.find((source) => source.month === claimMonth)!,
  });
  const blocked = sources.filter((source) => context.testMonths?.includes(source.month));
  if (!blocked.length) return projection;
  return {
    ...projection,
    available: false,
    pay: { ...projection.pay, available: false, estimatedGrossAmount: null },
    issues: [
      ...projection.issues,
      ...blocked.map((source) => ({
        kind: "UNAVAILABLE" as const,
        month: source.month,
        message: `Für ${source.month} ist ein Testmonat aktiv. Beende den Testlauf, um tatsächliche Gehaltsansprüche zu berechnen.`,
      })),
    ],
  };
}

/** Uses the existing claim-month calculation and its full tariff assessment window. */
export function salaryPaymentInput(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
  preferences: SalaryPaymentPreferences,
  perspective: SalaryPerspective,
): SalaryPaymentProjection {
  const steps = salaryPaymentInputSteps(month, profile, context, preferences, perspective);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function* salaryPaymentInputSteps(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
  preferences: SalaryPaymentPreferences,
  perspective: SalaryPerspective,
): Generator<number, SalaryPaymentProjection, void> {
  const actual = actualContext(context);
  const cache = new Map<string, SalaryPaymentSource>();
  const effectivePreferences = yield* fixedPaymentPreferencesSteps(
    month,
    profile,
    actual,
    preferences,
    perspective,
    cache,
  );
  const sources: SalaryPaymentSource[] = [];
  for (const claimMonth of salaryPaymentRequiredMonths(month, effectivePreferences, perspective)) {
    sources.push(yield* sourceSteps(claimMonth, profile, actual, cache, month));
    yield 0;
  }
  return project(month, context, effectivePreferences, perspective, sources);
}
