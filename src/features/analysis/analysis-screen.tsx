import { ReportExportButton } from "@/features/report-export/report-export-button";
import { useNetPayProfile } from "@/features/salary/use-net-pay-profile";
import { useAnnualSalaryForecast } from "@/features/salary/use-annual-salary-forecast";
import { router, useIsFocused } from "expo-router";
import { useEffect, useMemo, type ReactNode } from "react";
import { View } from "react-native";

import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { AnalysisViewControls } from "./analysis-view-controls";
import { MonthOverview } from "./month-overview";
import { calculateMonthlyAnalysis } from "@/features/analysis/monthly-analysis";
import { AnnualReportRuleFailure } from "@/features/analysis/annual-report-failure";
import { AnalysisYearHeader } from "@/features/analysis/analysis-period-header";
import { AnalysisCoverageNote } from "@/features/analysis/analysis-coverage-note";
import {
  AnalysisMonthHeader,
  ExpandableHighlightCard,
  formatMonthRangeLabel,
} from "@/features/analysis/analysis-overview-cards";
import { AnnualReportScreen } from "@/features/analysis/annual-report-view";
import { useAnnualReportInputs } from "@/features/analysis/use-annual-report-inputs";
import { useSimpleAnnualReport as useDeferredAnnualReport } from "@/features/analysis/use-simple-annual-report";
import { useDeferredMonthlyCompliance } from "@/features/analysis/use-monthly-compliance";
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { PLANNING_HIDDEN_NOTICE, selectVisibleCompliance } from "./check-visibility";
import { complianceDetailsRoute, salaryRoute } from "@/navigation/routes";
import { useActiveMonthCoordinator } from "@/navigation/active-month";
import { usePalette } from "@/theme/palette";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ReportPeriodContent, ReportScrollView, ReportTestBadge } from "@/ui/report-layout";

import { ComplianceDetails } from "./compliance-details";
import { AnalysisMonthTransition } from "./analysis-month-transition";
import { useAnalysisNavigation } from "./use-analysis-navigation";
import { ReportPeriodPager } from "@/ui/report-period-pager";
import { AnalysisScene } from "./analysis-scene";
export type AnalysisExpandedCard = "CHECK" | "PAY";
export { ComplianceDetails } from "./compliance-details";

const EMPTY_SHIFTS: readonly ShiftEntry[] = Object.freeze([]);

export function AnalysisScreen({
  initialExpandedCard = null,
}: {
  readonly initialExpandedCard?: AnalysisExpandedCard | null;
}) {
  const { profile } = usePflegeShiftProfile();
  const isFocused = useIsFocused();
  const activeMonthCoordinator = useActiveMonthCoordinator();
  const navigation = useAnalysisNavigation(profile?.timeZone);
  const { month, period, routeMonth, selectMonth, changePeriod } = navigation;
  useEffect(() => {
    if (initialExpandedCard) {
      const targetMonth = routeMonth ?? activeMonthCoordinator.getMonth();
      router.push(
        initialExpandedCard === "PAY"
          ? salaryRoute(targetMonth)
          : complianceDetailsRoute(targetMonth),
      );
    }
  }, [initialExpandedCard, routeMonth, activeMonthCoordinator]);
  return (
    <AnalysisScene focused={isFocused}>
      <ReportPeriodPager
        key={period}
        value={month}
        unit={period}
        enabled={isFocused}
        onChange={selectMonth}
        renderPage={(pageMonth, move, active) => (
          <AnalysisPage
            month={pageMonth}
            period={period}
            move={move}
            active={active}
            changePeriod={changePeriod}
          />
        )}
      />
    </AnalysisScene>
  );
}

function AnalysisPage({
  month,
  period,
  move,
  active,
  changePeriod,
}: {
  readonly month: string;
  readonly period: "MONTH" | "YEAR";
  readonly move: (delta: number) => void;
  readonly active: boolean;
  readonly changePeriod: (period: "MONTH" | "YEAR") => void;
}) {
  const year = Number(month.slice(0, 4));
  const moveMonth = move;
  const moveYear = move;
  const palette = usePalette();
  const isFocused = useIsFocused();
  const checkPreferences = useCheckPreferences();
  const { error, ready, reload } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver: ruleResolver } = useRuleCatalogRuntime();
  const calculationMonth = month;
  const salaryPayments = useNetPayProfile(month, period === "MONTH" && !testMonths.includes(month));
  const annualSalary = useAnnualSalaryForecast(
    Number(month.slice(0, 4)),
    salaryPayments.annualPayments,
    period === "MONTH" && !testMonths.includes(month) && salaryPayments.status === "ready",
    testMonths,
  );
  const monthlyCalculation = useMemo(() => {
    if (!isFocused || period !== "MONTH" || !ready || error !== null || profile === null)
      return null;
    return calculateMonthlyAnalysis(
      calculationMonth,
      entries,
      profile,
      tariffDecisions,
      workPatternSettings,
      ruleResolver,
    );
  }, [
    entries,
    error,
    isFocused,
    calculationMonth,
    period,
    profile,
    ready,
    ruleResolver,
    tariffDecisions,
    workPatternSettings,
  ]);
  const monthlyData = monthlyCalculation;
  const monthlyCompliance = useDeferredMonthlyCompliance({
    enabled:
      isFocused &&
      period === "MONTH" &&
      calculationMonth === month &&
      monthlyData !== null &&
      monthlyData.complianceShifts.ok,
    month: calculationMonth,
    profile,
    ruleResolver,
    shifts:
      monthlyData?.complianceShifts.ok === true ? monthlyData.complianceShifts.value : EMPTY_SHIFTS,
  });
  const compliance = monthlyCompliance.result;
  const annualInputs = useAnnualReportInputs(
    year,
    entries,
    tariffDecisions,
    ruleResolver,
    period === "YEAR",
    0,
    profile?.tariff !== null,
  );
  const annualReport = useDeferredAnnualReport({
    enabled: ready && !error && isFocused && period === "YEAR" && annualInputs !== null,
    entries: annualInputs?.ok ? annualInputs.value.entries : entries,
    profile,
    ruleResolver,
    tariffDecisions: annualInputs?.ok ? annualInputs.value.tariffDecisions : tariffDecisions,
    workPatternSettings,
    year,
  });

  function retainScene(content: ReactNode) {
    return <AnalysisScene focused={isFocused}>{content}</AnalysisScene>;
  }

  if (ready && error) {
    return retainScene(<LoadFailureView message={error} onRetry={() => void reload()} />);
  }

  if (period === "YEAR") {
    if (active && annualReport.fatalError !== null) throw annualReport.fatalError;
    if (annualReport.ruleFailure !== null) {
      return retainScene(
        <AnnualReportRuleFailure
          failure={annualReport.ruleFailure}
          onBackToMonth={() => changePeriod("MONTH")}
          onMoveYear={moveYear}
          onRetry={annualReport.retry}
          year={year}
        />,
      );
    }
    if (annualReport.error) {
      return retainScene(
        <LoadFailureView
          message={annualReport.error}
          onRetry={annualReport.retry}
          title="Jahresauswertung nicht verfügbar"
        />,
      );
    }
    const visibleReport = annualReport.report ?? annualReport.coreReport;
    if (!ready || visibleReport === null)
      return retainScene(
        <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
          <AnalysisYearHeader
            year={year}
            onPrevious={() => moveYear(-1)}
            onNext={() => moveYear(1)}
            onOpenMonth={() => changePeriod("MONTH")}
          />
          <LoadingView label="Jahresauswertung wird berechnet …" />
        </View>,
      );
    return retainScene(
      <AnnualReportScreen
        exportControl={<ReportExportButton period={String(year)} />}
        report={visibleReport}
        pending={annualReport.report === null}
        testMonths={testMonths}
        onBackToMonth={() => changePeriod("MONTH")}
        onMoveYear={moveYear}
      />,
    );
  }

  return retainScene(
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
      <AnalysisMonthTransition
        month={month}
        available={ready && profile !== null && monthlyData !== null && calculationMonth === month}
        ready={
          ready &&
          profile !== null &&
          monthlyData !== null &&
          calculationMonth === month &&
          (!monthlyData.complianceShifts.ok ||
            compliance !== null ||
            monthlyCompliance.error !== null) &&
          (testMonths.includes(month) || salaryPayments.status !== "loading")
        }
        header={(visibleMonth) => (
          <AnalysisMonthHeader
            label={formatMonthRangeLabel(visibleMonth)}
            onOpenYear={() => changePeriod("YEAR")}
            onNext={() => moveMonth(1)}
            onPrevious={() => moveMonth(-1)}
          />
        )}
      >
        {!ready || profile === null || monthlyData === null || calculationMonth !== month ? (
          <LoadingView />
        ) : (
          <ReportScrollView>
            <ReportPeriodContent>
              {testMonths.includes(month) ? <ReportTestBadge /> : null}
              {checkPreferences.enabled === false ? (
                <AnalysisCoverageNote message={PLANNING_HIDDEN_NOTICE} />
              ) : null}
              {checkPreferences.error ? (
                <AnalysisCoverageNote message={checkPreferences.error} />
              ) : null}
              {checkPreferences.enabled === null && !checkPreferences.error ? (
                <AnalysisCoverageNote message="Prüfung wird geladen …" />
              ) : null}

              <MonthOverview
                month={month}
                data={monthlyData}
                profile={profile}
                annualPayments={annualSalary.payments}
                salaryLoading={!testMonths.includes(month) && salaryPayments.status === "loading"}
                salaryError={testMonths.includes(month) ? null : salaryPayments.error}
                compliance={compliance}
                checkError={monthlyCompliance.error}
                showPlanning={checkPreferences.enabled !== false}
              />

              <AnalysisViewControls />
              <ReportExportButton period={month} />
            </ReportPeriodContent>
          </ReportScrollView>
        )}
      </AnalysisMonthTransition>
    </View>,
  );
}

export function AssessmentSummaryCard({
  compliance: sourceCompliance,
  showPlanning = true,
  shifts,
  expanded,
  onToggle,
}: {
  readonly compliance: MonthlyComplianceResult;
  readonly showPlanning?: boolean;
  readonly shifts: readonly ShiftEntry[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const palette = usePalette();
  const compliance = selectVisibleCompliance(sourceCompliance, showPlanning);
  const messageCount = compliance.criticalCount + compliance.warningCount + compliance.infoCount;
  const limited = (compliance.prerequisiteCount ?? 0) > 0;
  const clear = messageCount === 0 && !limited;
  const accent = clear
    ? palette.success
    : compliance.criticalCount > 0
      ? palette.danger
      : compliance.warningCount > 0
        ? palette.warning
        : palette.info;

  return (
    <ExpandableHighlightCard
      accent={accent}
      countBadge={!messageCount && limited ? undefined : messageCount}
      expanded={expanded}
      icon={
        clear
          ? "shield-checkmark-outline"
          : messageCount
            ? "warning-outline"
            : "information-circle-outline"
      }
      onToggle={onToggle}
      title="Prüfung"
      value={
        !messageCount && limited
          ? "Prüfung eingeschränkt"
          : messageCount === 1
            ? "Meldung"
            : "Meldungen"
      }
    >
      <ComplianceDetails
        compliance={sourceCompliance}
        showPlanning={showPlanning}
        embedded
        shifts={shifts}
      />
    </ExpandableHighlightCard>
  );
}
