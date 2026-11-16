import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarPerformance } from "@/application/calendar-performance";
import { createAnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import { createRuleResolver } from "@/rules/rule-resolver";
import { encodeAnalysisCacheValue } from "./analysis-cache-codec";
import { createPersistentAnalysisCache } from "./persistent-analysis-cache";

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
}
type Result = { total: number; months: Map<string, number> };
const accept = (value: unknown): value is Result =>
  typeof value === "object" &&
  value !== null &&
  "total" in value &&
  typeof value.total === "number" &&
  Number.isFinite(value.total) &&
  "months" in value &&
  value.months instanceof Map;
const result = (): Result => ({ total: 480, months: new Map([["2026-01", 480]]) });
const adapters: Adapter[] = [];
function fixture() {
  const db = new Adapter();
  adapters.push(db);
  const repo = createAnalysisResultRepository(db as unknown as SQLiteDatabase, () => "2026-01");
  const hash = vi.fn(async (text: string) => createHash("sha256").update(text).digest("hex"));
  const writes = vi.spyOn(repo, "write");
  const resolver = createRuleResolver();
  const create = () =>
    createPersistentAnalysisCache({ repository: repo, sha256: hash, bundleId: "preview-contract" });
  const store = create();
  const write = (value = result(), key = "full-input-v1") =>
    store.write("annual", "2026-01", key, resolver, value, accept);
  return { db, repo, hash, writes, resolver, create, store, write };
}
afterEach(() => {
  calendarPerformance.stop();
  calendarPerformance.clear();
  for (const db of adapters.splice(0)) db.raw.close();
  vi.restoreAllMocks();
});

describe("confirmed persisted result reuse", () => {
  it("rechecks identical cloned Maps without hashing again or changing SQLite rows", async () => {
    const f = fixture();
    calendarPerformance.start(true);
    await f.write();
    const hashes = f.hash.mock.calls.length;
    const changes = f.db.raw.prepare("SELECT total_changes() AS count").get();
    await f.write(result());
    await f.write(result());
    expect(f.writes).toHaveBeenCalledTimes(1);
    expect(f.hash).toHaveBeenCalledTimes(hashes);
    expect(f.db.raw.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
    expect(
      calendarPerformance
        .report()
        .events.filter((e) => e.kind === "analysis-cache" && e.values.reason === 7),
    ).toHaveLength(2);
  });
  it("recognizes a validated read in a fresh cache owner and still rechecks the database", async () => {
    const f = fixture();
    await f.write();
    const fresh = f.create();
    expect(await fresh.read("annual", "2026-01", "full-input-v1", f.resolver, accept)).toEqual(
      result(),
    );
    const hashes = f.hash.mock.calls.length;
    const reads = vi.spyOn(f.repo, "read");
    f.writes.mockClear();
    await fresh.write("annual", "2026-01", "full-input-v1", f.resolver, result(), accept);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(f.writes).not.toHaveBeenCalled();
    expect(f.hash).toHaveBeenCalledTimes(hashes);
  });
  it("persists an in-place Map change and a changed full input key", async () => {
    const f = fixture(),
      value = result();
    await f.write(value);
    value.months.set("2026-02", 120);
    value.total = 600;
    await f.write(value);
    await f.write(value, "same-revision-but-edited-input");
    expect(f.writes).toHaveBeenCalledTimes(3);
    expect(
      await f.store.read("annual", "2026-01", "same-revision-but-edited-input", f.resolver, accept),
    ).toEqual(value);
    expect(await f.store.read("annual", "2026-01", "full-input-v1", f.resolver, accept)).toBeNull();
  });
  it.each(["delete", "payload", "digest"])(
    "repairs a %s of a previously confirmed row",
    async (mutation) => {
      const f = fixture();
      await f.write();
      if (mutation === "delete")
        f.db.raw.exec("DELETE FROM analysis_result_cache_v2 WHERE kind='annual'");
      if (mutation === "payload")
        f.db.raw
          .prepare("UPDATE analysis_result_cache_v2 SET value_json=? WHERE kind='annual'")
          .run(encodeAnalysisCacheValue({ ...result(), total: 1 }));
      if (mutation === "digest")
        f.db.raw.exec(
          "UPDATE analysis_result_cache_v2 SET value_hash='corrupt' WHERE kind='annual'",
        );
      await f.write();
      expect(f.writes).toHaveBeenCalledTimes(2);
      expect(await f.store.read("annual", "2026-01", "full-input-v1", f.resolver, accept)).toEqual(
        result(),
      );
    },
  );
  it("retries an unconfirmed failed write and falls back if the optional confirmation read fails", async () => {
    const f = fixture();
    f.writes.mockRejectedValueOnce(new Error("write failed"));
    await f.write();
    await f.write();
    expect(f.writes).toHaveBeenCalledTimes(2);
    vi.spyOn(f.repo, "read").mockRejectedValueOnce(new Error("read failed"));
    await f.write();
    expect(f.writes).toHaveBeenCalledTimes(3);
    await f.write();
    expect(f.writes).toHaveBeenCalledTimes(3);
  });
  it("rejects an old confirmation after another owner claims and persists a newer result", async () => {
    const f = fixture();
    await f.write();
    const originalRead = f.repo.read.bind(f.repo);
    let release!: () => void;
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(f.repo, "read").mockImplementationOnce(async (...args) => {
      const saved = await originalRead(...args);
      entered();
      return new Promise<Awaited<ReturnType<typeof originalRead>>>((resolve) => {
        release = () => resolve(saved);
      });
    });
    const stale = f.write();
    await reading;
    const newer = { ...result(), total: 999 };
    await f.create().write("annual", "2026-01", "newer-input", f.resolver, newer, accept);
    release();
    await stale;
    expect(f.writes).toHaveBeenCalledTimes(2);
    expect(await f.store.read("annual", "2026-01", "newer-input", f.resolver, accept)).toEqual(
      newer,
    );
  });
  it("keeps very large full keys on the safe persistence path instead of retaining unbounded proofs", async () => {
    const f = fixture(),
      key = "x".repeat(1_100_000);
    await f.write(result(), key);
    await f.write(result(), key);
    expect(f.writes).toHaveBeenCalledTimes(2);
  });
  it("does not confirm a read that finishes after its lookup already timed out", async () => {
    const f = fixture();
    await f.write();
    const saved = await f.repo.read("annual", "2026-01", f.writes.mock.calls[0]![2]);
    let release!: () => void;
    vi.spyOn(f.repo, "read").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(saved);
        }),
    );
    const fresh = createPersistentAnalysisCache({
      repository: f.repo,
      sha256: f.hash,
      bundleId: "preview-contract",
      lookupTimeoutMs: 1,
    });
    expect(await fresh.read("annual", "2026-01", "full-input-v1", f.resolver, accept)).toBeNull();
    release();
    await new Promise((resolve) => setImmediate(resolve));
    f.writes.mockClear();
    await fresh.write("annual", "2026-01", "full-input-v1", f.resolver, result(), accept);
    expect(f.writes).toHaveBeenCalledTimes(1);
  });
});
