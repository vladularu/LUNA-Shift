import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import {
  annualInputKey,
  buildAnnualAvailableReportSteps,
  createAnnualAvailableReportCache,
} from "./annual-core-report";
import type { AnnualReport } from "./annual-report";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { persistentAnnualValue } from "./persistent-analysis-values";
import { readSharedAnalysisResult, requestSharedAnalysis } from "./shared-analysis-tasks";

export interface AnnualAnalysisRequest {
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
): Generator<number, AnnualReport, void> {
  const cached = readAnnualAnalysis(request, key, persistent);
  if (cached) return cached;
  const value = yield* buildAnnualAvailableReportSteps(
    request.year,
    request.entries,
    request.profile,
    request.tariffDecisions,
    request.workPatternSettings,
    request.referenceDate,
    request.ruleResolver,
    { cache: scope(persistent).calculation, youthProtection: request.youthProtection, onCore },
  );
  return retainAnnualAnalysis(request, key, persistent, value);
}
export function requestAnnualAnalysis(
  request: AnnualAnalysisRequest,
  key: string,
  persistent: PersistentAnalysisCache | null,
  priority: number,
  complete: (value: AnnualReport) => void,
  fail: (error: unknown) => void,
  progress?: (value: AnnualReport) => void,
) {
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
    steps: (onCore) => prepareAnnualAnalysisSteps(request, key, persistent, onCore),
    complete: (value) => complete(retainAnnualAnalysis(request, key, persistent, value)),
    fail,
    progress,
  });
}
