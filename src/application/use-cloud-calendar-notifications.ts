import { useEffect, useRef } from "react";
import type { CalendarEntry } from "@/domain/types";
import type { PflegeShiftNotificationPort } from "./pflegeshift-ports";
import type { createEntryNotificationReconciler } from "./entry-notification-queue";

export interface CloudCalendarNotificationRefresh {
  readonly isCurrent: () => boolean;
  readonly notifications: PflegeShiftNotificationPort;
  readonly timeZone: string;
}

export function useCloudCalendarNotifications(
  entries: readonly CalendarEntry[],
  refresh: CloudCalendarNotificationRefresh | null,
  queue: ReturnType<typeof createEntryNotificationReconciler>,
  warning: (message: string) => void,
) {
  const reconciled = useRef<CloudCalendarNotificationRefresh | null>(null);
  useEffect(() => {
    if (!refresh || reconciled.current === refresh || !refresh.isCurrent()) return;
    reconciled.current = refresh;
    for (const entry of entries) {
      if (entry.notification == null && !(entry.kind === "SHIFT" && entry.alarmEnabled)) continue;
      queue.sync(entry, refresh.timeZone, warning, true, refresh.notifications);
    }
  }, [entries, queue, refresh, warning]);
}
