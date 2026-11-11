import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAnalysisResultWriteQueue } from "./analysis-result-write-queue";
import { createAnalysisResultRepository } from "./analysis-result-repository";
import { withImmediateTransaction } from "./transaction";

let raw: Database.Database;
let db: SQLiteDatabase;
let operations: string[];
beforeEach(() => {
  raw = new Database(":memory:");
  raw.exec("CREATE TABLE results(id TEXT PRIMARY KEY, value INTEGER);");
  operations = [];
  db = {
    execAsync: async (sql: string) => {
      operations.push(sql);
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, ...params: unknown[]) =>
      raw.prepare(sql).get(...params) ?? null,
  } as unknown as SQLiteDatabase;
});
afterEach(() => raw.close());
const rows = () => raw.prepare("SELECT * FROM results ORDER BY id").all();

describe("bounded analysis-result write transactions", () => {
  it("commits concurrent disposable writes with fewer transactions and exact values", async () => {
    const enqueue = createAnalysisResultWriteQueue(db);
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        enqueue(async (tx) => {
          await tx.runAsync("INSERT INTO results VALUES(?,?)", String(index), index);
        }),
      ),
    );
    expect(rows()).toEqual(
      Array.from({ length: 6 }, (_, index) => ({ id: String(index), value: index })),
    );
    expect(operations.filter((sql) => sql === "COMMIT;").length).toBeLessThan(6);
  });

  it("settles each sequential write only after its own committed result", async () => {
    const enqueue = createAnalysisResultWriteQueue(db);
    for (let index = 0; index < 3; index++) {
      await enqueue(async (tx) => {
        await tx.runAsync("INSERT INTO results VALUES(?,?)", String(index), index);
      });
      expect(rows()).toHaveLength(index + 1);
      expect(operations.at(-1)).toBe("COMMIT;");
    }
  });

  it("rolls back a failed batch and preserves independent valid results exactly once", async () => {
    const enqueue = createAnalysisResultWriteQueue(db);
    const results = await Promise.allSettled([
      enqueue(async (tx) => {
        await tx.runAsync("INSERT INTO results VALUES('a',1)");
      }),
      enqueue(async (tx) => {
        await tx.runAsync("INSERT INTO results VALUES('bad',2)");
        throw new Error("bad cached result");
      }),
      enqueue(async (tx) => {
        await tx.runAsync("INSERT INTO results VALUES('b',3)");
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(rows()).toEqual([
      { id: "a", value: 1 },
      { id: "b", value: 3 },
    ]);
    expect(operations).toContain("ROLLBACK;");
    await enqueue(async (tx) => {
      await tx.runAsync("INSERT INTO results VALUES('c',4)");
    });
    expect(rows()).toHaveLength(3);
  });

  it("lets a user transaction run between bounded cache batches", async () => {
    const enqueue = createAnalysisResultWriteQueue(db);
    const order: string[] = [];
    let started = () => {};
    const first = new Promise<void>((resolve) => {
      started = resolve;
    });
    const writes = Array.from({ length: 8 }, (_, index) =>
      enqueue(async () => {
        order.push(`cache-${index}`);
        if (index === 0) started();
      }),
    );
    await first;
    const user = withImmediateTransaction(db, async () => {
      order.push("user");
    });
    await Promise.all([...writes, user]);
    expect(order).toEqual([
      "cache-0",
      "cache-1",
      "cache-2",
      "cache-3",
      "user",
      "cache-4",
      "cache-5",
      "cache-6",
      "cache-7",
    ]);
  });

  it("rolls back a failed commit before individually retrying the cached SQL", async () => {
    const execute = db.execAsync.bind(db);
    let failCommit = true;
    db.execAsync = async (sql) => {
      if (sql === "COMMIT;" && failCommit) {
        failCommit = false;
        throw new Error("commit unavailable");
      }
      await execute(sql);
    };
    const enqueue = createAnalysisResultWriteQueue(db);
    await Promise.all(
      [1, 2, 3].map((value) =>
        enqueue(async (tx) => {
          await tx.runAsync("INSERT INTO results VALUES(?,?)", String(value), value);
        }),
      ),
    );
    expect(rows()).toEqual([
      { id: "1", value: 1 },
      { id: "2", value: 2 },
      { id: "3", value: 3 },
    ]);
    expect(operations).toContain("ROLLBACK;");
  });

  it("bounds retries after a native transaction failure and can process later work", async () => {
    const execute = db.execAsync.bind(db);
    let attempts = 0;
    db.execAsync = async (sql) => {
      if (sql === "BEGIN IMMEDIATE;") {
        attempts++;
        throw new Error("database unavailable");
      }
      await execute(sql);
    };
    const enqueue = createAnalysisResultWriteQueue(db);
    const results = await Promise.allSettled([1, 2, 3].map(() => enqueue(async () => {})));
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(attempts).toBeLessThanOrEqual(4);
    db.execAsync = execute;
    await enqueue(async (tx) => {
      await tx.runAsync("INSERT INTO results VALUES('later',1)");
    });
    expect(rows()).toEqual([{ id: "later", value: 1 }]);
  });

  it("rechecks superseded write claims after queued work can resume", async () => {
    const repo = createAnalysisResultRepository(db, () => "2026-11");
    await repo.read("month", "2026-11", "missing");
    const old = repo.claim!("month", "2026-11");
    const pending = repo.write("month", "2026-11", "old", { payload: "old", digest: "old" }, old);
    const current = repo.claim!("month", "2026-11");
    const next = repo.write("month", "2026-11", "new", { payload: "new", digest: "new" }, current);
    await Promise.all([pending, next]);
    expect(await repo.read("month", "2026-11", "old")).toBeNull();
    expect(await repo.read("month", "2026-11", "new")).toEqual({ payload: "new", digest: "new" });
  });

  it("never restores an old-epoch result after the cache was replaced", async () => {
    const repo = createAnalysisResultRepository(db, () => "2026-11");
    await repo.read("month", "2026-11", "missing");
    await withImmediateTransaction(db, async (tx) => {
      await tx.runAsync("DELETE FROM analysis_result_cache_v2");
      await tx.runAsync(
        "INSERT INTO analysis_result_cache_v2 VALUES('epoch','','replacement','{}','',0)",
      );
    });
    await Promise.all(
      ["2026-10", "2026-11"].map((month) =>
        repo.write("month", month, "stale", { payload: "old", digest: "old" }),
      ),
    );
    expect(
      raw.prepare("SELECT count(*) AS n FROM analysis_result_cache_v2 WHERE kind<>'epoch'").get(),
    ).toEqual({ n: 0 });
  });

  it("reports write waiting, SQL, cleanup and settlement only through its injected observer", async () => {
    const phases: number[] = [];
    let finished = 0;
    const repo = createAnalysisResultRepository(
      db,
      () => "2026-11",
      () => ({
        next: (phase) => {
          phases.push(phase);
        },
        finish: () => {
          finished++;
        },
      }),
    );
    await repo.write("month", "2026-11", "observed", { payload: "value", digest: "hash" });
    expect(phases).toEqual([11, 12, 13, 14]);
    expect(finished).toBe(1);
    expect(await repo.read("month", "2026-11", "observed")).toEqual({
      payload: "value",
      digest: "hash",
    });
  });
});
