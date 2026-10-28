import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { useActiveMonth, useActiveMonthCoordinator } from "@/navigation/active-month";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { useLocalReferenceDate } from "./use-local-reference-date";
import { useAnalysisPersistentResults } from "./analysis-persistent-results";
import { analysisSalaryInputStore } from "./analysis-salary-input-store";
import { createAnalysisWarmupRuntime } from "./analysis-warmup-runtime";
export default function AnalysisBackgroundPreparation() {
  const db = useSQLiteContext();
  const status = usePflegeShiftStatus();
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
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
  const started = useSyncExternalStore(
    startupPresentation.after,
    startupPresentation.isReady,
    startupPresentation.isReady,
  );
  const [active, setActive] = useState(AppState.currentState === "active");
  const inputs = useMemo(() => analysisSalaryInputStore(db), [db]);
  const snapshot = useSyncExternalStore(inputs.subscribe, inputs.getSnapshot, inputs.getSnapshot);
  const persistent = useAnalysisPersistentResults();
  const runtime = useMemo(() => createAnalysisWarmupRuntime(persistent), [persistent]);
  useEffect(() => () => runtime.stop(), [runtime]);
  const monthsKey = [
    ...new Set([
      analysisMonth ?? referenceDate.slice(0, 7),
      calendarMonth,
      referenceDate.slice(0, 7),
    ]),
  ].join("|");
  const months = useMemo(() => monthsKey.split("|"), [monthsKey]);
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && previous !== "active") inputs.refresh();
      previous = state;
      if (state !== "active") runtime.stop();
      setActive(state === "active");
    });
    return () => subscription.remove();
  }, [inputs, runtime]);
  useEffect(() => {
    if (active && started && status.ready && status.error === null && profile !== null)
      void inputs.ensure();
  }, [active, started, status.ready, status.error, profile, inputs, snapshot.epoch]);
  useEffect(() => {
    if (
      !active ||
      !started ||
      !status.ready ||
      status.error !== null ||
      profile === null ||
      savedProfile === null
    ) {
      runtime.stop();
      return;
    }
    runtime.prepare({
      months,
      profile,
      savedProfile,
      entries,
      tariffDecisions,
      workPatternSettings,
      testMonths,
      resolver,
      timeline: snapshot.status === "ready" ? snapshot.timeline : null,
      annualPayments: snapshot.status === "ready" ? snapshot.annualPayments : null,
      referenceDate,
      youthProtection: youthEnabled ?? null,
    });
  }, [
    active,
    started,
    status.ready,
    status.error,
    profile,
    savedProfile,
    snapshot,
    months,
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
