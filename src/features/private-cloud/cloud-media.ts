import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import type { PrivateCloudDocument } from "@/domain/private-cloud";
import {
  loadCalendarBackground,
  loadCalendarBackgroundStrength,
  CALENDAR_BACKGROUND_KEY,
  CALENDAR_BACKGROUND_STRENGTH_KEY,
} from "@/features/settings/calendar-background-storage";

export async function readCloudPresentation(
  db: SQLiteDatabase,
): Promise<PrivateCloudDocument["presentation"]> {
  const uri = await loadCalendarBackground(db);
  const file = uri ? new File(uri) : null;
  if (file && file.size > 6 * 1024 * 1024)
    throw new Error("Dein Kalenderfoto ist für die Cloud zu groß. Bitte wähle es erneut aus.");
  return {
    calendarImage: file ? await file.base64() : null,
    calendarImageStrength: await loadCalendarBackgroundStrength(db),
  };
}

export async function prepareCloudPresentation(
  db: SQLiteDatabase,
  presentation: PrivateCloudDocument["presentation"],
) {
  let file: File | null = null;
  let name: string | null = null;
  if (presentation.calendarImage !== null) {
    const previousUri = await loadCalendarBackground(db);
    const previous = previousUri ? new File(previousUri) : null;
    if (previous && (await previous.base64()) === presentation.calendarImage) name = previous.name;
    else {
      const folder = new Directory(Paths.document, "calendar-backgrounds");
      folder.create({ intermediates: true, idempotent: true });
      name = `calendar-cloud-${Crypto.randomUUID()}.jpg`;
      file = new File(folder, name);
      file.write(
        Uint8Array.from(atob(presentation.calendarImage), (character) => character.charCodeAt(0)),
      );
    }
  }
  return {
    async apply(db: SQLiteDatabase) {
      if (name === null)
        await db.runAsync("DELETE FROM app_preferences WHERE key=?", CALENDAR_BACKGROUND_KEY);
      else
        await db.runAsync(
          "INSERT INTO app_preferences(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
          CALENDAR_BACKGROUND_KEY,
          name,
          new Date().toISOString(),
        );
      await db.runAsync(
        "INSERT INTO app_preferences(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        CALENDAR_BACKGROUND_STRENGTH_KEY,
        presentation.calendarImageStrength,
        new Date().toISOString(),
      );
    },
    discard() {
      if (file?.exists) file.delete();
    },
  };
}
