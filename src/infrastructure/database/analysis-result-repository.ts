import type { SQLiteDatabase } from "expo-sqlite";
import { withImmediateTransaction } from "./transaction";

export type AnalysisResultKind = "month" | "checks" | "salary" | "annual";
export interface StoredAnalysisResult {
  readonly payload: string;
  readonly digest: string;
}
export interface AnalysisResultRepository {
  claim?(kind: AnalysisResultKind, month: string): () => boolean;
  read(kind: AnalysisResultKind, month: string, key: string): Promise<StoredAnalysisResult | null>;
  write(
    kind: AnalysisResultKind,
    month: string,
    key: string,
    value: StoredAnalysisResult,
    current?: () => boolean,
  ): Promise<void>;
}

export const MAX_ANALYSIS_RESULT_CHARACTERS = 1_048_576;
export const MAX_ANALYSIS_RESULT_ROWS = 72;
export const MAX_ANALYSIS_RESULT_BYTES = 8_388_608;
const writers = new WeakMap<SQLiteDatabase, Map<string, { active: boolean }>>();

/** Disposable derived data, intentionally outside user migrations, backup and sync. */
export function createAnalysisResultRepository(
  db: SQLiteDatabase,
  currentMonth: () => string,
): AnalysisResultRepository {
  let ready: Promise<string> | null = null;
  const initialize = () =>
    (ready ??= withImmediateTransaction(db, async (transaction) => {
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS analysis_result_cache_v2 (
          kind TEXT NOT NULL CHECK(kind IN ('month','checks','salary','annual','epoch')),
          month TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          value_json TEXT NOT NULL CHECK(length(value_json) <= ${MAX_ANALYSIS_RESULT_CHARACTERS}),
          value_hash TEXT NOT NULL,
          saved_at INTEGER NOT NULL,
          PRIMARY KEY(kind,month)
        );
        DROP TABLE IF EXISTS analysis_result_cache_v1;
      `);
      await transaction.runAsync(
        `INSERT OR IGNORE INTO analysis_result_cache_v2(kind,month,request_hash,value_json,value_hash,saved_at)
         VALUES('epoch','',lower(hex(randomblob(16))),'{}','',0)`,
      );
      const epoch = await transaction.getFirstAsync<{ token: string }>(
        "SELECT request_hash AS token FROM analysis_result_cache_v2 WHERE kind='epoch' AND month=''",
      );
      if (!epoch) throw new Error("Missing cache epoch");
      return epoch.token;
    }).catch((error: unknown) => {
      ready = null;
      throw error;
    }));
  return {
    claim(kind, month) {
      const entries = writers.get(db) ?? new Map<string, { active: boolean }>();
      writers.set(db, entries);
      const id = `${kind}:${month}`;
      const previous = entries.get(id);
      if (previous) previous.active = false;
      const token = { active: true };
      entries.delete(id);
      entries.set(id, token);
      if (entries.size > MAX_ANALYSIS_RESULT_ROWS) {
        const oldest = entries.keys().next().value!;
        entries.get(oldest)!.active = false;
        entries.delete(oldest);
      }
      return () => token.active;
    },
    async read(kind, month, key) {
      const epoch = await initialize();
      return db.getFirstAsync<StoredAnalysisResult>(
        `SELECT value_json AS payload,value_hash AS digest FROM analysis_result_cache_v2
         WHERE kind=? AND month=? AND request_hash=? AND
         ?=(SELECT request_hash FROM analysis_result_cache_v2 WHERE kind='epoch' AND month='')`,
        kind,
        month,
        key,
        epoch,
      );
    },
    async write(kind, month, key, value, current = () => true) {
      if (!current() || value.payload.length > MAX_ANALYSIS_RESULT_CHARACTERS) return;
      const epoch = await initialize();
      await withImmediateTransaction(db, async (transaction) => {
        if (!current()) return;
        const inserted = await transaction.runAsync(
          `INSERT INTO analysis_result_cache_v2(kind,month,request_hash,value_json,value_hash,saved_at)
           SELECT ?,?,?,?,?,? WHERE
           ?=(SELECT request_hash FROM analysis_result_cache_v2 WHERE kind='epoch' AND month='')
           ON CONFLICT(kind,month) DO UPDATE SET
           request_hash=excluded.request_hash,value_json=excluded.value_json,
           value_hash=excluded.value_hash,saved_at=excluded.saved_at`,
          kind,
          month,
          key,
          value.payload,
          value.digest,
          Date.now(),
          epoch,
        );
        if (inserted.changes === 0) return;
        const present = currentMonth();
        await transaction.runAsync(
          `WITH ranked AS (
             SELECT rowid,ROW_NUMBER() OVER priority AS position,
               SUM(length(CAST(value_json AS BLOB))) OVER priority AS bytes
             FROM analysis_result_cache_v2 WHERE kind<>'epoch'
             WINDOW priority AS (ORDER BY (month=? OR (kind='annual' AND substr(month,1,4)=?)) DESC,saved_at DESC,rowid DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
           ) DELETE FROM analysis_result_cache_v2 WHERE rowid IN (
             SELECT rowid FROM ranked WHERE position>? OR bytes>?
           )`,
          present,
          present.slice(0, 4),
          MAX_ANALYSIS_RESULT_ROWS,
          MAX_ANALYSIS_RESULT_BYTES,
        );
      });
    },
  };
}
