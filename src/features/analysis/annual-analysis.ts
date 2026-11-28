import { needsCalendarSalaryInYear } from "./calendar-salary-projection";
import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import {
  annualComplianceInput,
  annualInputKey,
  buildAnnualAvailableReportSteps,
  createAnnualAvailableReportCache,
} from "./annual-core-report";
import type { AnnualReport } from "./annual-report";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { persistentAnnualValue } from "./persistent-analysis-values";
import { readSharedAnalysisResult, requestSharedAnalysis } from "./shared-analysis-tasks";
import { annualMonthPartsSession } from "./annual-month-parts";
import { buildAnnualNativeReportSteps } from "./annual-native-report";
import type { AnalysisWorkYield } from "./analysis-work-queue";
import { restFindingKeys } from "@/engine/workplace-resolution";
import { calculateMonthlyComplianceSteps } from "@/engine/compliance";
import { classifyChecks, countChecks, selectAnnualCheckDisplay } from "./check-visibility";
import { annualRustSteps, type AnnualRustCalculator } from "./annual-rust-bridge";

export interface AnnualAnalysisRequest {
  readonly calculationIdentity?: string;
  readonly year: number;
  readonly entries: readonly CalendarEntry[];
  readonly profile: UserProfile;
  readonly tariffDecisions: readonly MonthlyTariffDecision[];
  readonly workPatternSettings: TvoedWorkPatternSettings;
  readonly referenceDate: string;
  readonly youthProtection: boolean;
  readonly ruleResolver: RuleResolver;
}
interface Scope {
  readonly completed: WeakMap<RuleResolver, Map<string, AnnualReport>>;
  readonly retained: WeakMap<RuleResolver, string>;
  readonly calculation: ReturnType<typeof createAnnualAvailableReportCache>;
}
const fallback = {};
const scopes = new WeakMap<object, Scope>();
function scope(persistent: PersistentAnalysisCache | null): Scope {
  const owner = persistent ?? fallback;
  let value = scopes.get(owner);
  if (!value) {
    value = {
      completed: new WeakMap(),
      retained: new WeakMap(),
      calculation: createAnnualAvailableReportCache(),
    };
    scopes.set(owner, value);
  }
  return value;
}
export function annualAnalysisKey({ ruleResolver: _resolver, ...input }: AnnualAnalysisRequest) {
  return annualInputKey(input);
}
export function readAnnualAnalysis(
  request: AnnualAnalysisRequest,
  key: string,
  persistent: PersistentAnalysisCache | null,
) {
  const state = scope(persistent);
  const entries = state.completed.get(request.ruleResolver);
  const value =
    entries?.get(key) ??
    readSharedAnalysisResult<AnnualReport>("annual", key, request.ruleResolver, persistent);
  if (value && entries?.has(key)) {
    entries.delete(key);
    entries.set(key, value);
    if (String(request.year) === request.referenceDate.slice(0, 4))
      state.retained.set(request.ruleResolver, key);
  }
  return value ?? null;
}
export function retainAnnualAnalysis(
  request: AnnualAnalysisRequest,
  key: string,
  persistent: PersistentAnalysisCache | null,
  value: AnnualReport,
) {
  if (annualAnalysisKey(request) !== key) return value;
  const state = scope(persistent);
  const entries = state.completed.get(request.ruleResolver) ?? new Map<string, AnnualReport>();
  state.completed.set(request.ruleResolver, entries);
  entries.delete(key);
  entries.set(key, value);
  if (String(request.year) === request.referenceDate.slice(0, 4))
    state.retained.set(request.ruleResolver, key);
  // Editing one year must not fill the snapshot budget with its obsolete
  // versions and evict otherwise unchanged neighboring years.
  const versions = [...entries].filter(([, report]) => report.year === request.year);
  for (const [obsolete] of versions.slice(0, -2)) entries.delete(obsolete);
  if (entries.size > 6) {
    const oldest = [...entries.keys()].find(
      (candidate) => candidate !== state.retained.get(request.ruleResolver),
    );
    entries.delete(oldest ?? entries.keys().next().value!);
  }
  return value;
}
export function* prepareAnnualAnalysisSteps(
  request: AnnualAnalysisRequest,
  key: string,
  persistent: PersistentAnalysisCache | null,
  onCore?: (value: AnnualReport) => void,
  onMonth?: (month: string, parts: import("./annual-core-report").AvailableMonthCache) => void,
): Generator<number, AnnualReport, void> {
  return yield* calculateAnnualAnalysis(
    request,
    key,
    persistent,
    onCore,
    onMonth,
    buildAnnualAvailableReportSteps,
  );
}

function* calculateAnnualAnalysis<Step extends AnalysisWorkYield>(
  request: AnnualAnalysisRequest,
  key: string,
  persistent: PersistentAnalysisCache | null,
  onCore: ((value: AnnualReport) => void) | undefined,
  onMonth:
    | ((month: string, parts: import("./annual-core-report").AvailableMonthCache) => void)
    | undefined,
  build: (
    ...args: Parameters<typeof buildAnnualAvailableReportSteps>
  ) => Generator<Step, AnnualReport, void>,
): Generator<Step, AnnualReport, void> {
  const cached = readAnnualAnalysis(request, key, persistent);
  if (cached) return cached;
  const value = yield* build(
    request.year,
    request.entries,
    request.profile,
    request.tariffDecisions,
    request.workPatternSettings,
    request.referenceDate,
    request.ruleResolver,
    {
      cache: scope(persistent).calculation,
      youthProtection: request.youthProtection,
      onCore,
      onMonth,
    },
  );
  return retainAnnualAnalysis(request, key, persistent, value);
}
/** Keep the native time and pay sections while applying the same dated checks as the month view. */
function* annualReportWithWorkplaceChecks(
  request: AnnualAnalysisRequest,
  calculator: AnnualRustCalculator,
) {
  const report = yield* annualRustSteps(() => calculator.report(request));
  if (!request.profile.workplaceHistory?.length) return report;
  const months = [];
  for (const row of report.months) {
    const { profile, shifts } = annualComplianceInput(
      row.month,
      request.entries,
      request.profile,
      request.referenceDate,
      request.ruleResolver,
      request.youthProtection,
    );
    if (!shifts || row.complianceComplete === false) {
      months.push(row);
      continue;
    }
    const result = yield* calculateMonthlyComplianceSteps(row.month, shifts, profile.timeZone, {
      employmentProfile: profile,
      referenceDate: request.referenceDate,
      ruleResolver: request.ruleResolver,
      youthProtection: request.youthProtection,
      federalState: profile.federalState,
      holidayRegion: profile.holidayRegion,
      weeklyMinutes: profile.weeklyMinutes,
      regularRotatingNightWork: profile.regularRotatingNightWork,
      sundayHolidayWorkEligible: profile.sundayHolidayWorkEligible,
      allEmploymentWorkRecorded: profile.allEmploymentWorkRecorded,
    });
    months.push({
      ...row,
      ...countChecks(result.issues),
      checkCounts: classifyChecks(result.issues),
      legalRestKeys: restFindingKeys(result.issues),
    });
  }
  return selectAnnualCheckDisplay({ ...report, months }, true);
}
export function requestAnnualAnalysis(
  request: AnnualAnalysisRequest,
  key: string,
  persistent: PersistentAnalysisCache | null,
  priority: number,
  complete: (value: AnnualReport) => void,
  fail: (error: unknown) => void,
  progress?: (value: AnnualReport) => void,
  calculator: AnnualRustCalculator | null = null,
) {
  if (calculator && needsCalendarSalaryInYear(request.year, request.entries, request.profile))
    calculator = null;
  const parts = annualMonthPartsSession(
    request.year,
    request.ruleResolver,
    scope(persistent).calculation,
    persistent,
  );
  return requestSharedAnalysis<AnnualReport, AnnualReport>({
    kind: "annual",
    month: request.year + "-01",
    key,
    resolver: request.ruleResolver,
    persistent,
    priority,
    prepared: readAnnualAnalysis(request, key, persistent),
    accept: persistentAnnualValue,
    retain: () => true,
    restore: calculator ? undefined : parts.restore,
    steps: (onCore) =>
      calculator
        ? annualReportWithWorkplaceChecks(request, calculator)
        : calculateAnnualAnalysis(
            request,
            key,
            persistent,
            onCore,
            parts.save,
            buildAnnualNativeReportSteps,
          ),
    complete: (value) => complete(retainAnnualAnalysis(request, key, persistent, value)),
    fail,
    progress,
  });
}
