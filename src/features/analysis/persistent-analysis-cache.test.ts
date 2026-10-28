import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRuleResolver,
  BUNDLED_RULE_CATALOG,
  serializeRuleResolverForCache,
} from "@/rules/rule-resolver";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import {
  createAnalysisResultRepository,
  MAX_ANALYSIS_RESULT_BYTES,
  MAX_ANALYSIS_RESULT_ROWS,
} from "@/infrastructure/database/analysis-result-repository";
import {
  migrateDatabase,
  LATEST_DATABASE_SCHEMA_VERSION,
} from "@/infrastructure/database/migrations";
import {
  loadLocalBackupSnapshot,
  createLocalBackupDocument,
} from "@/infrastructure/database/local-backup";
import { validateLocalBackup } from "@/infrastructure/database/local-backup-validation";
import { restoreLocalBackup } from "@/infrastructure/database/local-backup-restore";
import { createPersistentAnalysisCache } from "./persistent-analysis-cache";
import { annualAnalysisKey, prepareAnnualAnalysisSteps } from "./annual-analysis";
import {
  persistentMonthValue,
  persistentCheckValue,
  persistentSalaryValue,
  persistentAnnualValue,
} from "./persistent-analysis-values";
import {
  calculateMonthlyAnalysisSteps,
  inspectMonthlyAnalysis,
  type MonthlyAnalysisRequest,
} from "./monthly-analysis";
import {
  analysisSalaryKey,
  prepareAnalysisSalarySteps,
  type AnalysisSalaryRequest,
} from "./analysis-salary";

vi.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (calculate: () => unknown) => ({ ok: true, value: calculate() }),
}));
class Adapter {
  readonly raw = new Database(":memory:");
  async execAsync(sql: string) {
    this.raw.exec(sql);
  }
  async runAsync(sql: string, ...params: unknown[]) {
    return this.raw.prepare(sql).run(...params);
  }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params) as T[];
  }
}
const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");
const drain = <T>(steps: Generator<number, T, void>): T => {
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
  }
};
let adapter: Adapter;
beforeEach(() => {
  adapter = new Adapter();
});
afterEach(() => {
  adapter.raw.close();
  vi.useRealTimers();
});
const repository = () =>
  createAnalysisResultRepository(adapter as unknown as SQLiteDatabase, () => "2026-10");
const cache = (bundleId = "bundle-1") =>
  createPersistentAnalysisCache({ repository: repository(), sha256, bundleId });
function input(): MonthlyAnalysisRequest {
  return {
    month: "2026-10",
    entries: [7, 8, 9, 10].map((m) =>
      forecastShift({ id: `s${m}`, date: `2026-${String(m).padStart(2, "0")}-05` }),
    ),
    profile: forecastProfile,
    tariffDecisions: [],
    workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    ruleResolver: createRuleResolver(),
  };
}
const salaryInput = (month: MonthlyAnalysisRequest): AnalysisSalaryRequest => ({
  month: month.month,
  profile: month.profile,
  settings: automatedSettings("2026-01"),
  annualPayments: [],
  context: {
    entries: month.entries,
    tariffDecisions: month.tariffDecisions,
    workPatternSettings: month.workPatternSettings ?? DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    resolver: month.ruleResolver,
    testMonths: [],
  },
});

describe("persistent complete analysis", () => {
  it("persists an entirely computed year with eight supported salary months across a cold cache restart", async () => {
    const rules = () =>
      createRuleResolver({
        ...BUNDLED_RULE_CATALOG,
        tariff: BUNDLED_RULE_CATALOG.tariff.filter((item) => item.validFrom >= "2026-05-01"),
      });
    const month = input();
    const request = {
      year: 2026,
      entries: month.entries,
      profile: month.profile,
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      referenceDate: "2026-10-28",
      youthProtection: false,
      ruleResolver: rules(),
    };
    const key = annualAnalysisKey(request),
      value = drain(prepareAnnualAnalysisSteps(request, key, null));
    expect(value.availablePayMonthCount).toBe(8);
    expect(value.worktimeCoverageComplete).toBe(true);
    expect(value.complianceCoverageComplete).toBe(true);
    expect(value.months.filter((item) => item.estimatedGrossAmount === null)).toHaveLength(4);
    expect(persistentAnnualValue(value)).toBe(true);
    await cache().write(
      "annual",
      "2026-01",
      key,
      request.ruleResolver,
      value,
      persistentAnnualValue,
    );
    const restored = await cache().read("annual", "2026-01", key, rules(), persistentAnnualValue);
    expect(restored).toEqual(value);
    expect(restored?.availablePayMonthCount).toBe(8);
    expect(restored?.months.slice(0, 4).every((item) => item.estimatedGrossAmount === null)).toBe(
      true,
    );
    expect(persistentAnnualValue({ ...value, availablePayMonthCount: 12 })).toBe(false);
    expect(persistentAnnualValue({ ...value, availablePayMonthCount: -1 })).toBe(false);
    expect(persistentAnnualValue({ ...value, months: value.months.slice(0, 11) })).toBe(false);
  });
  it("restores a complete year and its Map after a new cache/catalog instance, preserving exact output", async () => {
    const month = input();
    const request = {
      year: 2026,
      entries: month.entries,
      profile: month.profile,
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      referenceDate: "2026-10-28",
      youthProtection: false,
      ruleResolver: month.ruleResolver,
    };
    const key = annualAnalysisKey(request),
      value = drain(prepareAnnualAnalysisSteps(request, key, null));
    expect(persistentAnnualValue(value)).toBe(true);
    await cache().write("annual", "2026-01", key, month.ruleResolver, value, persistentAnnualValue);
    const restored = await cache().read(
      "annual",
      "2026-01",
      key,
      createRuleResolver(),
      persistentAnnualValue,
    );
    expect(restored).toEqual(value);
    expect(restored?.distribution).toBeInstanceOf(Map);
    expect(restored?.distribution.get("NIGHT")).toBe(value.distribution.get("NIGHT"));
    expect(persistentAnnualValue({ ...value, complianceCoverageComplete: false })).toBe(false);
    expect(persistentAnnualValue({ ...value, availablePayMonthCount: 11 })).toBe(false);
    expect(persistentAnnualValue({ ...value, distribution: {} })).toBe(false);
    expect(
      await cache("different-bundle").read(
        "annual",
        "2026-01",
        key,
        month.ruleResolver,
        persistentAnnualValue,
      ),
    ).toBeNull();
    expect(
      await cache().read(
        "annual",
        "2026-01",
        key + "edit",
        month.ruleResolver,
        persistentAnnualValue,
      ),
    ).toBeNull();
  });
  it("replaces only the disposable v1 cache and protects the current annual result when other years churn", async () => {
    adapter.raw.exec("CREATE TABLE analysis_result_cache_v1 (unused TEXT)");
    const repo = repository();
    await repo.write("annual", "2026-01", "key", { payload: "{}", digest: "hash" });
    for (let year = 2030; year < 2110; year++)
      await repo.write("annual", year + "-01", "key", { payload: "{}", digest: "hash" });
    expect(await repo.read("annual", "2026-01", "key")).not.toBeNull();
    expect(
      adapter.raw
        .prepare("SELECT name FROM sqlite_master WHERE name='analysis_result_cache_v1'")
        .get(),
    ).toBeUndefined();
  });
  it("keeps a newer result when an older payload hash finishes last, including another cache instance", async () => {
    for (const separateInstance of [false, true]) {
      let release!: () => void, entered!: () => void;
      const blocked = new Promise<void>((done) => {
        release = done;
      });
      const paused = new Promise<void>((done) => {
        entered = done;
      });
      const accept = (value: unknown): value is { version: number } =>
        value !== null && typeof value === "object" && "version" in value;
      const resolver = createRuleResolver(),
        month = separateInstance ? "2026-11" : "2026-10";
      const first = createPersistentAnalysisCache({
        bundleId: "same-bundle",
        repository: repository(),
        sha256: async (text) => {
          if (text === '{"version":1}') {
            entered();
            await blocked;
          }
          return sha256(text);
        },
      });
      const older = first.write("checks", month, "old-input", resolver, { version: 1 }, accept);
      await paused;
      const newer = separateInstance
        ? createPersistentAnalysisCache({
            bundleId: "same-bundle",
            repository: repository(),
            sha256,
          })
        : first;
      await newer.write("checks", month, "new-input", resolver, { version: 2 }, accept);
      release();
      await older;
      expect(await newer.read("checks", month, "new-input", resolver, accept)).toEqual({
        version: 2,
      });
    }
  });
  it("claims the input generation before calculation and rejects late older calculations", async () => {
    const store = cache(),
      resolver = createRuleResolver();
    const accept = (value: unknown): value is number => typeof value === "number";
    const old = store.claim!("checks", "2026-10");
    const current = store.claim!("checks", "2026-10");
    await store.write("checks", "2026-10", "new", resolver, 2, accept, current);
    await store.write("checks", "2026-10", "old", resolver, 1, accept, old);
    expect(await store.read("checks", "2026-10", "new", resolver, accept)).toBe(2);
  });
  it("checks the generation again inside the SQL transaction", async () => {
    const repo = repository();
    let current = true;
    const older = repo.write(
      "checks",
      "2026-10",
      "old",
      { payload: "{}", digest: "hash" },
      () => current,
    );
    current = false;
    await older;
    expect(await repo.read("checks", "2026-10", "old")).toBeNull();
  });
  it("round-trips all three complete results with fresh cache and resolver instances", async () => {
    const request = input(),
      first = cache(),
      key = inspectMonthlyAnalysis(request).key!;
    const month = drain(calculateMonthlyAnalysisSteps(request));
    const salary = salaryInput(request),
      salaryKey = analysisSalaryKey(salary);
    const pay = drain(prepareAnalysisSalarySteps(salary, salaryKey));
    const checks = calculateMonthlyCompliance(
      request.month,
      month.complianceShifts.ok ? month.complianceShifts.value : [],
      request.profile.timeZone,
      {
        employmentProfile: request.profile,
        ruleResolver: request.ruleResolver,
        referenceDate: "2026-10-28",
      },
    );
    expect(persistentMonthValue(month)).toBe(true);
    expect(persistentSalaryValue(pay)).toBe(true);
    expect(persistentCheckValue(checks)).toBe(true);
    await first.write(
      "month",
      request.month,
      key,
      request.ruleResolver,
      month,
      persistentMonthValue,
    );
    await first.write(
      "salary",
      request.month,
      salaryKey,
      request.ruleResolver,
      pay,
      persistentSalaryValue,
    );
    await first.write(
      "checks",
      request.month,
      "check-dependencies",
      request.ruleResolver,
      checks,
      persistentCheckValue,
    );
    const reopened = cache(),
      resolver = createRuleResolver();
    expect(
      await reopened.read("month", request.month, key, resolver, persistentMonthValue),
    ).toEqual(month);
    expect(
      await reopened.read("salary", request.month, salaryKey, resolver, persistentSalaryValue),
    ).toEqual(pay);
    expect(
      await reopened.read(
        "checks",
        request.month,
        "check-dependencies",
        resolver,
        persistentCheckValue,
      ),
    ).toEqual(checks);
  });
  it("rejects changed content without requiring a revision change, settings, profile, rules or bundle", async () => {
    const request = input(),
      key = inspectMonthlyAnalysis(request).key!,
      result = drain(calculateMonthlyAnalysisSteps(request));
    await cache().write(
      "month",
      request.month,
      key,
      request.ruleResolver,
      result,
      persistentMonthValue,
    );
    for (const changed of [
      { ...request, entries: request.entries.map((entry) => ({ ...entry, endTime: "23:00" })) },
      { ...request, profile: { ...request.profile, weeklyMinutes: 1800 } },
      {
        ...request,
        workPatternSettings: {
          ...request.workPatternSettings!,
          assignment: "PERMANENT" as const,
        },
      },
    ])
      expect(
        await cache().read(
          "month",
          request.month,
          inspectMonthlyAnalysis(changed).key!,
          request.ruleResolver,
          persistentMonthValue,
        ),
      ).toBeNull();
    expect(
      await cache("bundle-2").read(
        "month",
        request.month,
        key,
        request.ruleResolver,
        persistentMonthValue,
      ),
    ).toBeNull();
    const changedCatalog = createRuleResolver({
      ...BUNDLED_RULE_CATALOG,
      legal: BUNDLED_RULE_CATALOG.legal.map((p) => ({
        ...p,
        rules: {
          ...p.rules,
          workingTime: {
            ...p.rules.workingTime,
            maxDailyMinutes: p.rules.workingTime.maxDailyMinutes + 1,
          },
        },
      })),
    });
    expect(
      await cache().read("month", request.month, key, changedCatalog, persistentMonthValue),
    ).toBeNull();
    expect(serializeRuleResolverForCache({ ...request.ruleResolver })).toBeNull();
    expect(
      await cache().read(
        "month",
        request.month,
        key,
        { ...request.ruleResolver },
        persistentMonthValue,
      ),
    ).toBeNull();
    const pay = salaryInput(request),
      originalKey = analysisSalaryKey(pay);
    expect(
      analysisSalaryKey({ ...pay, settings: { ...pay.settings!, month: "2026-02" } }),
    ).not.toBe(originalKey);
    expect(
      analysisSalaryKey({
        ...pay,
        annualPayments: [
          {
            revision: 1,
            payoutMonth: "2026-11",
            grossCents: 0,
            netBasis: { kind: "CONSTANT_PAY" },
          },
        ],
      }),
    ).not.toBe(originalKey);
  });
  it("treats missing, malformed, altered and structurally invalid payloads as misses", async () => {
    const request = input(),
      key = inspectMonthlyAnalysis(request).key!,
      result = drain(calculateMonthlyAnalysisSteps(request)),
      store = cache();
    expect(
      await store.read("month", request.month, key, request.ruleResolver, persistentMonthValue),
    ).toBeNull();
    await store.write<unknown>(
      "month",
      request.month,
      key,
      request.ruleResolver,
      result,
      persistentMonthValue,
    );
    for (const payload of ["{", "[]", '{"summary":{"ok":false}}']) {
      adapter.raw
        .prepare("UPDATE analysis_result_cache_v2 SET value_json=?,value_hash=?")
        .run(payload, await sha256(payload));
      expect(
        await store.read("month", request.month, key, request.ruleResolver, persistentMonthValue),
      ).toBeNull();
    }
    await store.write(
      "month",
      request.month,
      key,
      request.ruleResolver,
      result,
      persistentMonthValue,
    );
    adapter.raw.prepare("UPDATE analysis_result_cache_v2 SET value_hash='broken'").run();
    expect(
      await store.read("month", request.month, key, request.ruleResolver, persistentMonthValue),
    ).toBeNull();
  });
  it("does not replace valid results with failures, unavailable data or nonfinite values", async () => {
    const request = input(),
      result = drain(calculateMonthlyAnalysisSteps(request)),
      key = inspectMonthlyAnalysis(request).key!,
      store = cache();
    await store.write(
      "month",
      request.month,
      key,
      request.ruleResolver,
      result,
      persistentMonthValue,
    );
    await store.write(
      "month",
      request.month,
      key,
      request.ruleResolver,
      { ...result, pay: { ok: false, error: {} } } as unknown,
      persistentMonthValue,
    );
    await store.write<unknown>(
      "month",
      request.month,
      key,
      request.ruleResolver,
      {
        ...result,
        summary: {
          ok: true,
          value: { ...(result.summary.ok && result.summary.value), targetMinutes: NaN },
        },
      },
      persistentMonthValue,
    );
    expect(
      await store.read("month", request.month, key, request.ruleResolver, persistentMonthValue),
    ).toEqual(result);
    expect(
      persistentSalaryValue({
        annual: { proposal: null, payments: [], automatic: false },
        forecast: null,
      }),
    ).toBe(false);
  });
  it("falls back after storage errors or a bounded lookup wait", async () => {
    const request = input();
    const broken = createPersistentAnalysisCache({
      bundleId: "bundle-1",
      sha256,
      repository: {
        read: async () => {
          throw new Error("disk");
        },
        write: async () => {
          throw new Error("disk");
        },
      },
    });
    expect(
      await broken.read("checks", request.month, "key", request.ruleResolver, persistentCheckValue),
    ).toBeNull();
    vi.useFakeTimers();
    const slow = createPersistentAnalysisCache({
      bundleId: "bundle-1",
      sha256,
      lookupTimeoutMs: 20,
      repository: { read: async () => new Promise(() => {}), write: async () => {} },
    });
    const pending = slow.read(
      "checks",
      request.month,
      "key",
      request.ruleResolver,
      persistentCheckValue,
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toBeNull();
  });
  it("bounds row count and total bytes while preserving the current month", async () => {
    const repo = repository();
    await repo.write("checks", "2026-10", "key", { payload: "{}", digest: "hash" });
    for (let i = 0; i < 90; i++)
      await repo.write("month", `future-${i}`, "key", { payload: "{}", digest: "hash" });
    expect(
      adapter.raw
        .prepare("SELECT COUNT(*) AS n FROM analysis_result_cache_v2 WHERE kind<>'epoch'")
        .get(),
    ).toEqual({ n: MAX_ANALYSIS_RESULT_ROWS });
    expect(await repo.read("checks", "2026-10", "key")).not.toBeNull();
    for (let i = 0; i < 20; i++)
      await repo.write("salary", `big-${i}`, "key", {
        payload: "x".repeat(600000),
        digest: "hash",
      });
    const bytes = adapter.raw
      .prepare("SELECT SUM(length(CAST(value_json AS BLOB))) AS n FROM analysis_result_cache_v2")
      .get() as { n: number };
    expect(bytes.n).toBeLessThanOrEqual(MAX_ANALYSIS_RESULT_BYTES);
    expect(await repo.read("checks", "2026-10", "key")).not.toBeNull();
  });
  it("stays outside backups and is cleared atomically on local/cloud data replacement", async () => {
    const db = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(db);
    const before = await loadLocalBackupSnapshot(db);
    const oldRepository = repository();
    await oldRepository.write("checks", "2026-10", "key", { payload: "{}", digest: "hash" });
    expect(await loadLocalBackupSnapshot(db)).toEqual(before);
    const document = await createLocalBackupDocument(before, {
      appVersion: "test",
      createdAt: new Date("2026-10-28T00:00:00Z"),
      sha256,
    });
    const valid = await validateLocalBackup(document.serialized, {
      maxDatabaseSchemaVersion: LATEST_DATABASE_SCHEMA_VERSION,
      sha256,
    });
    await restoreLocalBackup(db, valid);
    await oldRepository.write("checks", "2026-10", "old-late", { payload: "{}", digest: "hash" });
    expect(await repository().read("checks", "2026-10", "old-late")).toBeNull();
    expect(await repository().read("checks", "2026-10", "key")).toBeNull();
  });
});
