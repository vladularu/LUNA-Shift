import { useMemo } from "react";
import { useSQLiteContext } from "expo-sqlite";
import { usePflegeShiftEntries } from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { getMonthlyRustTransport } from "./monthly-rust-transport";
import { createStoredAnnualRustCalculator, type AnnualRustCalculator } from "./annual-rust-bridge";
function useNativeAnnualCalculator() {
  const db = useSQLiteContext();
  const { diagnosis } = useRuleCatalogRuntime();
  const { entries } = usePflegeShiftEntries();
  const transport = useMemo(() => getMonthlyRustTransport(), []);
  return useMemo(
    () => (transport ? createStoredAnnualRustCalculator(db, transport, diagnosis, entries) : null),
    [db, transport, diagnosis, entries],
  );
}
function useOriginalAnnualCalculator(): null {
  return null;
}
export const useAnnualRustCalculator: () => AnnualRustCalculator | null =
  process.env.EXPO_PUBLIC_RUST_ANNUAL_BRIDGE === "1"
    ? useNativeAnnualCalculator
    : useOriginalAnnualCalculator;
