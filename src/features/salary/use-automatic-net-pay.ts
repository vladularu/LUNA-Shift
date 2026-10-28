import { useMemo } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { type AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { prepareAutomaticNetPay } from "./automatic-net-pay-preparation";

export function useAutomaticNetPay(
  month: string,
  settings: MonthlyNetPaySettings | null,
  enabled: boolean,
  testMonths: readonly string[] = [],
) {
  const { entries } = usePflegeShiftEntries();
  const { profile } = usePflegeShiftProfile();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { resolver } = useRuleCatalogRuntime();
  return useMemo<AutomaticNetPayForecast | null>(() => {
    if (!enabled || !profile || !settings) return null;
    const context = {
      entries,
      tariffDecisions,
      workPatternSettings,
      resolver,
      testMonths,
    };
    return prepareAutomaticNetPay(month, settings, profile, context);
  }, [
    enabled,
    profile,
    settings,
    entries,
    month,
    tariffDecisions,
    workPatternSettings,
    resolver,
    testMonths,
  ]);
}
