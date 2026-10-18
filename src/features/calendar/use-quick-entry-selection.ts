import { useCallback, useRef } from "react";

import type { CalendarEntry, SaveShiftInput, ShiftEntry } from "@/domain/types";
import { userFacingErrorMessage } from "@/domain/errors";
import {
  matchingQuickEntries,
  saveQuickEntryAction,
  type QuickEntryStampAction,
} from "@/features/calendar/quick-entry-actions";
import { successFeedback, warningFeedback } from "@/ui/haptics";

export function useQuickEntrySelection({
  entries,
  upsertShift,
  onBusyChange,
  onError,
}: {
  readonly entries: readonly CalendarEntry[];
  readonly upsertShift: (input: SaveShiftInput) => Promise<ShiftEntry>;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onError: (message: string) => void;
}) {
  const savingDates = useRef(new Set<string>());
  const completed = useRef(false);

  return useCallback(
    async (action: QuickEntryStampAction, date: string): Promise<boolean> => {
      if (completed.current || savingDates.current.has(date)) return false;
      savingDates.current.add(date);
      onBusyChange(true);
      onError("");
      try {
        if (matchingQuickEntries(action, date, entries).length === 0) {
          await saveQuickEntryAction(action, date, upsertShift);
        }
        completed.current = true;
        successFeedback();
        return true;
      } catch (saveError) {
        warningFeedback();
        onError(userFacingErrorMessage(saveError, "Dienst konnte nicht eingetragen werden."));
        return false;
      } finally {
        savingDates.current.delete(date);
        onBusyChange(savingDates.current.size > 0);
      }
    },
    [entries, onBusyChange, onError, upsertShift],
  );
}
