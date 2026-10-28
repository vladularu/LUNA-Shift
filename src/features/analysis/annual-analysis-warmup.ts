import { recordDiagnostic } from "@/infrastructure/diagnostics";
import { selectAnnualReportInputs } from "./annual-report-inputs";
import {
  annualAnalysisKey,
  requestAnnualAnalysis,
  type AnnualAnalysisRequest,
} from "./annual-analysis";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { ANALYSIS_WARMUP_PRIORITY, scheduleAnalysisWork } from "./analysis-work-queue";

export type AnnualPreparationInput = Omit<AnnualAnalysisRequest, "year" | "youthProtection"> & {
  readonly years: readonly number[];
  readonly youthProtection: boolean | null;
  readonly testMonths: readonly string[];
};
export function createAnnualAnalysisWarmupRuntime(
  persistent: PersistentAnalysisCache | null,
  editDelayMs = 120,
) {
  let generation = 0,
    started = false,
    timer: ReturnType<typeof setTimeout> | null = null;
  const setups = new Set<ReturnType<typeof scheduleAnalysisWork>>();
  const stages = new Map<
    number,
    {
      key: string;
      resolver: AnnualAnalysisRequest["ruleResolver"];
      failed: boolean;
      lease: ReturnType<typeof requestAnnualAnalysis>;
    }
  >();
  const cancelSetup = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const task of setups) task.cancel();
    setups.clear();
  };
  const stop = () => {
    generation++;
    cancelSetup();
    for (const stage of stages.values()) stage.lease.cancel();
    stages.clear();
  };
  return {
    stop,
    prepare(input: AnnualPreparationInput) {
      generation++;
      const current = generation;
      cancelSetup();
      const years =
        input.youthProtection === null || input.testMonths.length > 0
          ? []
          : [...new Set(input.years)]
              .filter((year) => Number.isInteger(year) && year >= 1900 && year <= 4099)
              .slice(0, 3);
      for (const [year, stage] of stages)
        if (!years.includes(year)) {
          stage.lease.cancel();
          stages.delete(year);
        }
      timer = setTimeout(
        () => {
          timer = null;
          if (current !== generation) return;
          years.forEach((year, index) => {
            const priority = ANALYSIS_WARMUP_PRIORITY + 10 + index;
            const task = scheduleAnalysisWork(
              (function* () {
                const selected = selectAnnualReportInputs(
                  null,
                  year,
                  input.entries,
                  input.tariffDecisions,
                  input.ruleResolver,
                  input.profile.tariff !== null,
                );
                const request: AnnualAnalysisRequest = {
                  year,
                  entries: selected.entries,
                  tariffDecisions: selected.tariffDecisions,
                  profile: input.profile,
                  referenceDate: input.referenceDate,
                  workPatternSettings: input.workPatternSettings,
                  ruleResolver: input.ruleResolver,
                  youthProtection: input.youthProtection ?? false,
                };
                const key = annualAnalysisKey(request);
                yield 0;
                if (current !== generation) return;
                const previous = stages.get(year);
                if (
                  previous?.key === key &&
                  previous.resolver === input.ruleResolver &&
                  !previous.failed
                )
                  return;
                const stage = {
                  key,
                  resolver: input.ruleResolver,
                  failed: false,
                  lease: requestAnnualAnalysis(
                    request,
                    key,
                    persistent,
                    priority,
                    () => {},
                    (error) => {
                      const active = stages.get(year);
                      if (active?.key === key) active.failed = true;
                      recordDiagnostic("reporting", "ANNUAL_PREPARATION_FAILED", error);
                    },
                  ),
                };
                stages.set(year, stage);
                previous?.lease.cancel();
              })(),
              () => setups.delete(task),
              (error) => {
                setups.delete(task);
                recordDiagnostic("reporting", "ANNUAL_PREPARATION_FAILED", error);
              },
              priority,
            );
            setups.add(task);
          });
        },
        started ? editDelayMs : 0,
      );
      started = true;
    },
  };
}
