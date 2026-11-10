import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { CalendarEntry, SaveShiftInput } from "@/domain/types";
import { compareCalendarEntries } from "@/engine/calendar-entry-order";
import type { PflegeShiftRepositoryPort } from "./pflegeshift-ports";
import type { createEntryNotificationReconciler } from "./entry-notification-queue";

export function upsertSortedCalendarEntry(
  current: readonly CalendarEntry[],
  saved: CalendarEntry,
): readonly CalendarEntry[] {
  const next = current.filter((entry) => entry.id !== saved.id);
  let low = 0;
  let high = next.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareCalendarEntries(next[middle], saved) <= 0) low = middle + 1;
    else high = middle;
  }
  next.splice(low, 0, saved);
  return Object.freeze(next);
}

export function useShiftSaveActions({
  repository,
  setEntries,
  notificationQueue,
  timeZone,
  onWarning,
}: {
  readonly repository: Pick<PflegeShiftRepositoryPort, "saveShift" | "saveShifts">;
  readonly setEntries: Dispatch<SetStateAction<readonly CalendarEntry[]>>;
  readonly notificationQueue: ReturnType<typeof createEntryNotificationReconciler>;
  readonly timeZone: string;
  readonly onWarning: (message: string) => void;
}) {
  const publish = useCallback(
    (saved: readonly CalendarEntry[]) => {
      setEntries((current) => saved.reduce(upsertSortedCalendarEntry, current));
      for (const entry of saved) notificationQueue.sync(entry, timeZone, onWarning);
    },
    [setEntries, notificationQueue, timeZone, onWarning],
  );
  const upsertShift = useCallback(
    async (input: SaveShiftInput) => {
      const saved = await repository.saveShift(input);
      publish([saved]);
      return saved;
    },
    [repository, publish],
  );
  const upsertShifts = useCallback(
    async (inputs: readonly SaveShiftInput[]) => {
      const saved = await repository.saveShifts(inputs);
      publish(saved);
      return saved;
    },
    [repository, publish],
  );
  return { upsertShift, upsertShifts };
}
