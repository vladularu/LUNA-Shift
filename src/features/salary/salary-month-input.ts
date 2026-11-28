import { tvUkAbsenceResolver } from "@/engine/simple-tvuk-nursing-pay";
import { isTariffAbsence } from "@/domain/absence-pay";
import { withTariffAbsencePay } from "@/engine/vka-absence-pay";
import {
  DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  calculateMonthlyPayEstimate,
} from "@/engine/simple-pay";
import type {
  MonthlyPayEstimate,
  ShiftType,
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import { createAnalysisResultCache } from "@/features/analysis/analysis-result-cache";
import { employmentProfileAt } from "@/domain/employment-history";
import type { RuleResolver } from "@/rules/rule-resolver";
import { prepareMonthlyPaySteps } from "@/engine/prepare-monthly-pay";
import { selectTvhKrAssessmentShifts } from "@/engine/simple-tvh-kr-profile-pay";
import { selectTvUkAssessmentShifts } from "@/engine/simple-tvuk-nursing-profile-pay";
import { selectTvlKrAssessmentShifts } from "@/engine/simple-tvl-kr-profile-pay";
import { selectVkaEAssessmentShifts } from "@/engine/simple-vka-e-pay";
import { selectNursingTrainingAssessmentShifts } from "@/engine/simple-nursing-training-pay";
import {
  selectAllowanceShifts,
  selectMonthlyAnalysisEntries,
} from "@/features/analysis/analysis-data";

export interface SalaryMonthContext {
  readonly entries: readonly CalendarEntry[];
  readonly testMonths?: readonly string[];
  readonly tariffDecisions: readonly MonthlyTariffDecision[];
  readonly workPatternSettings: TvoedWorkPatternSettings;
  readonly resolver: RuleResolver;
}

/** Both ordinary net and annual-payment proposals use the same dated gross calculation. */
export function tariffAbsenceMonthPay(
  month: string,
  profile: UserProfile,
  entries: readonly CalendarEntry[],
  tariffDecisions: readonly MonthlyTariffDecision[],
  workPatternSettings: TvoedWorkPatternSettings | undefined,
  resolver: RuleResolver,
) {
  return salaryMonthInput(month, profile, {
    entries,
    tariffDecisions,
    workPatternSettings: workPatternSettings ?? DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    resolver,
  }).pay;
}
export function salaryMonthInput(month: string, profile: UserProfile, context: SalaryMonthContext) {
  const { resolver, entries, tariffDecisions, workPatternSettings } = context;
  const memo = new Map<string, MonthlyPayEstimate>();
  function basePay(claim: string, range?: { from: string; before: string }, pricing = resolver) {
    const dated = employmentProfileAt(profile, claim + "-01");
    const { shifts, assessment } = selectSalaryMonthEntries(claim, dated, context);
    const planned = assessment.flatMap((s) => {
      const original = s.absencePay?.plannedShift;
      return original && s.absencePay?.day === "PAID" && isTariffAbsence(s, profile)
        ? [{ ...s, ...original, type: original.type as ShiftType, allDay: false }]
        : [];
    });
    return calculateMonthlyPayEstimate(
      claim,
      range ? shifts.filter((s) => range.from <= s.date && s.date < range.before) : shifts,
      dated,
      tariffDecisions.find((d) => d.month === claim) ?? null,
      planned.length ? [...assessment, ...planned] : assessment,
      workPatternSettings,
      pricing,
    );
  }
  function price(claim: string, depth: number): MonthlyPayEstimate {
    const cached = memo.get(claim);
    if (cached) return cached;
    const pay = basePay(claim);
    const result = withTariffAbsencePay(claim, pay, profile, entries, resolver, (prior, slice) => {
      if (depth >= 36 || context.testMonths?.includes(prior)) return null;
      try {
        if (slice) {
          const pricing = slice.tvUkRateDate
            ? tvUkAbsenceResolver(slice.tvUkRateDate, resolver)
            : resolver;
          if (!pricing) return null;
          const raw = basePay(prior, slice, pricing);
          if (!slice.includeEarlierAbsences) return raw;
          // With no full month, an earlier TV-H absence can fall in this very month.
          // Restrict the recursive claim to earlier events while keeping its reference history.
          const earlier = salaryMonthInput(prior, profile, {
            ...context,
            entries: entries.filter((entry) => entry.date < slice.before),
          }).pay;
          if (earlier.absencePayNotes?.some((note) => note.slice(0, 10) >= slice.from)) return null;
          const cents = (earlier.absencePayDays ?? [])
            .filter((d) => d.date >= slice.from)
            .reduce((total, d) => total + d.dailyRateCents, 0);
          return { ...raw, absencePayAmount: cents / 100 };
        }
        return price(prior, depth + 1);
      } catch {
        return null;
      }
    });
    memo.set(claim, result);
    return result;
  }
  return { shifts: selectMonthlyAnalysisEntries(entries, month).monthShifts, pay: price(month, 0) };
}

/** The exact existing selectors, shared by the input and its content key. Profile is dated. */
export function selectSalaryMonthEntries(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
) {
  const { entries, resolver } = context;
  const shifts = selectMonthlyAnalysisEntries(entries, month).monthShifts;
  const assessment = profile.tvhKrTariff
    ? selectTvhKrAssessmentShifts(entries, month)
    : profile.tvUkNursingTariff
      ? selectTvUkAssessmentShifts(entries, month)
      : profile.tvlKrTariff || profile.tvalPflegeTariff
        ? selectTvlKrAssessmentShifts(entries, month)
        : profile.vkaETariff
          ? selectVkaEAssessmentShifts(entries, month)
          : profile.nursingTrainingTariff
            ? selectNursingTrainingAssessmentShifts(entries, month)
            : !profile.tariff
              ? shifts
              : selectAllowanceShifts(entries, month, resolver);
  return { shifts, assessment };
}

/** Covers every possible existing annual reference month, plus the requested net month. */
export function salaryEntryDependencies(
  year: number,
  profile: UserProfile,
  context: SalaryMonthContext,
  month?: string,
) {
  const months = new Set([7, 8, 9, 10, 11].map((m) => `${year}-${String(m).padStart(2, "0")}`));
  if (month) months.add(month);
  return [...months].map((value) =>
    selectSalaryMonthEntries(value, employmentProfileAt(profile, value + "-01"), context),
  );
}

// Share exact monthly inputs across payout months and annual reference calculations.
// Bound retained snapshots; never freeze or mutate caller-owned entries/profiles.
const preparedMonths = createAnalysisResultCache<ReturnType<typeof salaryMonthInput>>(36);

export function* salaryMonthInputSteps(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
): Generator<number, ReturnType<typeof salaryMonthInput>, void> {
  const dated = employmentProfileAt(profile, month + "-01");
  const { shifts, assessment } = selectSalaryMonthEntries(month, dated, context);
  const decision = context.tariffDecisions.find((d) => d.month === month) ?? null;
  const key = JSON.stringify([
    month,
    dated,
    shifts,
    assessment,
    decision,
    context.workPatternSettings,
    ...(shifts.some((e) => isTariffAbsence(e, profile))
      ? [context.entries, context.tariffDecisions, context.testMonths]
      : []),
  ]);
  const cached = preparedMonths.read(context.resolver, key);
  if (cached !== null) return cached;
  yield* prepareMonthlyPaySteps(
    month,
    shifts,
    dated,
    decision,
    assessment,
    context.workPatternSettings,
    context.resolver,
  );
  const result = salaryMonthInput(month, profile, context);
  return result.pay.available ? preparedMonths.write(context.resolver, key, result) : result;
}
