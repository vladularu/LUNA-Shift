import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAnalysisResultRepository,
  MAX_ANALYSIS_MONTH_PART_BYTES,
  MAX_ANALYSIS_MONTH_PART_ROWS,
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
const repository = () => createAnalysisResultRepository(db, () => "2026-11");
const value = { payload: '{"part":1}', digest: "digest" };

describe("disposable annual-month storage", () => {
  it("keeps intermediate rows separate from finished snapshots and requires exact hashes", async () => {
    const cache = repository();
    await cache.write("annual", "2026-01", "year", value);
    await cache.write("annual-month", "2026-01", "month", value);
    expect(await cache.read("annual-month", "2026-01", "month")).toEqual(value);
    expect(await cache.read("annual-month", "2026-01", "changed")).toBeNull();
    expect(await cache.read("annual", "2026-01", "year")).toEqual(value);
  });
  it("invalidates old parts and pending writers when restoration replaces the epoch", async () => {
    const old = repository();
    await old.write("annual-month", "2026-01", "before", value);
    raw
      .prepare("UPDATE analysis_result_cache_v2 SET request_hash='restored' WHERE kind='epoch'")
      .run();
    expect(await old.read("annual-month", "2026-01", "before")).toBeNull();
    await old.write("annual-month", "2026-01", "late", value);
    expect(raw.prepare("SELECT request_hash FROM analysis_month_parts_cache_v1").get()).toEqual({
      request_hash: "before",
    });
    const fresh = repository();
    expect(await fresh.read("annual-month", "2026-01", "before")).toBeNull();
    expect(raw.prepare("SELECT count(*) AS n FROM analysis_month_parts_cache_v1").get()).toEqual({
      n: 0,
    });
    await fresh.write("annual-month", "2026-01", "after", value);
    expect(await fresh.read("annual-month", "2026-01", "after")).toEqual(value);
  });
  it("does not let an older request overwrite a newer monthly claim", async () => {
    const older = repository(),
      newer = repository();
    const stale = older.claim!("annual-month", "2026-01");
    const current = newer.claim!("annual-month", "2026-01");
    await newer.write("annual-month", "2026-01", "new", value, current);
    await older.write("annual-month", "2026-01", "old", value, stale);
    expect(await newer.read("annual-month", "2026-01", "new")).toEqual(value);
  });
  it("bounds row count without evicting finished results or the current year's parts", async () => {
    const cache = repository();
    await cache.write("annual", "2026-01", "year", value);
    await cache.write("annual-month", "2026-01", "current", value);
    for (let i = 0; i < 60; i++) {
      const month = `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
      await cache.write("annual-month", month, String(i), value);
    }
    expect(raw.prepare("SELECT count(*) AS n FROM analysis_month_parts_cache_v1").get()).toEqual({
      n: MAX_ANALYSIS_MONTH_PART_ROWS,
    });
    expect(await cache.read("annual-month", "2026-01", "current")).toEqual(value);
    expect(await cache.read("annual", "2026-01", "year")).toEqual(value);
  });
  it("bounds UTF-8 payload bytes as well as JavaScript character count", async () => {
    const cache = repository();
    for (let i = 1; i <= 12; i++)
      await cache.write("annual-month", `2025-${String(i).padStart(2, "0")}`, "large", {
        payload: "ä".repeat(600000),
        digest: "digest",
      });
    const stored = raw
      .prepare(
        "SELECT sum(length(CAST(value_json AS BLOB))) AS bytes FROM analysis_month_parts_cache_v1",
      )
      .get() as { bytes: number };
    expect(stored.bytes).toBeLessThanOrEqual(MAX_ANALYSIS_MONTH_PART_BYTES);
  });
});
