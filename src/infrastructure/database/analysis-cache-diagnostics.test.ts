import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnalysisResultRepository,
  type AnnualCacheRowDiagnosis,
} from "./analysis-result-repository";

let raw: Database.Database;
let db: SQLiteDatabase;
beforeEach(() => {
  raw = new Database(":memory:");
  db = {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...args: unknown[]) => raw.prepare(sql).run(...args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) ?? null,
  } as unknown as SQLiteDatabase;
});
afterEach(() => raw.close());
const value = { payload: '{"year":2026}', digest: "exact-digest" };

describe("atomic annual cache diagnostics", () => {
  it("distinguishes an absent row from a different complete request hash", async () => {
    const events: AnnualCacheRowDiagnosis[] = [];
    const repo = createAnalysisResultRepository(
      db,
      () => "2026-11",
      undefined,
      () => (event) => events.push(event),
    );
    expect(await repo.read("annual", "2026-01", "a")).toBeNull();
    expect(events.pop()).toEqual({ state: 2, valid: 0, epoch: 1 });
    await repo.write("annual", "2026-01", "a", value);
    expect(await repo.read("annual", "2026-01", "b")).toBeNull();
    expect(events.pop()).toEqual({ state: 3, valid: 0, epoch: 1 });
    expect(await repo.read("annual", "2026-01", "a")).toEqual(value);
    expect(events.pop()).toEqual({ state: 1, valid: 1, epoch: 1 });
  });
  it("never returns a matching payload after backup restoration changed the owner epoch", async () => {
    const observe = vi.fn();
    const repo = createAnalysisResultRepository(
      db,
      () => "2026-11",
      undefined,
      () => observe,
    );
    await repo.write("annual", "2026-01", "a", value);
    raw
      .prepare("UPDATE analysis_result_cache_v2 SET request_hash='new-owner' WHERE kind='epoch'")
      .run();
    expect(await repo.read("annual", "2026-01", "a")).toBeNull();
    expect(observe).toHaveBeenLastCalledWith({ state: 4, valid: 1, epoch: 0 });
  });
  it("gives exactly the same hit/miss results with diagnostics disabled or enabled", async () => {
    const normal = createAnalysisResultRepository(db, () => "2026-11");
    const diagnostic = createAnalysisResultRepository(
      db,
      () => "2026-11",
      undefined,
      () => () => {},
    );
    await normal.write("annual", "2026-01", "a", value);
    for (const [month, key] of [
      ["2026-01", "a"],
      ["2026-01", "wrong"],
      ["2027-01", "a"],
    ])
      expect(await diagnostic.read("annual", month, key)).toEqual(
        await normal.read("annual", month, key),
      );
    raw
      .prepare("UPDATE analysis_result_cache_v2 SET request_hash='restored' WHERE kind='epoch'")
      .run();
    expect(await diagnostic.read("annual", "2026-01", "a")).toEqual(
      await normal.read("annual", "2026-01", "a"),
    );
  });
  it("does not instrument other cache kinds or break reads when optional callbacks throw", async () => {
    const begin = vi.fn(() => {
      throw new Error("optional observer");
    });
    const repo = createAnalysisResultRepository(db, () => "2026-11", undefined, begin);
    await repo.write("month", "2026-11", "m", value);
    expect(await repo.read("month", "2026-11", "m")).toEqual(value);
    expect(begin).not.toHaveBeenCalled();
    await repo.write("annual", "2026-01", "a", value);
    expect(await repo.read("annual", "2026-01", "a")).toEqual(value);
    const broken = createAnalysisResultRepository(
      db,
      () => "2026-11",
      undefined,
      () => () => {
        throw new Error("record");
      },
    );
    expect(await broken.read("annual", "2026-01", "a")).toEqual(value);
    expect(await broken.read("annual", "2026-01", "wrong")).toBeNull();
  });
});
