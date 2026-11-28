import { ReportExportButton } from "@/features/report-export/report-export-button";
import { router, useLocalSearchParams } from "expo-router";
import { formatMonthTitle } from "@/engine/calendar";
import { RuleComputationNotice } from "@/features/analysis/rule-computation";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { useReportMonth } from "@/navigation/use-report-month";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ReportPeriodContent, ReportTestBadge } from "@/ui/report-layout";
import { SalaryPayrollContent, type PayrollView } from "./salary-payroll-content";
import { useSalaryReport } from "./use-salary-report";
import { SalaryPage } from "./salary-ui";

export function SalaryScreen({
  view = "salary",
  initialMonth,
}: { readonly view?: PayrollView; readonly initialMonth?: string } = {}) {
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const routeMonth = parsed.status === "valid" ? parsed.value : null;
  const { month } = useReportMonth(initialMonth ?? routeMonth);
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
  return <SalaryMonthPage view={view} month={month} />;
}

function SalaryMonthPage({ view, month }: { readonly view: PayrollView; readonly month: string }) {
  const { ready, error, reload, profile, calculation, retryRules, testMonths, absenceNetBasis } =
    useSalaryReport(month);
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
          absenceNetBasis={absenceNetBasis}
          view={view}
          projection={projection}
          month={month}
          profile={profile}
          pay={pay}
          blocked={testMonths.includes(month)}
        />
      </ReportPeriodContent>
    );
  }
  return (
    <SalaryPage
      title={view === "salary" ? "Gehalt" : "Netto-Prognose"}
      month={formatMonthTitle(month)}
      showBackFooter={false}
      backLabel="Zurück zur Auswertung"
    >
      {content}
      <ReportExportButton key={month} period={month} variant="button" />
    </SalaryPage>
  );
}
