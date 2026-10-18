import type { SQLiteDatabase } from "expo-sqlite";
import { UserFacingError } from "@/domain/errors";
import type {
  CloudDeviceState,
  CloudLocalPort,
  PrivateCloudDocument,
} from "@/domain/private-cloud";
import { sameCloudValue } from "@/domain/private-cloud-merge";
import { readLocalBackupSnapshotInTransaction } from "./local-backup";
import { restoreLocalBackupInTransaction } from "./local-backup-restore";
import { loadCurrentDatabaseSchemaVersion } from "./local-backup-validation";
import { withImmediateTransaction } from "./transaction";
import {
  makePrivateCloudDocument,
  validatePrivateCloudDocument,
} from "@/infrastructure/private-cloud/cloud-document";

export async function migratePrivateCloud(db: SQLiteDatabase): Promise<void> {
  await withImmediateTransaction(db, (transaction) =>
    transaction.execAsync(`
    CREATE TABLE IF NOT EXISTS private_cloud_device (
      id INTEGER PRIMARY KEY CHECK(id=1), state_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS private_cloud_recovery (
      id INTEGER PRIMARY KEY CHECK(id=1), document_json TEXT NOT NULL
    );
  `),
  );
}

export function createPrivateCloudLocal(
  db: SQLiteDatabase,
  options: {
    readonly sha256: (value: string) => Promise<string>;
    readonly readPresentation: (
      transaction: SQLiteDatabase,
    ) => Promise<PrivateCloudDocument["presentation"]>;
    readonly preparePresentation: (presentation: PrivateCloudDocument["presentation"]) => Promise<{
      apply(transaction: SQLiteDatabase): Promise<void>;
      discard(): void;
    }>;
    readonly beforeReplace: (transaction: SQLiteDatabase) => Promise<void>;
    readonly recoverNotifications: () => Promise<void>;
  },
): CloudLocalPort {
  async function state(transaction = db): Promise<CloudDeviceState | null> {
    const row = await transaction.getFirstAsync<{ state_json: string }>(
      "SELECT state_json FROM private_cloud_device WHERE id=1",
    );
    return row ? (JSON.parse(row.state_json) as CloudDeviceState) : null;
  }
  async function capture(transaction: SQLiteDatabase) {
    return makePrivateCloudDocument(
      await readLocalBackupSnapshotInTransaction(transaction),
      await options.readPresentation(transaction),
    );
  }
  const save = (transaction: SQLiteDatabase, value: CloudDeviceState) =>
    transaction.runAsync(
      "INSERT INTO private_cloud_device(id,state_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json",
      JSON.stringify(value),
    );
  function requireCurrent(isCurrent: () => boolean) {
    if (!isCurrent())
      throw new Error("Das angemeldete Konto wurde gewechselt. Bitte starte den Abgleich erneut.");
  }
  async function modify(
    accountId: string,
    isCurrent: () => boolean,
    change: (value: CloudDeviceState) => CloudDeviceState,
  ) {
    await withImmediateTransaction(db, async (transaction) => {
      requireCurrent(isCurrent);
      const value = await state(transaction);
      if (value?.accountId !== accountId)
        throw new Error("Die Gerätedaten sind einem anderen Konto zugeordnet.");
      await save(transaction, change(value));
      requireCurrent(isCurrent);
    });
  }
  return {
    state,
    capture: () => withImmediateTransaction(db, capture),
    async bind(accountId, isCurrent) {
      await withImmediateTransaction(db, async (transaction) => {
        requireCurrent(isCurrent);
        const previous = await state(transaction);
        if (previous?.accountId === accountId) return;
        const document = await capture(transaction);
        await transaction.runAsync(
          "INSERT INTO private_cloud_recovery(id,document_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document_json=excluded.document_json",
          JSON.stringify(document),
        );
        await save(transaction, { accountId, baseline: null, pending: null });
        requireCurrent(isCurrent);
      });
    },
    stage: (accountId, pending, isCurrent) =>
      modify(accountId, isCurrent, (value) => ({ ...value, pending })),
    clearPending: (accountId, isCurrent) =>
      modify(accountId, isCurrent, (value) => ({ ...value, pending: null })),
    async recovery() {
      const row = await db.getFirstAsync<{ document_json: string }>(
        "SELECT document_json FROM private_cloud_recovery WHERE id=1",
      );
      return row
        ? (
            await validatePrivateCloudDocument(
              JSON.parse(row.document_json),
              await loadCurrentDatabaseSchemaVersion(db),
              options.sha256,
            )
          ).document
        : null;
    },
    async apply(accountId, expected, incoming, isCurrent) {
      const validated = await validatePrivateCloudDocument(
        incoming.document,
        await loadCurrentDatabaseSchemaVersion(db),
        options.sha256,
      );
      const changed = !sameCloudValue(expected, validated.document);
      const media = changed
        ? await options.preparePresentation(validated.document.presentation)
        : null;
      let applied = false;
      let notificationsTouched = false;
      try {
        const result = await withImmediateTransaction(db, async (transaction) => {
          requireCurrent(isCurrent);
          const value = await state(transaction);
          if (value?.accountId !== accountId) return false;
          const actual = await capture(transaction);
          if (!sameCloudValue(actual, expected)) return false;
          if (changed) {
            await transaction.runAsync(
              "INSERT INTO private_cloud_recovery(id,document_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document_json=excluded.document_json",
              JSON.stringify(actual),
            );
            notificationsTouched = true;
            await options.beforeReplace(transaction);
            requireCurrent(isCurrent);
            await restoreLocalBackupInTransaction(transaction, validated.backup, true);
            await media?.apply(transaction);
          }
          if (!sameCloudValue(value.baseline, incoming) || value.pending !== null)
            await save(transaction, { ...value, baseline: incoming, pending: null });
          requireCurrent(isCurrent);
          return true;
        });
        applied = result;
        return result;
      } catch (error) {
        if (notificationsTouched) {
          try {
            await options.recoverNotifications();
          } catch {
            throw new UserFacingError(
              "Deine Daten wurden nicht ersetzt. Starte LUNA Shift neu, damit deine Erinnerungen wieder eingerichtet werden.",
            );
          }
        }
        throw error;
      } finally {
        if (!applied) media?.discard();
      }
    },
  };
}
