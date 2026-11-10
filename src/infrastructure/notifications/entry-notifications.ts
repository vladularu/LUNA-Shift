import type { SQLiteDatabase } from "expo-sqlite";

import type { CalendarEntry } from "@/domain/types";

export async function cancelAllEntryNotifications(_db: SQLiteDatabase): Promise<void> {}

export async function syncEntryNotifications(
  _db: SQLiteDatabase,
  _entry: CalendarEntry,
  _timeZone: string,
  _isCurrent?: () => boolean,
): Promise<void> {}

export async function cancelEntryNotifications(
  _db: SQLiteDatabase,
  _entry: Pick<CalendarEntry, "id" | "kind">,
  _isCurrent?: () => boolean,
): Promise<void> {}
