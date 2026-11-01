import type { SQLiteDatabase } from "expo-sqlite";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  SALARY_PAYMENT_KEY,
  validateSalaryPaymentPreferences,
  type SalaryPaymentPreferences,
} from "@/domain/salary-payment";
import { withImmediateTransaction } from "./transaction";

export async function loadSalaryPaymentPreferences(
  db: SQLiteDatabase,
): Promise<SalaryPaymentPreferences> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_preferences WHERE key = ?",
    SALARY_PAYMENT_KEY,
  );
  return row === null
    ? DEFAULT_SALARY_PAYMENT_PREFERENCES
    : validateSalaryPaymentPreferences(JSON.parse(row.value));
}

/** Optimistic compare inside the transaction prevents a stale editor replacing a newer timeline. */
export async function saveSalaryPaymentPreferences(
  db: SQLiteDatabase,
  preferences: SalaryPaymentPreferences,
  expected: SalaryPaymentPreferences,
): Promise<void> {
  const next = JSON.stringify(validateSalaryPaymentPreferences(preferences));
  const previous = JSON.stringify(validateSalaryPaymentPreferences(expected));
  await withImmediateTransaction(db, async (transaction) => {
    const current = await loadSalaryPaymentPreferences(transaction);
    if (JSON.stringify(current) !== previous)
      throw new Error("Der Auszahlungsrhythmus wurde inzwischen geändert. Bitte erneut laden.");
    await transaction.runAsync(
      "INSERT INTO app_preferences(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      SALARY_PAYMENT_KEY,
      next,
      new Date().toISOString(),
    );
  });
}
