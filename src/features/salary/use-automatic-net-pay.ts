import { useMemo } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { MonthlyNetPaySettings, SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { type AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { prepareAutomaticNetPay } from "./automatic-net-pay-preparation";
import { useSalaryPaymentPreferences } from "./salary-payment-preferences";
const EMPTY_TEST_MONTHS: readonly string[] = Object.freeze([]);
const EMPTY_SOURCE_SETTINGS: readonly SavedMonthlyNetPaySettings[] = Object.freeze([]);

export function useAutomaticNetPay(
  month: string,
  settings: MonthlyNetPaySettings | null,
  enabled: boolean,
  testMonths: readonly string[] = EMPTY_TEST_MONTHS,
  sourceSettings: readonly SavedMonthlyNetPaySettings[] = EMPTY_SOURCE_SETTINGS,
) {
  const payment = useSalaryPaymentPreferences();
  const { entries } = usePflegeShiftEntries();
  const { profile } = usePflegeShiftProfile();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { resolver } = useRuleCatalogRuntime();
  return useMemo<AutomaticNetPayForecast | null>(() => {
    if (!enabled || !profile || !settings || !payment.ready) return null;
    const context = {
      entries,
      tariffDecisions,
      workPatternSettings,
      resolver,
      testMonths,
    };
    return prepareAutomaticNetPay(month, settings, profile, context, {
      preferences: payment.preferences,
      perspective: "PAYOUT",
      sourceSettings,
    });
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
    sourceSettings,
    payment.ready,
    payment.preferences,
  ]);
}
