import { useMemo } from "react";
import { useSQLiteContext } from "expo-sqlite";
import type { RuleCatalogRuntimeDiagnosis } from "@/application/rule-catalog-runtime";
import { createStoredMonthlyRustCalculator } from "./monthly-rust-source";
import { getMonthlyRustTransport } from "./monthly-rust-transport";
import type { MonthlyRustCalculator } from "./monthly-rust-bridge";

function useTrialMonthlyRustCalculator(diagnosis: RuleCatalogRuntimeDiagnosis) {
  const db = useSQLiteContext();
  const transport = useMemo(() => getMonthlyRustTransport(), []);
  return useMemo(
    () => (transport ? createStoredMonthlyRustCalculator(db, transport, diagnosis) : null),
    [db, transport, diagnosis],
  );
}

function useOriginalMonthlyRustCalculator(): null {
  return null;
}

/** Selected once per bundle: the default app acquires no new database dependency. */
export const useMonthlyRustCalculator: (
  diagnosis: RuleCatalogRuntimeDiagnosis,
) => MonthlyRustCalculator | null =
  process.env.EXPO_PUBLIC_RUST_MONTH_TRIAL === "1"
    ? useTrialMonthlyRustCalculator
    : useOriginalMonthlyRustCalculator;
