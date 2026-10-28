import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { UserProfile } from "@/domain/types";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import {
  annualSalaryForecastSteps,
  type annualSalaryForecast,
} from "@/features/salary/annual-salary-forecast";
import { prepareAutomaticNetPaySteps } from "@/features/salary/automatic-net-pay-preparation";
import {
  salaryEntryDependencies,
  type SalaryMonthContext,
} from "@/features/salary/salary-month-input";
import { createAnalysisResultCache, isCurrentAnalysisMonth } from "./analysis-result-cache";
import { createAnalysisEntryKeys } from "./analysis-entry-keys";

export interface AnalysisSalaryRequest {
  readonly month: string;
  readonly profile: UserProfile;
  readonly settings: MonthlyNetPaySettings | null;
  readonly annualPayments: readonly AnnualSalaryPayment[];
  readonly context: SalaryMonthContext;
}

export interface PreparedAnalysisSalary {
  readonly annual: ReturnType<typeof annualSalaryForecast>;
  readonly forecast: AutomaticNetPayForecast | null;
}

const completed = createAnalysisResultCache<PreparedAnalysisSalary>();

export function analysisSalaryKey(request: AnalysisSalaryRequest) {
  const { month, profile, settings, annualPayments, context } = request;
  const entryKeys = createAnalysisEntryKeys();
  let dependencies;
  try {
    dependencies = salaryEntryDependencies(Number(month.slice(0, 4)), profile, context, month).map(
      ({ shifts, assessment }) => ({
        shifts: entryKeys.entries(shifts),
        assessment: entryKeys.entries(assessment),
      }),
    );
  } catch {
    dependencies = context.entries;
  }
  return entryKeys.stringify([
    month,
    profile,
    settings,
    annualPayments,
    dependencies,
    context.tariffDecisions,
    context.workPatternSettings,
    context.testMonths,
  ]);
}

export function readAnalysisSalary(request: AnalysisSalaryRequest, key: string) {
  return completed.read(
    request.context.resolver,
    key,
    isCurrentAnalysisMonth(request.month, request.profile.timeZone),
  );
}

/** Keep the existing success-cache policy; warm leases may separately retain complete local snapshots. */
export function retainPreparedAnalysisSalary(
  request: AnalysisSalaryRequest,
  key: string,
  value: PreparedAnalysisSalary,
) {
  return value.annual.proposal !== null &&
    (value.forecast === null || value.forecast.result.status === "available")
    ? completed.write(
        request.context.resolver,
        key,
        value,
        isCurrentAnalysisMonth(request.month, request.profile.timeZone),
      )
    : value;
}

/** Preserve the two existing annual-payment inputs: timeline for gross, settings for net. */
export function* prepareAnalysisSalarySteps(
  request: AnalysisSalaryRequest,
  key: string,
  onAnnualReady?: (annual: PreparedAnalysisSalary["annual"]) => void,
): Generator<number, PreparedAnalysisSalary, void> {
  const { month, profile, context, settings, annualPayments } = request;
  const annual = yield* annualSalaryForecastSteps(
    Number(month.slice(0, 4)),
    profile,
    context,
    annualPayments,
  );
  onAnnualReady?.(annual);
  yield 0;
  const forecast =
    settings?.version === 2
      ? yield* prepareAutomaticNetPaySteps(month, settings, profile, context)
      : null;
  const result = { annual, forecast };
  // Unavailable calculations stay retryable when a page is mounted again.
  return annual.proposal !== null &&
    (forecast === null || forecast.result.status === "available") &&
    analysisSalaryKey(request) === key
    ? completed.write(
        context.resolver,
        key,
        result,
        isCurrentAnalysisMonth(month, profile.timeZone),
      )
    : result;
}
