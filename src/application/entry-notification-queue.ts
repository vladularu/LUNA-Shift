import type { PflegeShiftNotificationPort, PflegeShiftDiagnosticsPort } from "./pflegeshift-ports";
import type { CalendarEntry } from "@/domain/types";

/** Serial native reminder reconciliation per entry; newer revisions supersede queued work. */
export function createEntryNotificationQueue() {
  const entries = new Map<string, { revision: number; tail: Promise<void> }>();
  return {
    enqueue(
      id: string,
      revision: number,
      task: () => Promise<void>,
      failed: (error: unknown) => void,
    ) {
      const old = entries.get(id);
      if (old && revision < old.revision) return;
      const current = { revision, tail: Promise.resolve() };
      const tail = (old?.tail ?? Promise.resolve()).then(async () => {
        if (entries.get(id) !== current) return;
        try {
          await task();
        } catch (error) {
          if (entries.get(id) === current) failed(error);
        }
      });
      current.tail = tail;
      entries.set(id, current);
      void tail.finally(() => {
        if (entries.get(id) === current) entries.delete(id);
      });
    },
  };
}

export function createEntryNotificationReconciler(
  notifications: PflegeShiftNotificationPort,
  diagnostics: PflegeShiftDiagnosticsPort,
) {
  const queue = createEntryNotificationQueue();
  return {
    sync(
      entry: CalendarEntry,
      timeZone: string,
      warning: (message: string) => void,
      restored = false,
    ) {
      queue.enqueue(
        entry.id,
        entry.revision,
        () => notifications.syncEntry(entry, timeZone),
        (error) => {
          const code = restored
            ? "ENTRY_NOTIFICATION_RESTORE_FAILED"
            : entry.kind === "SHIFT"
              ? "SHIFT_NOTIFICATION_SYNC_FAILED"
              : "APPOINTMENT_NOTIFICATION_SYNC_FAILED";
          diagnostics.record("notifications", code, error);
          warning(
            restored
              ? "Wiederhergestellt. Erinnerung konnte nicht eingerichtet werden."
              : "Gespeichert. Erinnerung konnte nicht eingerichtet werden.",
          );
        },
      );
    },
    cancel(entry: CalendarEntry, warning: (message: string) => void) {
      queue.enqueue(
        entry.id,
        entry.revision + 1,
        () => notifications.cancelEntry(entry),
        (error) => {
          diagnostics.record("notifications", "ENTRY_NOTIFICATION_CANCEL_FAILED", error);
          warning("Gelöscht. Eine geplante Erinnerung konnte nicht entfernt werden.");
        },
      );
    },
  };
}
