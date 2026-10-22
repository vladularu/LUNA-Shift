import { useEffect, useMemo } from "react";
import type { SQLiteDatabase } from "expo-sqlite";
import { createSharingStartupCache } from "@/application/sharing-startup-cache";
import { createSharingAuthPort } from "@/infrastructure/auth/sharing-auth";
import { listCachedSharingCalendars } from "@/infrastructure/database/calendar-sharing-repository";

/** Mounts above the own-data/catalog gates so all local reads can overlap. */
export function useSharingStartup(db: SQLiteDatabase) {
  const startup = useMemo(
    () =>
      createSharingStartupCache(createSharingAuthPort(), (id) =>
        listCachedSharingCalendars(db, id),
      ),
    [db],
  );
  useEffect(() => {
    startup.start();
    return () => startup.stop();
  }, [startup]);
  return startup;
}
