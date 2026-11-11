import type { SQLiteDatabase } from "expo-sqlite";
import { withImmediateTransaction } from "./transaction";

/** Cache-only SQL tasks may be replayed after a rolled-back batch. */
export function createAnalysisResultWriteQueue(db: SQLiteDatabase) {
  type Item = {
    task: (transaction: SQLiteDatabase) => Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  };
  const pending: Item[] = [];
  let active = false;
  async function flush() {
    // Yield the shared database queue between small groups of disposable writes.
    const batch = pending.splice(0, 4);
    try {
      await withImmediateTransaction(db, async (transaction) => {
        for (const item of batch) await item.task(transaction);
      });
      for (const item of batch) item.resolve();
    } catch {
      // A bad cached result must not discard independent valid results.
      for (const item of batch) {
        try {
          await withImmediateTransaction(db, item.task);
          item.resolve();
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      if (pending.length) void Promise.resolve().then(flush);
      else active = false;
    }
  }
  return (task: Item["task"]) =>
    new Promise<void>((resolve, reject) => {
      pending.push({ task, resolve, reject });
      if (!active) {
        active = true;
        void Promise.resolve().then(flush);
      }
    });
}
