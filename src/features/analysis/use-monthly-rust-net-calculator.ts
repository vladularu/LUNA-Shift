import { useMemo } from "react";
import { useSQLiteContext } from "expo-sqlite";
import type { RuleCatalogRuntimeDiagnosis } from "@/application/rule-catalog-runtime";
import { getMonthlyRustTransport } from "./monthly-rust-transport";
import {
  createStoredMonthlyRustNetCalculator,
  type MonthlyRustNetCalculator,
} from "./monthly-rust-net";

function useNativeNetCalculator(diagnosis: RuleCatalogRuntimeDiagnosis) {
  const db = useSQLiteContext();
  const transport = useMemo(() => getMonthlyRustTransport(), []);
  return useMemo(
    () => (transport ? createStoredMonthlyRustNetCalculator(db, transport, diagnosis) : null),
    [db, transport, diagnosis],
  );
}
function useOriginalNetCalculator(): null {
  return null;
}
export const useMonthlyRustNetCalculator: (
  diagnosis: RuleCatalogRuntimeDiagnosis,
) => MonthlyRustNetCalculator | null =
  process.env.EXPO_PUBLIC_RUST_NET_BRIDGE === "1"
    ? useNativeNetCalculator
    : useOriginalNetCalculator;
