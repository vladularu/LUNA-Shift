import { ReportExportButton } from "@/features/report-export/report-export-button";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { addMonths, formatMonthTitle } from "@/engine/calendar";
import { RuleComputationNotice } from "@/features/analysis/rule-computation";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { useReportMonth } from "@/navigation/use-report-month";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ReportPeriodContent, ReportTestBadge } from "@/ui/report-layout";
import { SalaryPayrollContent, type PayrollView } from "./salary-payroll-content";
import { useSalaryReport } from "./use-salary-report";
import { SalaryMonthNavigator, SalaryPage } from "./salary-ui";

export function SalaryScreen({
  view = "salary",
  initialMonth,
}: { readonly view?: PayrollView; readonly initialMonth?: string } = {}) {
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const routeMonth = parsed.status === "valid" ? parsed.value : null;
  const { month, selectMonth } = useReportMonth(initialMonth ?? routeMonth);
  if (parsed.status === "invalid")
    return (
      <SalaryPage
        title={view === "salary" ? "Gehalt" : "Netto-Prognose"}
        backLabel="Zurück zur Auswertung"
        showBackFooter={false}
      >
        <LoadFailureView
          title="Gehalt kann nicht geöffnet werden"
          message="Der Link enthält keinen gültigen Monat."
          actionLabel="Schließen"
          onRetry={() => router.back()}
        />
      </SalaryPage>
    );
  return (
    <SalaryMonthPage
      view={view}
      month={month}
      moveMonth={(delta) => selectMonth(addMonths(month, delta))}
    />
  );
}

function SalaryMonthPage({
  view,
  month,
  moveMonth,
}: {
  readonly view: PayrollView;
  readonly month: string;
  readonly moveMonth: (delta: number) => void;
}) {
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const { ready, error, reload, profile, calculation, retryRules, testMonths } =
    useSalaryReport(month);
  function requestMonth(delta: number) {
    if (draftBusy) return;
    if (!draftDirty) {
      moveMonth(delta);
      return;
    }
    Alert.alert("Änderungen verwerfen?", "Deine Netto-Angaben sind noch nicht gespeichert.", [
      { text: "Weiter bearbeiten", style: "cancel" },
      {
        text: "Änderungen verwerfen",
        style: "destructive",
        onPress: () => {
          setDraftDirty(false);
          moveMonth(delta);
        },
      },
    ]);
  }
  const navigation = (
    <SalaryMonthNavigator
      label={formatMonthTitle(month)}
      disabled={draftBusy}
      onNext={() => requestMonth(1)}
      onPrevious={() => requestMonth(-1)}
    />
  );
  let content;
  if (error) content = <LoadFailureView message={error} onRetry={() => void reload()} />;
  else if (calculation !== null && !calculation.ok)
    content = (
      <RuleComputationNotice
        failure={calculation}
        onRetry={retryRules}
        title="Gehalt nicht verfügbar"
      />
    );
  else if (!ready || !profile || !calculation) content = <LoadingView />;
  else {
    const { pay, projection } = calculation.value;
    content = (
      <ReportPeriodContent>
        {testMonths.includes(month) ? <ReportTestBadge /> : null}
        <SalaryPayrollContent
          key={month}
          view={view}
          projection={projection}
          month={month}
          profile={profile}
          pay={pay}
          blocked={testMonths.includes(month)}
          onDirtyChange={setDraftDirty}
          onBusyChange={setDraftBusy}
        />
      </ReportPeriodContent>
    );
  }
  return (
    <SalaryPage
      title={view === "salary" ? "Gehalt" : "Netto-Prognose"}
      showBackFooter={false}
      backLabel="Zurück zur Auswertung"
    >
      {navigation}
      {content}
      <ReportExportButton key={month} period={month} variant="button" />
    </SalaryPage>
  );
}
