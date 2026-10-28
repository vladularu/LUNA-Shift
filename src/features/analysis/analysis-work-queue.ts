import { scheduleIdleWork, type IdleWorkBudget } from "@/ui/schedule-idle-work";
import { calendarPerformance } from "@/application/calendar-performance";

interface Job {
  priority: number;
  advance: () => "more" | "yield" | "done";
}
export const ANALYSIS_WARMUP_PRIORITY = 10;

/** One cooperative queue for visible work and speculative neighbouring months. */
export function createAnalysisWorkQueue() {
  const jobs: Job[] = [];
  let cancelScheduled: (() => void) | null = null;
  let idleOnlyScheduled = false;
  const schedule = () => {
    if (cancelScheduled !== null || jobs.length === 0) return;
    const advance = (budget?: IdleWorkBudget) => {
      cancelScheduled = null;
      idleOnlyScheduled = false;
      const deadline = performance.now() + 4;
      let count = 0;
      while (jobs.length && count < 32) {
        const priority = Math.min(...jobs.map((job) => job.priority));
        if (
          priority >= ANALYSIS_WARMUP_PRIORITY &&
          budget &&
          (budget.didTimeout || budget.timeRemaining() <= 0)
        )
          break;
        const index = jobs.findIndex((job) => job.priority === priority);
        const [job] = jobs.splice(index, 1);
        const state = job.advance();
        if (state !== "done") jobs.push(job);
        count += 1;
        if (state !== "more" || performance.now() >= deadline) break;
      }
      schedule();
    };
    if (jobs.some((job) => job.priority <= 0)) {
      const handle = setTimeout(advance, 0);
      cancelScheduled = () => clearTimeout(handle);
    } else {
      // Keep speculative details progressing even while native scrolling delays idle callbacks.
      // Each callback still obeys the same four-millisecond/32-step cooperative budget.
      let pending = true;
      let cancelIdle = () => {};
      let continuation: ReturnType<typeof setTimeout> | null = null;
      const resume = (budget?: IdleWorkBudget) => {
        if (!pending) return;
        pending = false;
        cancelIdle();
        if (continuation !== null) clearTimeout(continuation);
        advance(budget);
      };
      idleOnlyScheduled = jobs.every((job) => job.priority >= ANALYSIS_WARMUP_PRIORITY);
      cancelIdle = scheduleIdleWork(
        resume,
        idleOnlyScheduled ? { fallbackDelayMs: 16 } : undefined,
      );
      if (!idleOnlyScheduled) continuation = setTimeout(resume, 8);
      cancelScheduled = () => {
        pending = false;
        cancelIdle();
        if (continuation !== null) clearTimeout(continuation);
      };
    }
  };
  return function enqueue<T>(
    steps: Generator<number, T, void>,
    complete: (result: T) => void,
    fail: (error: unknown) => void,
    priority = 0,
    measurement?: { readonly month: string; readonly stage: number },
  ) {
    let active = true;
    const measured = measurement !== undefined && calendarPerformance.getSnapshot() !== 0;
    const queuedAt = measured ? performance.now() : 0;
    const finish = calendarPerformance.span(
      "analysis-work",
      measurement
        ? {
            month: Number(measurement.month.replace("-", "")),
            stage: measurement.stage,
          }
        : {},
    );
    let count = 0,
      cpu = 0,
      maximum = 0,
      wait = 0;
    const end = (state: number) => {
      if (measured) finish({ state, count, cpu, maximum, wait, priority: job.priority });
    };
    const job: Job = {
      priority,
      advance: () => {
        if (!active) return "done";
        const start = measured ? performance.now() : 0;
        if (measured && count === 0) wait = start - queuedAt;
        let stepMeasured = false;
        const measuredStep = () => {
          if (!measured || stepMeasured) return;
          stepMeasured = true;
          const elapsed = performance.now() - start;
          count++;
          cpu += elapsed;
          maximum = Math.max(maximum, elapsed);
        };
        try {
          const step = steps.next();
          if (!active) return "done";
          if (step.done) {
            active = false;
            complete(step.value);
            measuredStep();
            end(1);
            return "done";
          }
          measuredStep();
          // Warm-only jobs may use the remainder of an idle slice across cheap stage boundaries.
          // Visible work keeps its existing yields; both paths retain the 4ms/32-step outer limit.
          return step.value === 0 && job.priority < ANALYSIS_WARMUP_PRIORITY ? "yield" : "more";
        } catch (error) {
          measuredStep();
          active = false;
          end(3);
          fail(error);
          return "done";
        }
      },
    };
    jobs.push(job);
    if (
      (priority <= 0 || (idleOnlyScheduled && priority < ANALYSIS_WARMUP_PRIORITY)) &&
      cancelScheduled !== null
    ) {
      cancelScheduled();
      cancelScheduled = null;
    }
    schedule();
    return {
      setPriority: (next: number) => {
        if (job.priority === next) return;
        job.priority = next;
        if (active && cancelScheduled !== null) {
          cancelScheduled();
          cancelScheduled = null;
          schedule();
        }
      },
      cancel: () => {
        if (active) end(2);
        active = false;
        const index = jobs.indexOf(job);
        if (index >= 0) jobs.splice(index, 1);
        if (cancelScheduled !== null) {
          cancelScheduled();
          cancelScheduled = null;
        }
        schedule();
      },
    };
  };
}

export const scheduleAnalysisWork = createAnalysisWorkQueue();

/** Prepare neighbouring month cards before optional detail work blocks their first swipe. */
export function analysisWorkPriority(stage: 1 | 2 | 3, active: boolean, distance = 1): number {
  if (!active && Math.abs(distance) > 1) return 2 + Math.abs(distance);
  if (stage === 1) return active ? -3 : -2;
  return active ? -1 : 0;
}
