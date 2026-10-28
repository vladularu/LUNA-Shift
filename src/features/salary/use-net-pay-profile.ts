import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { calendarPerformance } from "@/application/calendar-performance";
import type { MonthlyNetPaySettings, SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { collectAnnualSalaryPayments, requireNetPaySettingsMonth } from "@/domain/net-pay-profile";
import {
  loadApplicableNetPaySettings,
  saveContinuousNetPaySettings,
  resetAnnualSalaryPayments,
} from "@/infrastructure/database/net-pay-profile-repository";

interface State {
  month: string;
  status: "loading" | "ready" | "error";
  saved: SavedMonthlyNetPaySettings | null;
  timeline: readonly SavedMonthlyNetPaySettings[];
  error: string | null;
}

export function useNetPayProfile(month: string, enabled: boolean) {
  const db = useSQLiteContext();
  const generation = useRef(0);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({
    month: "",
    status: "loading",
    saved: null,
    timeline: [],
    error: null,
  });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useFocusEffect(
    useCallback(() => {
      void revision;
      const current = ++generation.current;
      if (!enabled) return;
      setState((previous) =>
        previous.month === month && previous.status === "ready"
          ? previous
          : { month, status: "loading", saved: null, timeline: [], error: null },
      );
      calendarPerformance.record("salary-settings-start", {
        month: Number(month.replace("-", "")),
      });
      const measured = calendarPerformance.span("salary-settings-end", {
        month: Number(month.replace("-", "")),
      });
      void loadApplicableNetPaySettings(db, month).then(
        (value) => {
          measured({ state: current === generation.current ? 1 : 2 });
          if (current === generation.current)
            setState({ month, status: "ready", ...value, error: null });
        },
        () => {
          measured({ state: current === generation.current ? 3 : 2 });
          if (current === generation.current)
            setState({
              month,
              status: "error",
              saved: null,
              timeline: [],
              error: "Die Netto-Angaben konnten nicht geladen werden.",
            });
        },
      );
      return () => {
        ++generation.current;
      };
    }, [db, month, enabled, revision]),
  );
  const visible: State =
    state.month === month && enabled
      ? state
      : { month, status: "loading", saved: null, timeline: [], error: null };
  async function save(settings: MonthlyNetPaySettings, effectiveMonth = month) {
    if (writing.current || visible.status !== "ready" || settings.month !== month)
      throw new Error("Bitte die Netto-Angaben erneut laden.");
    requireNetPaySettingsMonth(effectiveMonth);
    if (effectiveMonth.slice(0, 4) !== month.slice(0, 4))
      throw new Error("Bitte einen Monat aus dem ausgewählten Jahr wählen.");
    const current = ++generation.current;
    writing.current = true;
    setBusy(true);
    try {
      await saveContinuousNetPaySettings(db, {
        settings: effectiveMonth === month ? settings : { ...settings, month: effectiveMonth },
        expectedTimeline: visible.timeline,
      });
      const next = await loadApplicableNetPaySettings(db, month);
      if (current === generation.current)
        setState({ month, status: "ready", ...next, error: null });
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function resetAnnualPayments() {
    if (writing.current || visible.status !== "ready")
      throw new Error("Bitte die Netto-Angaben erneut laden.");
    const current = ++generation.current;
    writing.current = true;
    setBusy(true);
    try {
      await resetAnnualSalaryPayments(db, {
        year: Number(month.slice(0, 4)),
        expectedTimeline: visible.timeline,
      });
      const next = await loadApplicableNetPaySettings(db, month);
      if (current === generation.current)
        setState({ month, status: "ready", ...next, error: null });
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const annualPayments = useMemo(
    () => collectAnnualSalaryPayments(visible.timeline),
    [visible.timeline],
  );
  return {
    ...visible,
    annualPayments,
    busy,
    save,
    resetAnnualPayments,
    reload,
  };
}
