import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunnerRun, emptyRunnerProgress } from "./dino-runner-engine";
import { loadRunnerProgress, RUNNER_STORAGE_KEY, saveRunnerProgress } from "./dino-runner-storage";

let sql: Database.Database;
let db: SQLiteDatabase;
beforeEach(() => {
  sql = new Database(":memory:");
  sql.exec(
    "CREATE TABLE app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  db = {
    execAsync: async (query: string) => {
      sql.exec(query);
    },
    runAsync: async (query: string, ...params: unknown[]) => sql.prepare(query).run(...params),
    getFirstAsync: async (query: string, ...params: unknown[]) => sql.prepare(query).get(...params),
  } as unknown as SQLiteDatabase;
});
afterEach(() => sql.close());

describe("local runner storage", () => {
  it("persists only the highest legacy score when an existing game is saved again", async () => {
    const at = "2026-10-15T12:00:00Z";
    const run = { ...createRunnerRun(7), distance: 550 };
    sql.prepare("INSERT INTO app_preferences VALUES (?, ?, ?)").run(
      RUNNER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        run,
        scores: [
          { points: 123, at },
          { points: 329, at },
        ],
      }),
      at,
    );
    const progress = await loadRunnerProgress(db);
    await saveRunnerProgress(db, progress);
    const row = sql
      .prepare("SELECT value FROM app_preferences WHERE key = ?")
      .get(RUNNER_STORAGE_KEY) as { value: string };
    expect(JSON.parse(row.value)).toEqual({ version: 1, run, scores: [{ points: 329, at }] });
  });

  it("round-trips a run and scores without changing other preferences", async () => {
    sql
      .prepare("INSERT INTO app_preferences VALUES (?, ?, ?)")
      .run("check_show_planning_hints", "false", "before");
    expect(await loadRunnerProgress(db)).toEqual(emptyRunnerProgress());
    const progress = {
      version: 1 as const,
      run: {
        ...createRunnerRun(7),
        distance: 16000,
        elapsed: 45,
        obstacles: [
          { kind: "bird" as const, bottom: 60, x: 250, width: 36, height: 24 },
          { kind: "cactus" as const, count: 3 as const, bottom: 0, x: 500, width: 84, height: 46 },
        ],
      },
      scores: [{ points: 999, at: "2026-10-15T12:00:00Z" }],
    };
    await saveRunnerProgress(db, progress);
    expect(await loadRunnerProgress(db)).toEqual(progress);
    expect(
      sql
        .prepare("SELECT value FROM app_preferences WHERE key = ?")
        .get("check_show_planning_hints"),
    ).toEqual({ value: "false" });
  });

  it("waits for pending saves when closing and immediately reopening", async () => {
    const first = { ...emptyRunnerProgress(), run: createRunnerRun(1) };
    const latest = { ...first, run: { ...first.run, distance: 900 } };
    const saves = [saveRunnerProgress(db, first), saveRunnerProgress(db, latest)];
    expect(await loadRunnerProgress(db)).toEqual(latest);
    await Promise.all(saves);
  });

  it("reports database failures and permits a later save retry", async () => {
    sql.exec("DROP TABLE app_preferences");
    await expect(loadRunnerProgress(db)).rejects.toThrow();
    await expect(saveRunnerProgress(db, emptyRunnerProgress())).rejects.toThrow();
    sql.exec(
      "CREATE TABLE app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    await saveRunnerProgress(db, emptyRunnerProgress());
    expect(sql.prepare("SELECT key FROM app_preferences").all()).toEqual([
      { key: RUNNER_STORAGE_KEY },
    ]);
  });
});
