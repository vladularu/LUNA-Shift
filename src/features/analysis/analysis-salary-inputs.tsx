import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import type { UserProfile } from "@/domain/types";
import { resolveNetPaySettings, type SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { analysisSalaryInputStore } from "./analysis-salary-input-store";

interface Snapshot {
  readonly status: "loading" | "ready" | "error";
  readonly timeline: readonly SavedMonthlyNetPaySettings[];
  readonly annualPayments: readonly AnnualSalaryPayment[];
  readonly error: string | null;
}
const EMPTY_PAYMENTS: readonly AnnualSalaryPayment[] = Object.freeze([]);
const SalaryInputs = createContext<Snapshot | null>(null);

/** Background and visible months consume the same committed timeline; writes invalidate it immediately. */
export function AnalysisSalaryInputsProvider({
  enabled,
  children,
}: {
  readonly enabled: boolean;
  readonly profile: UserProfile | null;
  readonly children: ReactNode;
}) {
  const db = useSQLiteContext();
  const store = useMemo(() => analysisSalaryInputStore(db), [db]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void snapshot.epoch;
      void store.ensure(true);
    }, [store, enabled, snapshot.epoch]),
  );
  const visible = enabled ? snapshot : null;
  return <SalaryInputs.Provider value={visible}>{children}</SalaryInputs.Provider>;
}

export function useAnalysisSalaryInputs(month: string, enabled: boolean) {
  const snapshot = useContext(SalaryInputs);
  return useMemo(() => {
    if (!enabled || snapshot === null || snapshot.status === "loading")
      return {
        status: "loading" as const,
        saved: null,
        annualPayments: EMPTY_PAYMENTS,
        error: null,
      };
    if (snapshot.status === "error")
      return {
        status: "error" as const,
        saved: null,
        annualPayments: EMPTY_PAYMENTS,
        error: snapshot.error,
      };
    try {
      return {
        status: "ready" as const,
        saved: resolveNetPaySettings(month, snapshot.timeline),
        annualPayments: snapshot.annualPayments,
        error: null,
      };
    } catch {
      return {
        status: "error" as const,
        saved: null,
        annualPayments: EMPTY_PAYMENTS,
        error: "Die Netto-Angaben konnten nicht geladen werden.",
      };
    }
  }, [enabled, month, snapshot]);
}
