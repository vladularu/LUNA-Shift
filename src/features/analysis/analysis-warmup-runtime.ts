import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { resolveNetPaySettings, type SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { recordDiagnostic } from "@/infrastructure/diagnostics";
import { ANALYSIS_WARMUP_PRIORITY, scheduleAnalysisWork } from "./analysis-work-queue";
import { requestSharedAnalysis } from "./shared-analysis-tasks";
import {
  calculateMonthlyAnalysisSteps,
  inspectMonthlyAnalysis,
  retainPreparedMonthlyAnalysis,
  type MonthlyAnalysisCalculation,
} from "./monthly-analysis";
import {
  analysisSalaryKey,
  prepareAnalysisSalarySteps,
  readAnalysisSalary,
  retainPreparedAnalysisSalary,
  type PreparedAnalysisSalary,
} from "./analysis-salary";
import { completedMonthlyCompliance, monthlyComplianceKey } from "./analysis-compliance-cache";
import { calculateMonthlyComplianceSteps } from "@/engine/compliance";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import {
  persistentCheckValue,
  persistentMonthValue,
  persistentSalaryValue,
} from "./persistent-analysis-values";

export interface AnalysisWarmupInput {
  readonly months: readonly string[];
  readonly profile: UserProfile;
  readonly savedProfile: UserProfile;
  readonly entries: readonly CalendarEntry[];
  readonly tariffDecisions: readonly MonthlyTariffDecision[];
  readonly workPatternSettings: TvoedWorkPatternSettings;
  readonly testMonths: readonly string[];
  readonly resolver: RuleResolver;
  readonly timeline: readonly SavedMonthlyNetPaySettings[] | null;
  readonly annualPayments: readonly AnnualSalaryPayment[] | null;
  readonly referenceDate: string;
  readonly youthProtection: boolean | null;
}
interface Stage {
  readonly key: string;
  readonly resolver: RuleResolver;
  generation: number;
  active: boolean;
  done: boolean;
  failed: boolean;
  value: unknown;
  lease: ReturnType<typeof requestSharedAnalysis> | null;
}

/** Reconcile exact stage keys in idle time; an input reference change alone never discards work. */
export function createAnalysisWarmupRuntime(
  persistent: PersistentAnalysisCache | null,
  editDelayMs = 120,
) {
  let generation = 0,
    started = false,
    latest: AnalysisWarmupInput | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stages = new Map<string, Stage>();
  const setups = new Set<ReturnType<typeof scheduleAnalysisWork>>();
  const discard = (id: string) => {
    const item = stages.get(id);
    if (!item) return;
    item.active = false;
    item.lease?.cancel();
    stages.delete(id);
  };
  const cancelSetup = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const task of setups) task.cancel();
    setups.clear();
  };
  const stop = () => {
    generation++;
    latest = null;
    cancelSetup();
    for (const id of stages.keys()) discard(id);
  };
  const setup = (steps: Generator<number, void, void>, priority: number) => {
    const task = scheduleAnalysisWork(
      steps,
      () => {
        setups.delete(task);
      },
      () => {
        setups.delete(task);
      },
      priority,
    );
    setups.add(task);
  };
  const stage = <T, P = never>(options: Parameters<typeof requestSharedAnalysis<T, P>>[0]) => {
    const id = `${options.kind}:${options.month}`,
      existing = stages.get(id);
    if (
      existing?.key === options.key &&
      existing.resolver === options.resolver &&
      !existing.failed
    ) {
      existing.generation = generation;
      existing.lease?.setPriority(options.priority);
      if (existing.done) options.complete(existing.value as T);
      return;
    }
    const current: Stage = {
      key: options.key,
      resolver: options.resolver,
      generation,
      active: true,
      done: false,
      failed: false,
      value: null,
      lease: null,
    };
    stages.set(id, current);
    current.lease = requestSharedAnalysis({
      ...options,
      complete: (value) => {
        current.done = true;
        current.value = value;
        if (current.active && current.generation === generation) options.complete(value);
      },
      fail: (error) => {
        current.failed = true;
        recordDiagnostic("reporting", "ANALYSIS_PREPARATION_FAILED", error);
      },
    });
    if (existing) {
      existing.active = false;
      existing.lease?.cancel();
    }
  };
  const checks = (month: string, value: MonthlyAnalysisCalculation, priority: number) => {
    const input = latest;
    if (!input || input.youthProtection === null || !value.complianceShifts.ok) return;
    const current = generation;
    setup(
      (function* () {
        const {
          profile,
          resolver: ruleResolver,
          referenceDate,
          youthProtection: youthEnabled,
        } = input;
        if (youthEnabled === null) return;
        const shifts = value.complianceShifts.ok ? value.complianceShifts.value : [];
        const key = monthlyComplianceKey(month, profile, referenceDate, shifts, youthEnabled);
        yield 0;
        if (current !== generation) return;
        stage({
          kind: "checks",
          key,
          month,
          resolver: ruleResolver,
          persistent,
          priority,
          prepared: completedMonthlyCompliance.read(
            ruleResolver,
            key,
            month === referenceDate.slice(0, 7),
          ),
          accept: persistentCheckValue,
          steps: () =>
            calculateMonthlyComplianceSteps(month, shifts, profile.timeZone, {
              employmentProfile: profile,
              federalState: profile.federalState,
              holidayRegion: profile.holidayRegion,
              weeklyMinutes: profile.weeklyMinutes,
              regularRotatingNightWork: profile.regularRotatingNightWork,
              sundayHolidayWorkEligible: profile.sundayHolidayWorkEligible,
              allEmploymentWorkRecorded: profile.allEmploymentWorkRecorded,
              referenceDate,
              ruleResolver,
              youthProtection: youthEnabled,
            }),
          complete: (result) => {
            completedMonthlyCompliance.write(
              ruleResolver,
              key,
              result,
              month === referenceDate.slice(0, 7),
            );
          },
          fail: () => {},
        });
      })(),
      priority,
    );
  };
  return {
    stop,
    prepare(input: AnalysisWarmupInput) {
      generation++;
      cancelSetup();
      latest = input;
      const current = generation,
        delay = started ? editDelayMs : 0;
      started = true;
      const months = [...new Set(input.months)]
        .filter((month) => !input.testMonths.includes(month))
        .slice(0, 3);
      for (const id of stages.keys()) {
        const [kind, month] = id.split(":");
        if (
          !months.includes(month) ||
          (kind === "salary" && (input.timeline === null || input.annualPayments === null)) ||
          (kind === "checks" && input.youthProtection === null)
        )
          discard(id);
      }
      timer = setTimeout(() => {
        timer = null;
        if (current !== generation) return;
        months.forEach((month, index) => {
          const priority = ANALYSIS_WARMUP_PRIORITY + index;
          setup(
            (function* () {
              const request = {
                month,
                profile: input.profile,
                entries: input.entries,
                tariffDecisions: input.tariffDecisions,
                workPatternSettings: input.workPatternSettings,
                ruleResolver: input.resolver,
              };
              const inspection = inspectMonthlyAnalysis(request),
                key = inspection.key;
              yield 0;
              if (current !== generation) return;
              stage({
                kind: "month",
                key,
                month,
                resolver: input.resolver,
                persistent,
                priority,
                prepared: inspection.cached,
                accept: persistentMonthValue,
                steps: () => calculateMonthlyAnalysisSteps(request),
                complete: (result) => {
                  checks(month, retainPreparedMonthlyAnalysis(request, key, result), priority);
                },
                fail: () => {},
              });
              yield 0;
              if (
                current !== generation ||
                input.timeline === null ||
                input.annualPayments === null
              )
                return;
              const salary = {
                month,
                profile: input.savedProfile,
                settings: resolveNetPaySettings(month, input.timeline)?.settings ?? null,
                annualPayments: input.annualPayments,
                context: {
                  entries: input.entries,
                  tariffDecisions: input.tariffDecisions,
                  workPatternSettings: input.workPatternSettings,
                  resolver: input.resolver,
                  testMonths: input.testMonths,
                },
              };
              const salaryKey = analysisSalaryKey(salary);
              yield 0;
              if (current !== generation) return;
              stage<PreparedAnalysisSalary, PreparedAnalysisSalary["annual"]>({
                kind: "salary",
                key: salaryKey,
                month,
                resolver: input.resolver,
                persistent,
                priority,
                prepared: readAnalysisSalary(salary, salaryKey),
                accept: persistentSalaryValue,
                retain: (value) =>
                  value.forecast?.result.status === "available" || persistentSalaryValue(value),
                steps: (progress) => prepareAnalysisSalarySteps(salary, salaryKey, progress),
                complete: (result) => {
                  retainPreparedAnalysisSalary(salary, salaryKey, result);
                },
                fail: () => {},
              });
            })(),
            priority,
          );
        });
      }, delay);
      return () => {
        if (current === generation) stop();
      };
    },
  };
}
