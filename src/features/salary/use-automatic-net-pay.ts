import { useMemo } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import {
  calculateAutomaticNetPayForecast,
  type AutomaticNetPayForecast,
} from "@/engine/net-pay-automatic-forecast";
import { createAutomaticNetPayCache } from "@/engine/net-pay-automatic-cache";
import { salaryMonthInput } from "./salary-month-input";
import { annualSalaryForecast } from "./annual-salary-forecast";

const cachedForecast = createAutomaticNetPayCache();

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
    try {
      const context = {
        entries,
        tariffDecisions,
        workPatternSettings,
        resolver,
        testMonths,
      };
      const { shifts, pay } = salaryMonthInput(month, profile, context);
      const annual = annualSalaryForecast(
        Number(month.slice(0, 4)),
        profile,
        context,
        settings.automation?.annualPayments,
      );
      const forecastSettings = settings.automation
        ? { ...settings, automation: { ...settings.automation, annualPayments: annual.payments } }
        : settings;
      const input = { month, profile, settings: forecastSettings, shifts, pay };
      return cachedForecast(input, resolver, () =>
        calculateAutomaticNetPayForecast(input, resolver),
      );
    } catch {
      return {
        sourceMonth: settings.month,
        result: {
          status: "unavailable" as const,
          stage: "sfn" as const,
          reason: "Die vollständige Gehaltsprognose konnte nicht berechnet werden.",
        },
      };
    }
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
