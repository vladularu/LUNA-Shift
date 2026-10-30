import type { SQLiteDatabase } from "expo-sqlite";
import { withImmediateTransaction } from "./transaction";

export async function migrateSpecialDuties(db: SQLiteDatabase, now: string): Promise<void> {
  await withImmediateTransaction(db, async (transaction) => {
    if (await transaction.getFirstAsync("SELECT version FROM schema_migrations WHERE version=35"))
      return;
    for (const table of ["shift_entries", "shift_templates"] as const) {
      const columns = await transaction.getAllAsync<{ name: string }>(
        `PRAGMA table_info(${table})`,
      );
      if (!columns.some((column) => column.name === "special_duty_json"))
        await transaction.execAsync(
          `ALTER TABLE ${table} ADD COLUMN special_duty_json TEXT CHECK (special_duty_json IS NULL OR json_valid(special_duty_json));`,
        );
    }
    await transaction.runAsync(
      "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      35,
      now,
    );
  });
}
