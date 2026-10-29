import canonicalize from "canonicalize";
import { UserFacingError } from "@/domain/errors";
import {
  PRIVATE_CLOUD_MAX_CHARACTERS,
  PRIVATE_CLOUD_ROW_KEYS,
  type PrivateCloudDocument,
} from "@/domain/private-cloud";
import { normalizePrivateCloudDocument } from "@/domain/private-cloud-merge";
import {
  LOCAL_BACKUP_FORMAT,
  LOCAL_BACKUP_VERSION,
  type LocalBackupSnapshot,
} from "@/infrastructure/database/local-backup";
import { validateLocalBackup } from "@/infrastructure/database/local-backup-validation";

export function makePrivateCloudDocument(
  snapshot: LocalBackupSnapshot,
  presentation: PrivateCloudDocument["presentation"],
): PrivateCloudDocument {
  const { databaseSchemaVersion, ...data } = snapshot;
  return normalizePrivateCloudDocument({
    format: "lunashift-private-cloud",
    version: 1,
    backupVersion: LOCAL_BACKUP_VERSION,
    databaseSchemaVersion,
    data,
    presentation,
  });
}

export async function validatePrivateCloudDocument(
  value: unknown,
  maxSchemaVersion: number,
  sha256: (value: string) => Promise<string>,
) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const document = value as PrivateCloudDocument;
    if (
      document.format !== "lunashift-private-cloud" ||
      document.version !== 1 ||
      (document.backupVersion !== 20 && document.backupVersion !== LOCAL_BACKUP_VERSION) ||
      !Number.isSafeInteger(document.databaseSchemaVersion) ||
      !document.data ||
      typeof document.data !== "object" ||
      Array.isArray(document.data)
    )
      throw new Error();
    const keys = [
      ...Object.keys(PRIVATE_CLOUD_ROW_KEYS).filter(
        (key) => document.backupVersion >= 21 || key !== "workingTimeTargetSettings",
      ),
      "profile",
    ].sort();
    if (canonicalize(Object.keys(document.data).sort()) !== canonicalize(keys)) throw new Error();
    const { calendarImage, calendarImageStrength } = document.presentation;
    if (!["subtle", "medium", "strong"].includes(calendarImageStrength)) throw new Error();
    const opacity = document.presentation.calendarImageOpacity;
    if (
      opacity !== undefined &&
      (typeof opacity !== "number" || !Number.isInteger(opacity) || opacity < 0 || opacity > 100)
    )
      throw new Error();
    if (
      calendarImage !== null &&
      (typeof calendarImage !== "string" ||
        calendarImage.length > 8 * 1024 * 1024 ||
        calendarImage.length % 4 !== 0 ||
        !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(calendarImage))
    )
      throw new Error();
    const serialized = canonicalize(document);
    if (!serialized || serialized.length > PRIVATE_CLOUD_MAX_CHARACTERS) throw new Error();
    // Preserve the source format for legacy cloud documents. The backup validator
    // supplies an empty target collection when restoring v20; it invents no facts.
    const unsigned = {
      format: LOCAL_BACKUP_FORMAT,
      version: document.backupVersion,
      createdAt: new Date(0).toISOString(),
      appVersion: null,
      databaseSchemaVersion: document.databaseSchemaVersion,
      data: document.data,
    };
    const backup = JSON.stringify({
      ...unsigned,
      integrity: {
        algorithm: "SHA-256",
        canonicalization: "RFC8785",
        scope: "document-without-integrity",
        value: await sha256(canonicalize(unsigned)!),
      },
    });
    const validated = await validateLocalBackup(backup, {
      maxDatabaseSchemaVersion: maxSchemaVersion,
      sha256,
    });
    return { document: normalizePrivateCloudDocument(document), backup: validated };
  } catch {
    throw new UserFacingError(
      "Dieser Cloud-Stand kann nicht übernommen werden. Bitte aktualisiere LUNA Shift oder verwende eine andere Sicherung.",
    );
  }
}
