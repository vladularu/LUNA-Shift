import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import type { MonthlyNetPaySettings, SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { requireNetPaySettingsMonth, resolveNetPaySettings } from "@/domain/net-pay-profile";
import {
  saveContinuousNetPaySettings,
  resetAnnualSalaryPayments,
} from "@/infrastructure/database/net-pay-profile-repository";
import { analysisSalaryInputStore } from "@/features/analysis/analysis-salary-input-store";

const EMPTY_TIMELINE: readonly SavedMonthlyNetPaySettings[] = Object.freeze([]);
const EMPTY_PAYMENTS: readonly AnnualSalaryPayment[] = Object.freeze([]);

export function useNetPayProfile(
  month: string,
  enabled: boolean,
  { preserveDraft = false }: { readonly preserveDraft?: boolean } = {},
) {
  const db = useSQLiteContext();
  const store = useMemo(() => analysisSalaryInputStore(db), [db]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void snapshot.epoch;
      void store.ensure(true);
    }, [store, enabled, snapshot.epoch]),
  );
  const resolved = useMemo(() => {
    const empty = {
      month,
      saved: null,
      timeline: EMPTY_TIMELINE,
      annualPayments: EMPTY_PAYMENTS,
      error: null,
    };
    if (!enabled || snapshot.status === "loading") return { ...empty, status: "loading" as const };
    if (snapshot.status === "error")
      return { ...empty, status: "error" as const, error: snapshot.error };
    try {
      return {
        month,
        status: "ready" as const,
        saved: resolveNetPaySettings(month, snapshot.timeline),
        timeline: snapshot.timeline,
        annualPayments: snapshot.annualPayments,
        error: null,
      };
    } catch {
      return {
        ...empty,
        status: "error" as const,
        error: "Die Netto-Angaben konnten nicht geladen werden.",
      };
    }
  }, [enabled, month, snapshot]);
  const identity = useMemo(() => ({ store, month }), [store, month]);
  const current = useRef(identity);
  useLayoutEffect(() => {
    current.current = identity;
  }, [identity]);
  const [draft, setDraft] = useState<{ identity: typeof identity; value: typeof resolved } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!preserveDraft || !enabled) {
      if (draft !== null) setDraft(null);
    } else if (resolved.status === "ready" && draft?.identity !== identity) {
      setDraft({ identity, value: resolved });
    }
  }, [preserveDraft, enabled, resolved, identity, draft]);
  // Editors retain their original optimistic-concurrency basis while read-only consumers update.
  const visible = preserveDraft && enabled && draft?.identity === identity ? draft.value : resolved;
  const reload = useCallback(() => {
    store.refresh(true);
    if (enabled)
      void store.ensure(true).then(() => {
        if (preserveDraft && current.current === identity) setDraft(null);
      });
  }, [store, enabled, preserveDraft, identity]);
  async function readCommitted() {
    // Repository writes invalidate the shared snapshot only after the transaction commits.
    await store.ensure(true);
    if (store.getSnapshot().status !== "ready")
      throw new Error("Die Netto-Angaben konnten nicht geladen werden.");
    if (preserveDraft && current.current === identity) setDraft(null);
  }
  async function save(settings: MonthlyNetPaySettings, effectiveMonth = month) {
    if (writing.current || visible.status !== "ready" || settings.month !== month)
      throw new Error("Bitte die Netto-Angaben erneut laden.");
    requireNetPaySettingsMonth(effectiveMonth);
    if (effectiveMonth.slice(0, 4) !== month.slice(0, 4))
      throw new Error("Bitte einen Monat aus dem ausgewählten Jahr wählen.");
    writing.current = true;
    setBusy(true);
    try {
      await saveContinuousNetPaySettings(db, {
        settings: effectiveMonth === month ? settings : { ...settings, month: effectiveMonth },
        expectedTimeline: visible.timeline,
      });
      await readCommitted();
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function resetAnnualPayments() {
    if (writing.current || visible.status !== "ready")
      throw new Error("Bitte die Netto-Angaben erneut laden.");
    writing.current = true;
    setBusy(true);
    try {
      await resetAnnualSalaryPayments(db, {
        year: Number(month.slice(0, 4)),
        expectedTimeline: visible.timeline,
      });
      await readCommitted();
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return {
    ...visible,
    busy,
    save,
    resetAnnualPayments,
    reload,
  };
}
