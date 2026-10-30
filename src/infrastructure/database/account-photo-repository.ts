import type { SQLiteDatabase } from "expo-sqlite";
import { isAccountPhoto } from "@/domain/account-photo";
import { UserFacingError } from "@/domain/errors";
import { withImmediateTransaction } from "./transaction";

const key = (accountId: string) => `account_photo:${accountId}`;

/** Undefined means an older client/no photo decision; null is an explicit removal. */
export async function loadAccountPhoto(db: SQLiteDatabase, accountId: string) {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_preferences WHERE key=?",
    key(accountId),
  );
  if (!row) return undefined;
  const value: unknown = JSON.parse(row.value);
  if (!isAccountPhoto(value)) throw new Error("Invalid account photo");
  return value;
}

export async function writeAccountPhoto(
  db: SQLiteDatabase,
  accountId: string,
  photo: string | null,
) {
  if (!isAccountPhoto(photo)) throw new Error("Invalid account photo");
  await db.runAsync(
    "INSERT INTO app_preferences(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    key(accountId),
    JSON.stringify(photo),
    new Date().toISOString(),
  );
}

export async function saveAccountPhoto(
  db: SQLiteDatabase,
  accountId: string,
  photo: string | null,
  isCurrent: () => boolean,
) {
  const check = () => {
    if (!isCurrent())
      throw new UserFacingError("Dein Konto hat sich geändert. Bitte wähle das Bild erneut aus.");
  };
  await withImmediateTransaction(db, async (transaction) => {
    check();
    await writeAccountPhoto(transaction, accountId, photo);
    check();
  });
}

/** Use the bound cloud owner, never a photo left behind by another account. */
export async function boundPhotoAccount(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ state_json: string }>(
    "SELECT state_json FROM private_cloud_device WHERE id=1",
  );
  if (!row) return null;
  return (JSON.parse(row.state_json) as { accountId: string }).accountId;
}
