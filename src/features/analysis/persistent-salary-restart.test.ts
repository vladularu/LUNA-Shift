import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SQLiteDatabase } from "expo-sqlite";
import { createAnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import {
  analysisSalaryKey,
  prepareAnalysisSalarySteps,
  readAnalysisSalary,
  type PreparedAnalysisSalary,
} from "./analysis-salary";
import { createPersistentAnalysisCache } from "./persistent-analysis-cache";
import { persistentSalaryValue } from "./persistent-salary-value";
import { readSharedAnalysisResult, requestSharedAnalysis } from "./shared-analysis-tasks";
import { encodeAnalysisCacheValue } from "./analysis-cache-codec";
import { salaryPersistenceRequest } from "./salary-persistence-test-fixtures";

class Adapter {
  readonly raw: Database.Database;
  constructor(file: string) {
    this.raw = new Database(file);
    this.raw.pragma("journal_mode = WAL");
  }
  async execAsync(sql: string) {
    this.raw.exec(sql);
  }
  async runAsync(sql: string, ...values: unknown[]) {
    return this.raw.prepare(sql).run(...values);
  }
  async getFirstAsync<T>(sql: string, ...values: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...values) as T | undefined) ?? null;
  }
}
let directory: string, db: Adapter;
const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");
const store = () =>
  createPersistentAnalysisCache({
    repository: createAnalysisResultRepository(db as unknown as SQLiteDatabase, () => "2026-10"),
    sha256,
    bundleId: "same-calculation",
    lookupTimeoutMs: 2000,
  });
function calculate(request: ReturnType<typeof salaryPersistenceRequest>) {
  const steps = prepareAnalysisSalarySteps(request, analysisSalaryKey(request));
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "luna-salary-restart-"));
  db = new Adapter(path.join(directory, "app.sqlite"));
});
afterEach(() => {
  db.raw.close();
  if (
    !path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()), "luna-salary-restart-"))
  )
    throw new Error("Unsafe test cleanup target");
  rmSync(directory, { recursive: true, force: true });
});

describe("salary payout persistence across a closed database and empty memory scope", () => {
  it.each(["2026-10", "2027-10"])(
    "restores %s without starting a salary generator",
    async (month) => {
      const input = salaryPersistenceRequest(month),
        value = calculate(input),
        first = store();
      const accept = (item: unknown): item is PreparedAnalysisSalary =>
        persistentSalaryValue(item, input);
      expect(accept(value)).toBe(true);
      await first.write(
        "salary",
        month,
        analysisSalaryKey(input),
        input.context.resolver,
        value,
        accept,
      );
      db.raw.close();
      db = new Adapter(path.join(directory, "app.sqlite"));
      const restarted = salaryPersistenceRequest(month),
        next = store(),
        key = analysisSalaryKey(restarted);
      expect(readAnalysisSalary(restarted, key)).toBeNull();
      expect(readSharedAnalysisResult("salary", key, restarted.context.resolver, next)).toBeNull();
      const steps = vi.fn(function* (): Generator<number, PreparedAnalysisSalary, void> {
        throw new Error("Unexpected recalculation");
      });
      let lease: ReturnType<typeof requestSharedAnalysis> | undefined;
      const restored = await new Promise<PreparedAnalysisSalary>((resolve, reject) => {
        lease = requestSharedAnalysis({
          kind: "salary",
          month,
          key,
          resolver: restarted.context.resolver,
          persistent: next,
          priority: -1,
          accept: (item): item is PreparedAnalysisSalary => persistentSalaryValue(item, restarted),
          steps,
          complete: resolve,
          fail: reject,
        });
      });
      lease!.cancel();
      expect(steps).not.toHaveBeenCalled();
      expect(encodeAnalysisCacheValue(restored)).toBe(encodeAnalysisCacheValue(value));
      expect(restored.projection?.sources).toEqual(value.projection?.sources);
    },
  );
  it("invalidates contributing duty/settings/timing changes but reuses an unrelated-month edit", async () => {
    const input = salaryPersistenceRequest(),
      value = calculate(input),
      first = store(),
      key = analysisSalaryKey(input);
    await first.write(
      "salary",
      input.month,
      key,
      input.context.resolver,
      value,
      (item): item is PreparedAnalysisSalary => persistentSalaryValue(item, input),
    );
    const unrelated = {
      ...input,
      context: {
        ...input.context,
        entries: [...input.context.entries, forecastShift({ id: "unrelated", date: "2010-01-01" })],
      },
    };
    expect(analysisSalaryKey(unrelated)).toBe(key);
    expect(
      await store().read(
        "salary",
        input.month,
        analysisSalaryKey(unrelated),
        input.context.resolver,
        persistentSalaryValue,
      ),
    ).not.toBeNull();
    const changed = [
      {
        ...input,
        context: {
          ...input.context,
          entries: input.context.entries.map((entry) => ({ ...entry, endTime: "23:00" })),
        },
      },
      { ...input, payment: { ...input.payment!, sourceSettings: [] } },
      {
        ...input,
        payment: { ...input.payment!, preferences: { ...input.payment!.preferences, periods: [] } },
      },
      { ...input, profile: { ...input.profile, weeklyMinutes: 1200 } },
    ];
    for (const request of changed) {
      expect(analysisSalaryKey(request)).not.toBe(key);
      expect(
        await store().read(
          "salary",
          request.month,
          analysisSalaryKey(request),
          request.context.resolver,
          persistentSalaryValue,
        ),
      ).toBeNull();
    }
  });
  it("rejects structurally corrupt projections even with a matching payload checksum", async () => {
    const input = salaryPersistenceRequest(),
      value = calculate(input),
      first = store(),
      key = analysisSalaryKey(input);
    await first.write(
      "salary",
      input.month,
      key,
      input.context.resolver,
      value,
      persistentSalaryValue,
    );
    const payload = encodeAnalysisCacheValue({
      ...value,
      projection: { ...value.projection, sources: [{}] },
    });
    db.raw
      .prepare("UPDATE analysis_result_cache_v2 SET value_json=?,value_hash=? WHERE kind='salary'")
      .run(payload, await sha256(payload));
    expect(
      await store().read(
        "salary",
        input.month,
        key,
        input.context.resolver,
        (item): item is PreparedAnalysisSalary => persistentSalaryValue(item, input),
      ),
    ).toBeNull();
  });
});
