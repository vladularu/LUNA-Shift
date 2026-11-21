import { createHash } from "node:crypto";
import { it, expect } from "vitest";
import { changeRule, emptyWorkplaceData } from "@/domain/workplace-rules";
import { TariffAnnualTestDatabase } from "@/infrastructure/database/tariff-annual-test-database";
import { LATEST_DATABASE_SCHEMA_VERSION } from "@/infrastructure/database/migrations";
import {
  createLocalBackupDocument,
  loadLocalBackupSnapshot,
} from "@/infrastructure/database/local-backup";
import { validateLocalBackup } from "@/infrastructure/database/local-backup-validation";
import { restoreLocalBackup } from "@/infrastructure/database/local-backup-restore";
import { readWorkplaceData, updateWorkplaceData } from "./store";
it("persists concurrent changes and restores the dated answers and one-time prompt from a validated backup", async () => {
  const adapter = new TariffAnnualTestDatabase();
  const db = adapter.db;
  try {
    await adapter.setup();
    expect(await readWorkplaceData(db)).toEqual(emptyWorkplaceData);
    const limit = { mode: "limit", source: "agreed", onRequest: true, count: 5 } as const;
    await Promise.all([
      updateWorkplaceData(db, (old) => changeRule(old, "2026-06-01", "week", limit)),
      updateWorkplaceData(db, (old) =>
        changeRule(old, "2026-06-01", "series", { ...limit, count: 7 }),
      ),
    ]);
    const expected = await updateWorkplaceData(db, (old) => ({
      ...changeRule(old, "2026-07-01", "series", { mode: "unknown" }),
      handled: true,
      exceptions: ["Einzeldienst"],
    }));
    expect(expected.history[0]?.rules).toEqual({ week: limit, series: { ...limit, count: 7 } });
    const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");
    const backup = await createLocalBackupDocument(await loadLocalBackupSnapshot(db), {
      appVersion: "0.1.0",
      createdAt: new Date("2026-08-01T12:00:00Z"),
      sha256,
    });
    const validated = await validateLocalBackup(backup.serialized, {
      sha256,
      maxDatabaseSchemaVersion: LATEST_DATABASE_SCHEMA_VERSION,
    });
    await updateWorkplaceData(db, () => emptyWorkplaceData);
    await restoreLocalBackup(db, validated);
    expect(await readWorkplaceData(db)).toEqual(expected);
    adapter.fail = "INSERT INTO app_preferences";
    await expect(updateWorkplaceData(db, () => emptyWorkplaceData)).rejects.toThrow();
    expect(await readWorkplaceData(db)).toEqual(expected);
  } finally {
    adapter.database.close();
  }
});
