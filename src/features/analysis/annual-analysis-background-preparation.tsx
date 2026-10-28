import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { useActiveMonth, useActiveMonthCoordinator } from "@/navigation/active-month";
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { useLocalReferenceDate } from "./use-local-reference-date";
import { useAnalysisPersistentResults } from "./analysis-persistent-results";
import { createAnnualAnalysisWarmupRuntime } from "./annual-analysis-warmup";
/** Lower priority than prepared months; active app time only, after the startup barrier. */
export default function AnnualAnalysisBackgroundPreparation() {
  const status = usePflegeShiftStatus();
  const { profile: saved, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? saved;
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver } = useRuleCatalogRuntime();
  const { youthEnabled } = useCheckPreferences();
  const referenceDate = useLocalReferenceDate(profile?.timeZone ?? "Europe/Berlin");
  const coordinator = useActiveMonthCoordinator();
  const calendarMonth = useActiveMonth();
  const analysisMonth = useSyncExternalStore(
    coordinator.analysisRequests.subscribe,
    coordinator.analysisRequests.getMonth,
    coordinator.analysisRequests.getMonth,
  );
  const persistent = useAnalysisPersistentResults();
  const runtime = useMemo(() => createAnnualAnalysisWarmupRuntime(persistent), [persistent]);
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => () => runtime.stop(), [runtime]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") runtime.stop();
      setActive(state === "active");
    });
    return () => subscription.remove();
  }, [runtime]);
  const yearsKey = [
    ...new Set(
      [analysisMonth ?? referenceDate, referenceDate, calendarMonth].map((value) =>
        Number(value.slice(0, 4)),
      ),
    ),
  ].join("|");
  const years = useMemo(() => yearsKey.split("|").map(Number), [yearsKey]);
  useEffect(() => {
    if (!active || !status.ready || status.error !== null || profile === null) {
      runtime.stop();
      return;
    }
    runtime.prepare({
      years,
      entries,
      profile,
      tariffDecisions,
      workPatternSettings,
      testMonths,
      ruleResolver: resolver,
      referenceDate,
      youthProtection: youthEnabled ?? null,
    });
  }, [
    active,
    status.ready,
    status.error,
    profile,
    years,
    entries,
    tariffDecisions,
    workPatternSettings,
    testMonths,
    resolver,
    referenceDate,
    youthEnabled,
    runtime,
  ]);
  return null;
}
