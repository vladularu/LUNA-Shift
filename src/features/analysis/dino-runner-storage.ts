import type { SQLiteDatabase } from "expo-sqlite";
import { withImmediateTransaction } from "@/infrastructure/database/transaction";
import { parseRunnerProgress, type RunnerProgress } from "./dino-runner-engine";

export const RUNNER_STORAGE_KEY = "easter_egg_dino_v1";
const pendingWrites = new WeakMap<SQLiteDatabase, Promise<void>>();

export async function loadRunnerProgress(db: SQLiteDatabase): Promise<RunnerProgress> {
  // A screen can reopen while its predecessor's final save is still queued.
  await pendingWrites.get(db)?.catch(() => undefined);
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_preferences WHERE key = ?",
    RUNNER_STORAGE_KEY,
  );
  return parseRunnerProgress(row?.value ?? null);
}

export function saveRunnerProgress(db: SQLiteDatabase, progress: RunnerProgress): Promise<void> {
  const value = JSON.stringify(progress);
  const write = (pendingWrites.get(db) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      withImmediateTransaction(db, async (transaction) => {
        await transaction.runAsync(
          `INSERT INTO app_preferences(key,value,updated_at) VALUES(?,?,?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
          RUNNER_STORAGE_KEY,
          value,
          new Date().toISOString(),
        );
      }),
    );
  pendingWrites.set(db, write);
  return write;
}
