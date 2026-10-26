import { useCallback, useEffect, useRef, useState } from "react";
import { useSQLiteContext } from "expo-sqlite";
import type { WorkingTimeTargetContext } from "@/domain/working-time-target";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import {
  loadWorkingTimeTargetSettings,
  saveWorkingTimeTargetSettings,
} from "@/infrastructure/database/working-time-target-repository";

export function useWorkingTimeTargetSettings(enabled: boolean, onSaved?: () => void) {
  const db = useSQLiteContext();
  const generation = useRef(0),
    writing = useRef(false);
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    snapshot: WorkingTimeTargetSnapshot | null;
  }>({ status: "loading", snapshot: null });
  const [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const current = ++generation.current;
    setBusy(false);
    setState({ status: "loading", snapshot: null });
    if (enabled)
      void loadWorkingTimeTargetSettings(db).then(
        (snapshot) => {
          if (current === generation.current) setState({ status: "ready", snapshot });
        },
        () => {
          if (current === generation.current) setState({ status: "error", snapshot: null });
        },
      );
    return () => {
      generation.current = current + 1;
    };
  }, [db, enabled, revision]);
  async function save(context: WorkingTimeTargetContext, confirmedDates: readonly string[] = []) {
    if (!enabled || writing.current || state.status !== "ready" || !state.snapshot)
      throw new Error("Bitte die Sollzeitangaben erneut laden.");
    const current = generation.current;
    writing.current = true;
    setBusy(true);
    try {
      const snapshot = await saveWorkingTimeTargetSettings(db, {
        context,
        expected: state.snapshot,
        confirmedDates,
      });
      if (current === generation.current) setState({ status: "ready", snapshot });
      onSaved?.();
    } finally {
      writing.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  return { ...state, busy, save, reload };
}
