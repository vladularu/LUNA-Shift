import { employmentProfileAt } from "@/domain/employment-history";
import { selectTvhKrAssessmentShifts } from "@/engine/simple-tvh-kr-profile-pay";
import { selectTvUkAssessmentShifts } from "@/engine/simple-tvuk-nursing-profile-pay";
import { selectTvlKrAssessmentShifts } from "@/engine/simple-tvl-kr-profile-pay";
import { selectVkaEAssessmentShifts } from "@/engine/simple-vka-e-pay";
import { selectNursingTrainingAssessmentShifts } from "@/engine/simple-nursing-training-pay";
import type {
  CalendarEntry,
  MonthlyPayEstimate,
  MonthlyTariffDecision,
  ShiftEntry,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import { prepareMonthlyPaySteps } from "@/engine/prepare-monthly-pay";
import {
  calculateMonthlySummarySteps,
  type calculateMonthlySummary,
} from "@/engine/monthly-summary";
import {
  selectAllowanceShifts,
  selectComplianceShifts,
  selectMonthlyAnalysisEntries,
} from "@/features/analysis/analysis-data";
import {
  buildMonthlyShiftTypeAnalysisSteps,
  buildMonthlyTimedShiftTypeAnalysis,
  type MonthlyShiftTypeAnalysis,
} from "@/features/analysis/analysis-metrics";
import {
  captureRuleComputation,
  type RuleComputationResult,
} from "@/features/analysis/rule-computation";
import { requireResolvedPackage, type RuleResolver } from "@/rules/rule-resolver";
import { createAnalysisResultCache, isCurrentAnalysisMonth } from "./analysis-result-cache";
import { createAnalysisEntryKeys } from "./analysis-entry-keys";

export interface MonthlyAnalysisCalculation {
  readonly complianceShifts: RuleComputationResult<readonly ShiftEntry[]>;
  readonly monthShifts: readonly ShiftEntry[];
  readonly pay: RuleComputationResult<MonthlyPayEstimate>;
  readonly shiftTypeAnalysis: MonthlyShiftTypeAnalysis;
  readonly summary: RuleComputationResult<ReturnType<typeof calculateMonthlySummary>>;
}

export interface MonthlyAnalysisRequest {
  readonly month: string;
  readonly entries: readonly CalendarEntry[];
  readonly profile: UserProfile;
  readonly tariffDecisions: readonly MonthlyTariffDecision[];
  readonly workPatternSettings: TvoedWorkPatternSettings | undefined;
  readonly ruleResolver: RuleResolver;
}

const results = createAnalysisResultCache<MonthlyAnalysisCalculation>();
const timeResults = createAnalysisResultCache<{
  readonly summary: Extract<MonthlyAnalysisCalculation["summary"], { ok: true }>;
  readonly shiftTypeAnalysis: MonthlyShiftTypeAnalysis;
}>();

function* captureSteps<T>(
  steps: Generator<number, T, void>,
): Generator<number, RuleComputationResult<T>, void> {
  try {
    return { ok: true, value: yield* steps };
  } catch (error) {
    return captureRuleComputation(() => {
      throw error;
    });
  }
}

function prepare(request: MonthlyAnalysisRequest) {
  const { month, entries, tariffDecisions, workPatternSettings, ruleResolver } = request;
  const profile = employmentProfileAt(request.profile, month + "-01");
  const monthlyEntries = selectMonthlyAnalysisEntries(entries, month);
  const complianceShifts = captureRuleComputation(() => {
    requireResolvedPackage(ruleResolver.resolveHoliday(`${month}-01`));
    return selectComplianceShifts(entries, month, ruleResolver);
  });
  const decision = tariffDecisions.find((item) => item.month === month) ?? null;
  const allowanceShifts = captureRuleComputation(() =>
    profile.tvhKrTariff
      ? selectTvhKrAssessmentShifts(entries, month)
      : profile.tvUkNursingTariff
        ? selectTvUkAssessmentShifts(entries, month)
        : profile.tvlKrTariff || profile.tvalPflegeTariff
          ? selectTvlKrAssessmentShifts(entries, month)
          : profile.vkaETariff
            ? selectVkaEAssessmentShifts(entries, month)
            : profile.nursingTrainingTariff
              ? selectNursingTrainingAssessmentShifts(entries, month)
              : profile.tariff === null
                ? monthlyEntries.monthShifts
                : selectAllowanceShifts(entries, month, ruleResolver),
  );
  // Keep the full legal and tariff assessment windows, including surrounding months.
  // Irrelevant archived entries never become part of the retained cache key.
  const entryKeys = createAnalysisEntryKeys();
  const key =
    complianceShifts.ok && allowanceShifts.ok
      ? entryKeys.stringify([
          month,
          profile,
          {
            monthEntries: entryKeys.entries(monthlyEntries.monthEntries),
            monthShifts: entryKeys.entries(monthlyEntries.monthShifts),
          },
          entryKeys.entries(complianceShifts.value),
          entryKeys.entries(allowanceShifts.value),
          decision,
          workPatternSettings,
        ])
      : null;
  return { profile, monthlyEntries, complianceShifts, allowanceShifts, decision, key };
}

export function getCachedMonthlyAnalysis(request: MonthlyAnalysisRequest) {
  return inspectMonthlyAnalysis(request).cached;
}

/** Publish a verified warm/disk snapshot without changing the calculation path. */
export function retainPreparedMonthlyAnalysis(
  request: MonthlyAnalysisRequest,
  key: string,
  value: MonthlyAnalysisCalculation,
) {
  if (value.summary.ok && value.complianceShifts.ok && value.pay.ok && value.pay.value.available)
    return results.write(
      request.ruleResolver,
      key,
      value,
      isCurrentAnalysisMonth(request.month, request.profile.timeZone),
    );
  return value;
}

export function inspectMonthlyAnalysis(request: MonthlyAnalysisRequest) {
  const input = prepare(request);
  return {
    key:
      input.key ??
      JSON.stringify([
        request.month,
        request.profile,
        request.entries,
        request.tariffDecisions,
        request.workPatternSettings,
      ]),
    cached:
      input.key === null
        ? null
        : results.read(
            request.ruleResolver,
            input.key,
            isCurrentAnalysisMonth(request.month, input.profile.timeZone),
          ),
  };
}

export function calculateMonthlyAnalysis(
  month: string,
  entries: readonly CalendarEntry[],
  profile: UserProfile,
  tariffDecisions: readonly MonthlyTariffDecision[],
  workPatternSettings: TvoedWorkPatternSettings | undefined,
  ruleResolver: RuleResolver,
): MonthlyAnalysisCalculation {
  const steps = calculateMonthlyAnalysisSteps({
    month,
    entries,
    profile,
    tariffDecisions,
    workPatternSettings,
    ruleResolver,
  });
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function* calculateMonthlyAnalysisSteps(
  request: MonthlyAnalysisRequest,
): Generator<number, MonthlyAnalysisCalculation, void> {
  const { month, workPatternSettings, ruleResolver } = request;
  const { profile, monthlyEntries, complianceShifts, allowanceShifts, decision, key } =
    prepare(request);
  const keepCurrent = isCurrentAnalysisMonth(month, profile.timeZone);
  const cached = key === null ? null : results.read(ruleResolver, key, keepCurrent);
  if (cached !== null) return cached;
  const preparedTime = key === null ? null : timeResults.read(ruleResolver, key, keepCurrent);
  yield 0;
  const summary =
    preparedTime?.summary ??
    (yield* captureSteps(
      calculateMonthlySummarySteps(month, monthlyEntries.monthShifts, profile, ruleResolver),
    ));
  yield 0;
  if (allowanceShifts.ok)
    yield* prepareMonthlyPaySteps(
      month,
      monthlyEntries.monthShifts,
      profile,
      decision,
      allowanceShifts.value,
      workPatternSettings,
      ruleResolver,
    );
  const pay = allowanceShifts.ok
    ? captureRuleComputation(() =>
        calculateMonthlyPayEstimate(
          month,
          monthlyEntries.monthShifts,
          profile,
          decision,
          allowanceShifts.value,
          workPatternSettings,
          ruleResolver,
        ),
      )
    : allowanceShifts;
  yield 0;
  const shiftTypeAnalysis =
    preparedTime?.shiftTypeAnalysis ??
    (summary.ok
      ? yield* buildMonthlyShiftTypeAnalysisSteps(
          month,
          monthlyEntries.monthEntries,
          profile,
          ruleResolver,
        )
      : buildMonthlyTimedShiftTypeAnalysis(month, monthlyEntries.monthEntries, profile));
  const result = Object.freeze({
    complianceShifts,
    monthShifts: monthlyEntries.monthShifts,
    pay,
    shiftTypeAnalysis,
    summary,
  });
  if (key !== null && summary.ok && prepare(request).key === key) {
    if (pay.ok && pay.value.available) return results.write(ruleResolver, key, result, keepCurrent);
    // Missing salary data remains retryable, without repeating valid time calculations.
    timeResults.write(ruleResolver, key, { summary, shiftTypeAnalysis }, keepCurrent);
  }
  return result;
}
