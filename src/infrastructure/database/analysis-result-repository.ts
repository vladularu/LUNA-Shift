import type { SQLiteDatabase } from "expo-sqlite";
import { withImmediateTransaction } from "./transaction";
import { createAnalysisResultWriteQueue } from "./analysis-result-write-queue";

export type AnalysisResultKind = "month" | "checks" | "salary" | "annual" | "annual-month";
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
export const MAX_ANALYSIS_MONTH_PART_ROWS = 48;
export const MAX_ANALYSIS_MONTH_PART_BYTES = 8_388_608;
const writers = new WeakMap<SQLiteDatabase, Map<string, { active: boolean }>>();
const unmeasured = { next: (_phase: number) => {}, finish: () => {} };

/** Disposable derived data, intentionally outside user migrations, backup and sync. */
export function createAnalysisResultRepository(
  db: SQLiteDatabase,
  currentMonth: () => string,
  measureWrite?: (
    kind: AnalysisResultKind,
    month: string,
  ) => {
    next(phase: number): void;
    finish(): void;
  },
): AnalysisResultRepository {
  const writeTransaction = createAnalysisResultWriteQueue(db);
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
        CREATE TABLE IF NOT EXISTS analysis_month_parts_cache_v1 (
          kind TEXT NOT NULL CHECK(kind='annual-month'),
          month TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          value_json TEXT NOT NULL CHECK(length(value_json) <= ${MAX_ANALYSIS_RESULT_CHARACTERS}),
          value_hash TEXT NOT NULL,
          saved_at INTEGER NOT NULL,
          cache_epoch TEXT NOT NULL,
          PRIMARY KEY(kind,month)
        );
      `);
      await transaction.runAsync(
        `INSERT OR IGNORE INTO analysis_result_cache_v2(kind,month,request_hash,value_json,value_hash,saved_at)
         VALUES('epoch','',lower(hex(randomblob(16))),'{}','',0)`,
      );
      const epoch = await transaction.getFirstAsync<{ token: string }>(
        "SELECT request_hash AS token FROM analysis_result_cache_v2 WHERE kind='epoch' AND month=''",
      );
      if (!epoch) throw new Error("Missing cache epoch");
      // Backup restoration replaces the authoritative epoch. Old intermediate
      // rows remain unusable even for a repository created after the restore.
      await transaction.runAsync(
        "DELETE FROM analysis_month_parts_cache_v1 WHERE cache_epoch<>?",
        epoch.token,
      );
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
      if (entries.size > MAX_ANALYSIS_RESULT_ROWS + MAX_ANALYSIS_MONTH_PART_ROWS) {
        const oldest = entries.keys().next().value!;
        entries.get(oldest)!.active = false;
        entries.delete(oldest);
      }
      return () => token.active;
    },
    async read(kind, month, key) {
      const epoch = await initialize();
      if (kind === "annual-month")
        return db.getFirstAsync<StoredAnalysisResult>(
          `SELECT value_json AS payload,value_hash AS digest FROM analysis_month_parts_cache_v1
           WHERE kind=? AND month=? AND request_hash=? AND cache_epoch=? AND
           ?=(SELECT request_hash FROM analysis_result_cache_v2 WHERE kind='epoch' AND month='')`,
          kind,
          month,
          key,
          epoch,
          epoch,
        );
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
      const phases = measureWrite?.(kind, month) ?? unmeasured;
      phases.next(11);
      try {
        const epoch = await initialize();
        await writeTransaction(async (transaction) => {
          phases.next(12);
          if (!current()) {
            phases.next(14);
            return;
          }
          const intermediate = kind === "annual-month";
          const table = intermediate ? "analysis_month_parts_cache_v1" : "analysis_result_cache_v2";
          const inserted = await transaction.runAsync(
            `INSERT INTO ${table}(kind,month,request_hash,value_json,value_hash,saved_at${intermediate ? ",cache_epoch" : ""})
           SELECT ?,?,?,?,?,?${intermediate ? ",?" : ""} WHERE
           ?=(SELECT request_hash FROM analysis_result_cache_v2 WHERE kind='epoch' AND month='')
           ON CONFLICT(kind,month) DO UPDATE SET
           request_hash=excluded.request_hash,value_json=excluded.value_json,
           value_hash=excluded.value_hash,saved_at=excluded.saved_at${intermediate ? ",cache_epoch=excluded.cache_epoch" : ""}`,
            kind,
            month,
            key,
            value.payload,
            value.digest,
            Date.now(),
            ...(intermediate ? [epoch] : []),
            epoch,
          );
          if (inserted.changes === 0) {
            phases.next(14);
            return;
          }
          phases.next(13);
          const present = currentMonth();
          await transaction.runAsync(
            `WITH ranked AS (
             SELECT rowid,ROW_NUMBER() OVER priority AS position,
               SUM(length(CAST(value_json AS BLOB))) OVER priority AS bytes
             FROM ${table} WHERE kind<>'epoch'
             WINDOW priority AS (ORDER BY (month=? OR (kind IN ('annual','annual-month') AND substr(month,1,4)=?)) DESC,saved_at DESC,rowid DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
           ) DELETE FROM ${table} WHERE rowid IN (
             SELECT rowid FROM ranked WHERE position>? OR bytes>?
           )`,
            present,
            present.slice(0, 4),
            intermediate ? MAX_ANALYSIS_MONTH_PART_ROWS : MAX_ANALYSIS_RESULT_ROWS,
            intermediate ? MAX_ANALYSIS_MONTH_PART_BYTES : MAX_ANALYSIS_RESULT_BYTES,
          );
          phases.next(14);
        });
      } finally {
        phases.finish();
      }
    },
  };
}
