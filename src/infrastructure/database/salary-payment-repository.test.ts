import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  SALARY_PAYMENT_KEY,
  SUGGESTED_TVOED_PAYMENT_DELAYS,
  setSalaryPaymentEmptyMonth,
  setSalaryPaymentPeriod,
} from "@/domain/salary-payment";
import {
  loadSalaryPaymentPreferences,
  saveSalaryPaymentPreferences,
} from "./salary-payment-repository";

class TestDatabase {
  readonly database = new Database(":memory:");
  failWrite = false;
  async execAsync(sql: string) {
    this.database.exec(sql);
  }
  async getFirstAsync<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    return (this.database.prepare(sql).get(...args) as T | undefined) ?? null;
  }
  async runAsync(sql: string, ...args: unknown[]) {
    if (this.failWrite) throw new Error("write failed");
    const result = this.database.prepare(sql).run(...args);
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }
}

describe("salary payment preferences storage", () => {
  let connection: TestDatabase;
  let db: SQLiteDatabase;
  const initial = DEFAULT_SALARY_PAYMENT_PREFERENCES;
  const first = setSalaryPaymentPeriod(initial, {
    effectiveMonth: "2026-08",
    delays: SUGGESTED_TVOED_PAYMENT_DELAYS,
  });
  beforeEach(() => {
    connection = new TestDatabase();
    connection.database.exec(
      "CREATE TABLE app_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)",
    );
    db = connection as unknown as SQLiteDatabase;
  });
  afterEach(() => connection.database.close());

  it("keeps an absent configuration explicitly unconfigured", async () => {
    expect(await loadSalaryPaymentPreferences(db)).toEqual(initial);
  });
  it("round-trips dated rules, empty-month reviews and the explicit employer method", async () => {
    const next = {
      ...setSalaryPaymentEmptyMonth(first, "2026-07", true),
      socialInsuranceAttribution: "CASH_VARIABLE" as const,
    };
    await saveSalaryPaymentPreferences(db, next, initial);
    expect(await loadSalaryPaymentPreferences(db)).toEqual(next);
  });
  it("rejects the second of two concurrent stale editors without losing the first save", async () => {
    const other = setSalaryPaymentPeriod(initial, {
      effectiveMonth: "2026-09",
      delays: SUGGESTED_TVOED_PAYMENT_DELAYS,
    });
    const results = await Promise.allSettled([
      saveSalaryPaymentPreferences(db, first, initial),
      saveSalaryPaymentPreferences(db, other, initial),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(await loadSalaryPaymentPreferences(db)).toEqual(first);
  });
  it("rolls back a failed save", async () => {
    await saveSalaryPaymentPreferences(db, first, initial);
    connection.failWrite = true;
    await expect(
      saveSalaryPaymentPreferences(db, setSalaryPaymentEmptyMonth(first, "2026-07", true), first),
    ).rejects.toThrow("write failed");
    expect(await loadSalaryPaymentPreferences(db)).toEqual(first);
  });
  it("surfaces corrupted stored data instead of silently resetting payment timing", async () => {
    connection.database
      .prepare("INSERT INTO app_preferences VALUES(?,?,?)")
      .run(SALARY_PAYMENT_KEY, '{"version":99}', new Date().toISOString());
    await expect(loadSalaryPaymentPreferences(db)).rejects.toThrow();
  });
});
