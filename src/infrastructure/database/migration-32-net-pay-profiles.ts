import type { SQLiteDatabase } from "expo-sqlite";

import { withImmediateTransaction } from "./transaction";

export async function migrateNetPayProfiles(db: SQLiteDatabase, appliedAt: string): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    if (await tx.getFirstAsync("SELECT version FROM schema_migrations WHERE version=32")) return;
    await tx.execAsync(`
      CREATE TABLE net_pay_profiles (
        month TEXT PRIMARY KEY NOT NULL CHECK(length(month)=7),
        settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
        revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    await tx.runAsync("INSERT INTO schema_migrations(version,applied_at) VALUES(32,?)", appliedAt);
  });
}
