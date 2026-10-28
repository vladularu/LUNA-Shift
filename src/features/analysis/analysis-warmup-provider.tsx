import { Component, lazy, Suspense, useSyncExternalStore, type PropsWithChildren } from "react";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import { AnalysisPersistentResultsProvider } from "./analysis-persistent-results";
import { recordDiagnostic } from "@/infrastructure/diagnostics";

const Preparation = lazy(() => import("./analysis-background-preparation"));
const AnnualPreparation = lazy(() => import("./annual-analysis-background-preparation"));
/** Optional preparation must never replace the calendar with an app-wide error screen. */
export class AnalysisPreparationBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    recordDiagnostic("reporting", "ANALYSIS_WARMUP_FAILED", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
/** The calculation graph is evaluated after the calendar's first-frame barrier, without remounting navigation. */
export function AnalysisWarmupProvider({ children }: PropsWithChildren) {
  const { profile, calculationProfile } = usePflegeShiftProfile();
  const started = useSyncExternalStore(
    startupPresentation.after,
    startupPresentation.isReady,
    startupPresentation.isReady,
  );
  return (
    <AnalysisPersistentResultsProvider
      timeZone={(calculationProfile ?? profile)?.timeZone ?? "Europe/Berlin"}
    >
      <AnalysisPreparationBoundary>
        <Suspense fallback={null}>{started ? <Preparation /> : null}</Suspense>
      </AnalysisPreparationBoundary>
      <AnalysisPreparationBoundary>
        <Suspense fallback={null}>{started ? <AnnualPreparation /> : null}</Suspense>
      </AnalysisPreparationBoundary>
      {children}
    </AnalysisPersistentResultsProvider>
  );
}
