import { useMemo } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { annualSalaryForecast } from "./annual-salary-forecast";

const EMPTY: readonly AnnualSalaryPayment[] = [];
const NO_TEST_MONTHS: readonly string[] = [];

export function useAnnualSalaryForecast(
  year: number,
  saved: readonly AnnualSalaryPayment[] = EMPTY,
  enabled = true,
  testMonths: readonly string[] = NO_TEST_MONTHS,
) {
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { resolver } = useRuleCatalogRuntime();
  return useMemo(
    () =>
      enabled && profile
        ? annualSalaryForecast(
            year,
            profile,
            { entries, tariffDecisions, workPatternSettings, resolver, testMonths },
            saved,
          )
        : { payments: enabled ? saved : EMPTY, proposal: null, automatic: false },
    [
      year,
      saved,
      enabled,
      profile,
      entries,
      tariffDecisions,
      workPatternSettings,
      resolver,
      testMonths,
    ],
  );
}
