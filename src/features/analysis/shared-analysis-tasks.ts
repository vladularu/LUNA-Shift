import type { RuleResolver } from "@/rules/rule-resolver";
import type { AnalysisResultKind } from "@/infrastructure/database/analysis-result-repository";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { analysisCacheStage, measureAnalysisCache } from "./analysis-cache-performance";
import { scheduleAnalysisWork } from "./analysis-work-queue";

interface Listener {
  priority: number;
  complete(value: unknown): void;
  fail(error: unknown): void;
  progress?(value: unknown): void;
}
interface Entry {
  active: boolean;
  done: boolean;
  value: unknown;
  partial: unknown;
  hasPartial: boolean;
  listeners: Set<Listener>;
  work: ReturnType<typeof scheduleAnalysisWork> | null;
}
const tasks = new WeakMap<RuleResolver, Map<string, Entry>>();
const scopes = new WeakMap<object, number>();
let nextScope = 0;
function taskKey(
  kind: AnalysisResultKind,
  key: string,
  persistent: PersistentAnalysisCache | null,
) {
  if (persistent !== null && !scopes.has(persistent)) scopes.set(persistent, ++nextScope);
  return `${kind}:${persistent === null ? 0 : scopes.get(persistent)}:${key}`;
}

/** Completed warm snapshots live only while a consumer retains their exact input lease. */
export function readSharedAnalysisResult<T>(
  kind: AnalysisResultKind,
  key: string,
  resolver: RuleResolver,
  persistent: PersistentAnalysisCache | null,
): T | null {
  const entry = tasks.get(resolver)?.get(taskKey(kind, key, persistent));
  return entry?.active && entry.done ? (entry.value as T) : null;
}

/** Share lookup, calculation and partial progress; losing a background lease never cancels a visible one. */
export function requestSharedAnalysis<T, P = never>({
  kind,
  key,
  month,
  resolver,
  persistent,
  priority,
  steps,
  complete,
  fail,
  progress,
  accept,
  retain = accept,
  prepared = null,
  restore,
}: {
  readonly kind: AnalysisResultKind;
  readonly key: string;
  readonly month: string;
  readonly resolver: RuleResolver;
  readonly persistent: PersistentAnalysisCache | null;
  readonly priority: number;
  readonly steps: (progress: (value: P) => void) => Generator<number, T, void>;
  readonly complete: (value: T) => void;
  readonly fail: (error: unknown) => void;
  readonly progress?: (value: P) => void;
  readonly accept: (value: unknown) => value is T;
  readonly retain?: (value: T) => boolean;
  readonly prepared?: T | null;
  readonly restore?: (current: () => boolean) => Promise<void>;
}) {
  const entries = tasks.get(resolver) ?? new Map<string, Entry>();
  tasks.set(resolver, entries);
  const id = taskKey(kind, key, persistent);
  const existing = entries.get(id);
  const currentWrite = existing ? null : persistent?.claim?.(kind, month);
  const entry: Entry = existing ?? {
    active: true,
    done: false,
    value: null,
    partial: null,
    hasPartial: false,
    listeners: new Set(),
    work: null,
  };
  entries.set(id, entry);
  const listener: Listener = {
    priority,
    complete: (value) => complete(value as T),
    fail,
    ...(progress ? { progress: (value: unknown) => progress(value as P) } : {}),
  };
  entry.listeners.add(listener);
  const promote = () =>
    entry.work?.setPriority(Math.min(...[...entry.listeners].map((item) => item.priority)));
  const dispose = () => {
    entry.active = false;
    entry.work?.cancel();
    entry.work = null;
    if (entries.get(id) === entry) entries.delete(id);
  };
  const reportProgress = (value: P) => {
    if (!entry.active) return;
    const phases = measureAnalysisCache(kind, month);
    phases.next(18);
    try {
      entry.partial = value;
      entry.hasPartial = true;
      for (const item of [...entry.listeners])
        if (entry.listeners.has(item)) item.progress?.(value);
    } finally {
      phases.finish();
    }
  };
  const finished = (value: T, fromDisk: boolean) => {
    if (!entry.active) return;
    entry.done = true;
    entry.value = value;
    entry.work = null;
    const phases = measureAnalysisCache(kind, month);
    try {
      phases.next(15);
      for (const item of [...entry.listeners]) if (entry.listeners.has(item)) item.complete(value);
      phases.next(16);
      if (!fromDisk)
        void persistent?.write(
          kind,
          month,
          key,
          resolver,
          value,
          accept,
          currentWrite ?? undefined,
        );
      phases.next(17);
      if (!retain(value) || entry.listeners.size === 0) dispose();
    } finally {
      phases.finish();
    }
  };
  const failed = (error: unknown) => {
    if (!entry.active) return;
    for (const item of [...entry.listeners]) if (entry.listeners.has(item)) item.fail(error);
    dispose();
  };
  const begin = (stored: T | null) => {
    if (!entry.active) return;
    if (stored !== null) {
      finished(stored, true);
      return;
    }
    const calculate = () => {
      if (!entry.active) return;
      entry.work = scheduleAnalysisWork(
        steps(reportProgress),
        (value) => finished(value, false),
        failed,
        Math.min(...[...entry.listeners].map((item) => item.priority)),
        { month, stage: analysisCacheStage(kind) },
      );
    };
    // Intermediate-cache failure is optional. A canceled lookup must never
    // start a generator, install stale parts or notify a later consumer.
    if (restore) void restore(() => entry.active).then(calculate, calculate);
    else calculate();
  };
  if (existing) {
    promote();
    if (entry.hasPartial) listener.progress?.(entry.partial);
    if (entry.done) listener.complete(entry.value);
  } else if (prepared !== null) finished(prepared, false);
  else if (persistent)
    void persistent.read(kind, month, key, resolver, accept).then(begin, () => begin(null));
  else begin(null);
  return {
    setPriority(next: number) {
      listener.priority = next;
      promote();
    },
    cancel() {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) dispose();
      else promote();
    },
  };
}
