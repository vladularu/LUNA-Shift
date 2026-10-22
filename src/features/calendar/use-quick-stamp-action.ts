import { AccessibilityInfo } from "react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CalendarEntry, SaveShiftInput, ShiftEntry } from "@/domain/types";
import { userFacingErrorMessage } from "@/domain/errors";
import type { QuickEntryStampAction } from "./quick-entry-actions";
import { createQuickStampQueue, type StampPreviewDay } from "./quick-stamp-queue";
import { applyCalendarPreview } from "./calendar-render-data";
import { announceStampResult } from "./stamp-accessibility";
import { selectionFeedback } from "@/ui/haptics";

export function useQuickStampAction(options: {
  readonly entries: readonly CalendarEntry[];
  readonly removeEntry: (entry: CalendarEntry) => Promise<void>;
  readonly upsertShift: (input: SaveShiftInput) => Promise<ShiftEntry>;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onError: (message: string) => void;
}) {
  const latest = useRef(options);
  const mounted = useRef(true);
  const [preview, setPreview] = useState<readonly StampPreviewDay[]>([]);
  const queue = useRef<ReturnType<typeof createQuickStampQueue> | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    queue.current = createQuickStampQueue({
      entries: () => latest.current.entries,
      save: (input) => latest.current.upsertShift(input),
      remove: (entry) => latest.current.removeEntry(entry),
      changed: (days, busy) => {
        if (!mounted.current) return;
        setPreview(days);
        latest.current.onBusyChange(busy);
      },
      failed: (error) => {
        if (mounted.current)
          latest.current.onError(
            userFacingErrorMessage(error, "Eintrag konnte nicht geändert werden."),
          );
      },
      completed: (action, date, removed) => {
        if (!mounted.current) return;
        announceStampResult(
          AccessibilityInfo.announceForAccessibility,
          action.label,
          date,
          removed,
        );
      },
    });
    return () => {
      mounted.current = false;
      queue.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    queue.current?.reconcile();
  }, [options.entries]);
  const stamp = useCallback((action: QuickEntryStampAction, date: string) => {
    latest.current.onError("");
    selectionFeedback();
    return queue.current?.stamp(action, date) ?? Promise.resolve(false);
  }, []);
  const displayEntries = useMemo(
    () => applyCalendarPreview(options.entries, preview),
    [options.entries, preview],
  );
  return { stamp, displayEntries };
}
