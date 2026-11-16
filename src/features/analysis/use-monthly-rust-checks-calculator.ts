import { useMemo } from "react";
import { useSQLiteContext } from "expo-sqlite";
import { usePflegeShiftEntries } from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { getMonthlyRustTransport } from "./monthly-rust-transport";
import {
  createStoredMonthlyRustChecksCalculator,
  type MonthlyRustChecksCalculator,
} from "./monthly-rust-checks";

function useNativeMonthlyChecks() {
  const db = useSQLiteContext();
  const { diagnosis } = useRuleCatalogRuntime();
  const { entries } = usePflegeShiftEntries();
  const transport = useMemo(() => getMonthlyRustTransport(), []);
  return useMemo(
    () =>
      transport ? createStoredMonthlyRustChecksCalculator(db, transport, diagnosis, entries) : null,
    [db, transport, diagnosis, entries],
  );
}
function useOriginalMonthlyChecks(): null {
  return null;
}
export const useMonthlyRustChecksCalculator: () => MonthlyRustChecksCalculator | null =
  process.env.EXPO_PUBLIC_RUST_CHECKS_BRIDGE === "1"
    ? useNativeMonthlyChecks
    : useOriginalMonthlyChecks;
