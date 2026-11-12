import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { createAnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { BUNDLED_RULE_CATALOG, createRuleResolver } from "@/rules/rule-resolver";
import {
  createPersistentAnalysisCache,
  type PersistentAnalysisCache,
} from "./persistent-analysis-cache";
import {
  annualAnalysisKey,
  requestAnnualAnalysis,
  type AnnualAnalysisRequest,
} from "./annual-analysis";
import { buildAnnualAvailableReportSteps } from "./annual-core-report";
import type { AnnualReport } from "./annual-report";
import { encodeAnalysisCacheValue } from "./analysis-cache-codec";
import { createCalendarPerformanceRecorder } from "@/application/calendar-performance";
import { observeAnnualMonthCache } from "@/composition/analysis-cache-diagnostics";

const databases = new Set<Database.Database>(),
  directories: string[] = [];
const execution = vi.hoisted(() => ({ steps: 0 }));
// Exercise the real engine, cache, hashes, write queue and reopened SQLite file.
// Scheduling is independently covered by queue tests and the real-timer benchmark;
// avoid thousands of wall-clock wakeups under the full suite's parallel CPU load.
vi.mock("./analysis-work-queue", () => ({
  scheduleAnalysisWork<T>(
    steps: Generator<number, T, void>,
    complete: (value: T) => void,
    fail: (error: unknown) => void,
  ) {
    let active = true;
    queueMicrotask(() => {
      try {
        while (active) {
          const step = steps.next();
          execution.steps++;
          if (step.done) {
            active = false;
            complete(step.value);
          }
        }
      } catch (error) {
        active = false;
        fail(error);
      }
    });
    return {
      cancel: () => {
        active = false;
      },
      setPriority: () => {},
    };
  },
}));
afterEach(() => {
  for (const db of databases) db.close();
  databases.clear();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(join(tmpdir(), "luna-persistent-parts-")))
      throw new Error("Unsafe cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});
const input = (): AnnualAnalysisRequest => ({
  year: 2026,
  entries: Array.from({ length: 12 }, (_, i) =>
    forecastShift({ id: String(i), date: `2026-${String(i + 1).padStart(2, "0")}-05` }),
  ),
  profile: forecastProfile,
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  referenceDate: "2026-11-12",
  youthProtection: false,
  ruleResolver: createRuleResolver(),
});
const digest = (value: unknown) =>
  createHash("sha256").update(encodeAnalysisCacheValue(value)).digest("hex");
function storage(filename: string, bundleId = "parts-test", observe = false) {
  const raw = new Database(filename),
    pending = new Set<Promise<void>>();
  databases.add(raw);
  const adapter = {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...args: unknown[]) => raw.prepare(sql).run(...args),
    getFirstAsync: async <T>(sql: string, ...args: unknown[]) =>
      (raw.prepare(sql).get(...args) as T) ?? null,
  };
  const baseCache = createPersistentAnalysisCache({
    repository: createAnalysisResultRepository(
      adapter as unknown as SQLiteDatabase,
      () => "2026-11",
    ),
    bundleId,
    sha256: async (text) => createHash("sha256").update(text).digest("hex"),
    lookupTimeoutMs: 1000,
  });
  const recorder = createCalendarPerformanceRecorder();
  if (observe) recorder.start(true);
  const cache = observe ? observeAnnualMonthCache(baseCache, recorder) : baseCache;
  const persistent: PersistentAnalysisCache = {
    ...cache,
    write(...args) {
      const promise = cache.write(...args);
      pending.add(promise);
      void promise.finally(() => pending.delete(promise));
      return promise;
    },
  };
  return {
    raw,
    persistent,
    recorder,
    async flush() {
      while (pending.size) await Promise.all([...pending]);
    },
    close() {
      raw.close();
      databases.delete(raw);
    },
  };
}
async function run(owner: ReturnType<typeof storage>, request: AnnualAnalysisRequest) {
  const start = execution.steps;
  let lease: ReturnType<typeof requestAnnualAnalysis> | undefined;
  const result = new Promise<AnnualReport>((done, fail) => {
    lease = requestAnnualAnalysis(
      request,
      annualAnalysisKey(request),
      owner.persistent,
      -1,
      done,
      fail,
    );
  });
  const value = await result;
  await owner.flush();
  const steps = execution.steps - start;
  lease!.cancel();
  return { value, steps };
}
function fresh(request: AnnualAnalysisRequest) {
  const steps = buildAnnualAvailableReportSteps(
    request.year,
    request.entries,
    request.profile,
    request.tariffDecisions,
    request.workPatternSettings,
    request.referenceDate,
    request.ruleResolver,
    { youthProtection: request.youthProtection },
  );
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
function file() {
  const directory = mkdtempSync(join(tmpdir(), "luna-persistent-parts-"));
  directories.push(directory);
  return join(directory, "analysis.sqlite");
}

describe("monthly annual parts across real SQLite restarts", () => {
  it("opens a finished year without work, then reuses unchanged parts after a same-revision edit", async () => {
    const filename = file(),
      request = input(),
      first = storage(filename);
    const cold = await run(first, request);
    expect(
      first.raw.prepare("SELECT count(*) AS n FROM analysis_month_parts_cache_v1").get(),
    ).toEqual({ n: 12 });
    first.close();
    const reopened = storage(filename, "parts-test", true),
      restored = { ...request, ruleResolver: createRuleResolver() };
    const known = await run(reopened, restored);
    expect(known.steps).toBe(0);
    expect(digest(known.value)).toBe(digest(cold.value));
    const edited = {
      ...restored,
      entries: restored.entries.map((entry) =>
        entry.id === "5" ? { ...entry, endTime: "18:00" } : entry,
      ),
    };
    const changed = await run(reopened, edited);
    expect(changed.steps).toBeLessThan(cold.steps);
    expect(digest(changed.value)).toBe(digest(fresh(edited)));
    const comparisons = reopened.recorder
      .report()
      .events.filter((event) => event.kind === "analysis-parts");
    expect(comparisons).toHaveLength(12);
    // The observer must consume real persisted { month, parts } values, not a
    // test-only direct parts object. All restored candidates contain four parts.
    expect(
      comparisons.every((event) => event.values.input === 15 && event.values.valid === 15),
    ).toBe(true);
    expect(comparisons.find((event) => event.values.month === 202606)?.values.state! & 3).toBe(3);
    expect(
      comparisons
        .filter((event) => event.values.month !== 202606)
        .every((event) => (event.values.cache! & 3) === 3),
    ).toBe(true);
    expect(comparisons.every((event) => (event.values.reason! & 2) === 0)).toBe(true);
  });
  it.each(["date", "profile", "youth", "catalog", "bundle", "corrupt"])(
    "revalidates %s changes against a fresh calculation",
    async (scenario) => {
      const filename = file(),
        request = input(),
        first = storage(filename);
      await run(first, request);
      first.close();
      const owner = storage(filename, scenario === "bundle" ? "different-version" : "parts-test");
      if (scenario === "corrupt")
        owner.raw.prepare("UPDATE analysis_month_parts_cache_v1 SET value_hash='broken'").run();
      const edited = {
        ...request,
        entries: [
          forecastShift({
            date: "2026-12-31",
            type: "NIGHT",
            startTime: "21:00",
            endTime: "07:00",
          }),
          ...request.entries.slice(1),
        ],
        ruleResolver: createRuleResolver(),
        ...(scenario === "date" ? { referenceDate: "2026-11-13" } : {}),
        ...(scenario === "profile" ? { profile: { ...request.profile, weeklyMinutes: 1800 } } : {}),
        ...(scenario === "youth" ? { youthProtection: true } : {}),
        ...(scenario === "catalog"
          ? { ruleResolver: createRuleResolver({ ...BUNDLED_RULE_CATALOG, legal: [] }) }
          : {}),
      };
      expect(digest((await run(owner, edited)).value)).toBe(digest(fresh(edited)));
    },
  );
});
