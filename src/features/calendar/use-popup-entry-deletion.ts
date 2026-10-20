import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

import type { CalendarEntry } from "@/domain/types";
import { userFacingErrorMessage } from "@/domain/errors";
import { deletionFeedback } from "@/ui/haptics";

export function usePopupEntryDeletion({
  entries,
  active,
  date,
  removeEntry,
}: {
  readonly entries: readonly CalendarEntry[];
  readonly active: boolean;
  readonly date: string;
  readonly removeEntry?: (entry: CalendarEntry) => Promise<void>;
}) {
  const [target, setTarget] = useState<CalendarEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const pending =
    target &&
    entries.some(
      (entry) =>
        entry.kind === target.kind && entry.id === target.id && entry.revision === target.revision,
    )
      ? target
      : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setTarget(null);
    setError(null);
  }, [active, date]);

  return {
    pending,
    error,
    busy,
    request(entry: CalendarEntry) {
      if (!active || inFlight.current || !removeEntry) return;
      setError(null);
      setTarget(entry);
    },
    cancel() {
      if (inFlight.current) return;
      setTarget(null);
      setError(null);
    },
    async confirm() {
      if (!active || !pending || !removeEntry || inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await removeEntry(pending);
        deletionFeedback();
        if (mounted.current) {
          setTarget(null);
          AccessibilityInfo.announceForAccessibility(`${pending.title} gelöscht.`);
        }
        return true;
      } catch (reason) {
        if (mounted.current) {
          const message = userFacingErrorMessage(
            reason,
            "Löschen fehlgeschlagen. Bitte erneut versuchen.",
          );
          setError(message);
          AccessibilityInfo.announceForAccessibility(message);
        }
        return false;
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
  };
}
