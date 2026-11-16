import { useMemo, useState } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { annualSalaryForecast } from "./annual-salary-forecast";
import { useRustSalaryPreparation } from "./use-rust-salary-preparation";

const EMPTY: readonly AnnualSalaryPayment[] = [];
const NO_TEST_MONTHS: readonly string[] = [];

function useOriginalAnnualSalaryForecast(
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
        : { payments: enabled ? saved : EMPTY, proposal: null, automatic: false, issue: null },
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

export function useNativeAnnualSalaryForecast(
  year: number,
  saved: readonly AnnualSalaryPayment[] = EMPTY,
  enabled = true,
  testMonths: readonly string[] = NO_TEST_MONTHS,
  month = year + "-12",
): ReturnType<typeof useOriginalAnnualSalaryForecast> {
  const prepared = useRustSalaryPreparation(month, enabled, undefined, testMonths);
  const key = useMemo(
    () => JSON.stringify([year, prepared.projectionIdentity, saved, testMonths]),
    [year, prepared.projectionIdentity, saved, testMonths],
  );
  const [previous, setPrevious] = useState<{
    key: string;
    resolver: typeof prepared.resolver;
    annual: ReturnType<typeof useOriginalAnnualSalaryForecast>;
  } | null>(null);
  if (
    enabled &&
    prepared.result &&
    (previous?.key !== key ||
      previous.resolver !== prepared.resolver ||
      previous.annual !== prepared.result.annual)
  ) {
    setPrevious({ key, resolver: prepared.resolver, annual: prepared.result.annual });
  }
  const annual =
    prepared.result?.annual ??
    (previous?.key === key && previous.resolver === prepared.resolver ? previous.annual : null);
  return enabled && annual
    ? annual
    : { payments: enabled ? saved : EMPTY, proposal: null, automatic: false, issue: null };
}

export const useAnnualSalaryForecast: (
  year: number,
  saved?: readonly AnnualSalaryPayment[],
  enabled?: boolean,
  testMonths?: readonly string[],
  month?: string,
) => ReturnType<typeof useOriginalAnnualSalaryForecast> =
  process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION === "1"
    ? useNativeAnnualSalaryForecast
    : useOriginalAnnualSalaryForecast;
