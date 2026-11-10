import type { SQLiteDatabase } from "expo-sqlite";
import type { PflegeShiftNotificationPort } from "@/application/pflegeshift-ports";
import {
  cancelEntryNotifications,
  syncEntryNotifications,
} from "@/infrastructure/notifications/entry-notifications";
import { captureEntryNotificationGeneration } from "@/infrastructure/notifications/entry-notification-lifecycle";

export function createEntryNotificationPort(db: SQLiteDatabase): PflegeShiftNotificationPort {
  return {
    capture: () => {
      const current = captureEntryNotificationGeneration(db);
      return {
        syncEntry: (entry, timeZone) => syncEntryNotifications(db, entry, timeZone, current),
        cancelEntry: (entry) => cancelEntryNotifications(db, entry, current),
      };
    },
    syncEntry: (entry, timeZone) => syncEntryNotifications(db, entry, timeZone),
    cancelEntry: (entry) => cancelEntryNotifications(db, entry),
  };
}
