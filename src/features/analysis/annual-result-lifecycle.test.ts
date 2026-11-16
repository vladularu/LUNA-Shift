import { afterEach, describe, expect, it } from "vitest";
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
import { createPersistentAnalysisCache } from "./persistent-analysis-cache";
import { persistentAnnualValue } from "./persistent-analysis-values";
import {
  annualAnalysisKey,
  prepareAnnualAnalysisSteps,
  readAnnualAnalysis,
  type AnnualAnalysisRequest,
} from "./annual-analysis";
import { buildAnnualCoreReport } from "./annual-core-report";

const close: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of close.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(join(tmpdir(), "luna-annual-restart-")))
      throw new Error("Unsafe annual test cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});
const drain = <T>(steps: Generator<number, T, void>) => {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
};
const input = (year = 2026): AnnualAnalysisRequest => ({
  year,
  entries: [forecastShift({ date: `${year}-06-05` })],
  profile: forecastProfile,
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  referenceDate: "2026-11-11",
  youthProtection: false,
  ruleResolver: createRuleResolver(),
});
function storage(filename = ":memory:") {
  const raw = new Database(filename);
  close.push(raw);
  const adapter = {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...args: unknown[]) => raw.prepare(sql).run(...args),
    getFirstAsync: async <T>(sql: string, ...args: unknown[]) =>
      (raw.prepare(sql).get(...args) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...args: unknown[]) => raw.prepare(sql).all(...args) as T[],
  };
  const repository = createAnalysisResultRepository(
    adapter as unknown as SQLiteDatabase,
    () => "2026-11",
  );
  const create = () =>
    createPersistentAnalysisCache({
      repository,
      bundleId: "annual-lifecycle",
      sha256: async (value) => createHash("sha256").update(value).digest("hex"),
    });
  return Object.assign(create, {
    close: () => {
      raw.close();
      close.splice(close.indexOf(raw), 1);
    },
  });
}
describe("finished annual result lifecycle", () => {
  it("retains both neighboring years while repeated edits replace current-year snapshots", () => {
    const current = input(),
      owner = storage()();
    const neighbors = [2025, 2027].map((year) => {
      const request = { ...current, year };
      const key = annualAnalysisKey(request);
      return { request, key, value: drain(prepareAnnualAnalysisSteps(request, key, owner)) };
    });
    for (let i = 0; i < 10; i++) {
      const request = {
        ...current,
        entries: [
          {
            ...current.entries[0]!,
            endTime: `${String(14 + (i % 8)).padStart(2, "0")}:00`,
            revision: i,
          },
        ],
      };
      drain(prepareAnnualAnalysisSteps(request, annualAnalysisKey(request), owner));
    }
    for (const n of neighbors) expect(readAnnualAnalysis(n.request, n.key, owner)).toBe(n.value);
  });
  it.each([2025, 2027])(
    "persists a finished %i with unavailable legal coverage and keeps it unavailable after a fresh cache/catalog",
    async (year) => {
      const request = {
        ...input(year),
        ruleResolver: createRuleResolver({ ...BUNDLED_RULE_CATALOG, legal: [] }),
      };
      const key = annualAnalysisKey(request),
        value = drain(prepareAnnualAnalysisSteps(request, key, null));
      expect(value.complianceCoverageComplete).toBe(false);
      expect(persistentAnnualValue(value)).toBe(true);
      expect(
        persistentAnnualValue(buildAnnualCoreReport(year, request.entries, request.profile)),
      ).toBe(false);
      const directory = mkdtempSync(join(tmpdir(), "luna-annual-restart-"));
      directories.push(directory);
      const filename = join(directory, "annual.sqlite");
      const cache = storage(filename);
      await cache().write(
        "annual",
        `${year}-01`,
        key,
        request.ruleResolver,
        value,
        persistentAnnualValue,
      );
      cache.close();
      const restored = await storage(filename)().read(
        "annual",
        `${year}-01`,
        key,
        createRuleResolver({ ...BUNDLED_RULE_CATALOG, legal: [] }),
        persistentAnnualValue,
      );
      expect(restored).toEqual(value);
      expect(restored?.complianceCoverageComplete).toBe(false);
    },
  );
  it("preserves a legitimate unavailable balance and still rejects nonfinite or contradictory coverage", () => {
    const request = input(),
      report = drain(prepareAnnualAnalysisSteps(request, annualAnalysisKey(request), null));
    const unknownBalance = {
      ...report,
      balanceMinutes: null,
      months: report.months.map((month, i) =>
        i === 5 ? { ...month, balanceMinutes: null } : month,
      ),
    };
    expect(persistentAnnualValue(unknownBalance)).toBe(true);
    expect(persistentAnnualValue({ ...report, targetMinutes: Infinity })).toBe(false);
    expect(persistentAnnualValue({ ...report, complianceCoverageComplete: false })).toBe(false);
    expect(persistentAnnualValue({ ...report, months: report.months.slice(0, 11) })).toBe(false);
  });
});
