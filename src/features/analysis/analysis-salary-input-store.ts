import type { SQLiteDatabase } from "expo-sqlite";
import {
  collectAnnualSalaryPayments,
  type SavedMonthlyNetPaySettings,
} from "@/domain/net-pay-profile";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { loadNetPayProfileTimeline } from "@/infrastructure/database/net-pay-profile-repository";
import { subscribeNetPayProfiles } from "@/infrastructure/database/net-pay-profile-events";
import { calendarPerformance } from "@/application/calendar-performance";

interface Snapshot {
  readonly epoch: number;
  readonly status: "loading" | "ready" | "error";
  readonly timeline: readonly SavedMonthlyNetPaySettings[];
  readonly annualPayments: readonly AnnualSalaryPayment[];
  readonly error: string | null;
}
const EMPTY_TIMELINE: readonly SavedMonthlyNetPaySettings[] = Object.freeze([]);
const EMPTY_PAYMENTS: readonly AnnualSalaryPayment[] = Object.freeze([]);
const stores = new WeakMap<SQLiteDatabase, ReturnType<typeof createAnalysisSalaryInputStore>>();

export function createAnalysisSalaryInputStore(db: SQLiteDatabase) {
  let epoch = 0,
    pending: Promise<void> | null = null;
  let snapshot: Snapshot = {
    epoch,
    status: "loading",
    timeline: EMPTY_TIMELINE,
    annualPayments: EMPTY_PAYMENTS,
    error: null,
  };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const refresh = () => {
    epoch++;
    pending = null;
    snapshot = {
      epoch,
      status: "loading",
      timeline: EMPTY_TIMELINE,
      annualPayments: EMPTY_PAYMENTS,
      error: null,
    };
    emit();
  };
  const unsubscribe = subscribeNetPayProfiles(db, refresh);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    ensure(retry = false) {
      if (pending !== null) return pending;
      if (snapshot.status === "ready" || (snapshot.status === "error" && !retry))
        return Promise.resolve();
      if (snapshot.status === "error") refresh();
      const current = epoch;
      calendarPerformance.record("salary-settings-start", { stage: 4 });
      const finish = calendarPerformance.span("salary-settings-end", { stage: 4 });
      pending = loadNetPayProfileTimeline(db)
        .then((timeline) => ({
          timeline,
          annualPayments: collectAnnualSalaryPayments(timeline),
        }))
        .then(
          ({ timeline, annualPayments }) => {
            if (current !== epoch) {
              finish({ state: 2 });
              return;
            }
            snapshot = {
              epoch,
              status: "ready",
              timeline,
              annualPayments,
              error: null,
            };
            pending = null;
            finish({ state: 1 });
            emit();
          },
          () => {
            if (current !== epoch) {
              finish({ state: 2 });
              return;
            }
            snapshot = {
              epoch,
              status: "error",
              timeline: EMPTY_TIMELINE,
              annualPayments: EMPTY_PAYMENTS,
              error: "Die Netto-Angaben konnten nicht geladen werden.",
            };
            pending = null;
            finish({ state: 3 });
            emit();
          },
        );
      return pending;
    },
    dispose() {
      refresh();
      unsubscribe();
      listeners.clear();
    },
  };
}
export function analysisSalaryInputStore(db: SQLiteDatabase) {
  let store = stores.get(db);
  if (!store) {
    store = createAnalysisSalaryInputStore(db);
    stores.set(db, store);
  }
  return store;
}
