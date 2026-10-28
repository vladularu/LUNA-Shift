import { router, Stack, useIsFocused, useLocalSearchParams } from "expo-router";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import {
  parseEnumRouteParam,
  parseMonthRouteParam,
  type RouteParam,
} from "@/navigation/route-params";
import {
  complianceDetailsRoute,
  salaryRoute,
  worktimeDetailsRoute,
  shiftAnalysisRoute,
  premiumDetailsRoute,
} from "@/navigation/routes";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { AnnualReportDetails } from "./annual-report-view";
import { useAnnualReportInputs } from "./use-annual-report-inputs";
import { useSimpleAnnualReport as useDeferredAnnualReport } from "./use-simple-annual-report";
import { BackFooterLayout } from "@/ui/back-footer-layout";

export function AnnualDetailsScreen() {
  const params = useLocalSearchParams<{ month?: RouteParam; section?: RouteParam }>();
  const parsedMonth = parseMonthRouteParam(params.month);
  const parsedSection = parseEnumRouteParam(params.section, [
    "WORK",
    "CHECK",
    "PAY",
    "PREMIUM",
    "SHIFTS",
  ]);
  const valid = parsedMonth.status === "valid" && parsedSection.status === "valid";
  const year = parsedMonth.status === "valid" ? Number(parsedMonth.value.slice(0, 4)) : 2000;
  const section = parsedSection.status === "valid" ? parsedSection.value : "WORK";
  const focused = useIsFocused();
  const { ready, error, reload } = usePflegeShiftStatus();
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver } = useRuleCatalogRuntime();
  const inputs = useAnnualReportInputs(
    year,
    entries,
    tariffDecisions,
    resolver,
    valid,
    0,
    profile?.tariff !== null,
  );
  const annual = useDeferredAnnualReport({
    enabled: valid && ready && !error && focused && inputs !== null,
    entries: inputs?.ok ? inputs.value.entries : entries,
    tariffDecisions: inputs?.ok ? inputs.value.tariffDecisions : tariffDecisions,
    profile,
    workPatternSettings,
    ruleResolver: resolver,
    year,
    testMonths,
  });
  if (!valid)
    return (
      <LoadFailureView
        title="Jahresdetails können nicht geöffnet werden"
        message="Der Link enthält kein gültiges Jahr oder keinen gültigen Bereich."
        actionLabel="Schließen"
        onRetry={() => router.back()}
      />
    );
  if (!(ready && error) && annual.fatalError) throw annual.fatalError;
  const report = annual.report ?? annual.coreReport;
  return (
    <BackFooterLayout
      footerTestID="annual-details-back-footer"
      label="Zurück zur Auswertung"
      onPress={() => router.back()}
      showFooter={section === "CHECK" || section === "PAY"}
    >
      {(bottomPadding) => (
        <>
          <Stack.Screen
            options={{
              title:
                section === "SHIFTS"
                  ? "Schichten"
                  : section === "WORK"
                    ? "Stunden"
                    : section === "CHECK"
                      ? "Prüfung"
                      : section === "PREMIUM"
                        ? "Zeitzuschläge"
                        : "Gehalt",
            }}
          />
          {ready && error ? (
            <LoadFailureView message={error} onRetry={() => void reload()} />
          ) : annual.error || annual.ruleFailure ? (
            <LoadFailureView
              title="Jahresdetails nicht verfügbar"
              message={annual.error ?? "Für diese Auswertung fehlen Berechnungsdaten."}
              onRetry={annual.retry}
            />
          ) : !ready || !report ? (
            <LoadingView label="Jahresauswertung wird berechnet …" />
          ) : (
            <AnnualReportDetails
              bottomPadding={section === "CHECK" || section === "PAY" ? bottomPadding : undefined}
              report={report}
              pending={annual.report === null}
              section={section}
              testMonths={testMonths}
              onSelectMonth={(month) =>
                router.push(
                  section === "SHIFTS"
                    ? shiftAnalysisRoute(month)
                    : section === "WORK"
                      ? worktimeDetailsRoute(month)
                      : section === "CHECK"
                        ? complianceDetailsRoute(month)
                        : section === "PREMIUM"
                          ? premiumDetailsRoute(month)
                          : salaryRoute(month),
                )
              }
            />
          )}
        </>
      )}
    </BackFooterLayout>
  );
}
