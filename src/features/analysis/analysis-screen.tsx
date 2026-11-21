import { ReportExportButton } from "@/features/report-export/report-export-button";
import { MonthPreparationBoundary, PreparationFailureView } from "./analysis-preparation-failure";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { AnalysisNetPayRow } from "./analysis-net-pay-row";
import { useAnalysisCommit, useAnalysisPerformance } from "./use-analysis-performance";
import { router, useIsFocused } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

import { usePflegeShiftProfile, usePflegeShiftStatus } from "@/application/pflegeshift-provider";
import { appResumeHref } from "@/navigation/app-resume-state";
import type { MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { currentMonth } from "@/engine/calendar";
import { AnalysisViewControls } from "./analysis-view-controls";
import { MonthOverview } from "./month-overview";
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
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { selectVisibleCompliance } from "./check-visibility";
import { complianceDetailsRoute, salaryRoute } from "@/navigation/routes";
import { useActiveMonthCoordinator } from "@/navigation/active-month";
import { usePalette } from "@/theme/palette";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ReportPeriodContent, ReportScrollView, ReportTestBadge } from "@/ui/report-layout";

import { ComplianceDetails } from "./compliance-details";
import { CHECK_TITLE } from "./check-copy";
import { AnalysisMonthTransition } from "./analysis-month-transition";
import { useAnalysisNavigation } from "./use-analysis-navigation";
import { ReportPeriodPager } from "@/ui/report-period-pager";
import {
  ReportScrollHeaderPage,
  ReportScrollHeaderPlaceholder,
  ReportScrollHeaderProvider,
} from "@/ui/report-scroll-header";
import { AnalysisScene } from "./analysis-scene";
import { AnalysisMonthDataProvider, useAnalysisMonthData } from "./analysis-month-data";
import { AnalysisSalaryInputsProvider } from "./analysis-salary-inputs";
export type AnalysisExpandedCard = "CHECK" | "PAY";
export { ComplianceDetails } from "./compliance-details";

const EMPTY_PAYMENTS: readonly AnnualSalaryPayment[] = Object.freeze([]);
type AnalysisHeaderState = {
  readonly month: string;
  readonly period: "MONTH" | "YEAR";
  readonly visibleMonth: string;
  readonly activeMonthCount?: number;
};

export function AnalysisScreen({
  initialExpandedCard = null,
}: {
  readonly initialExpandedCard?: AnalysisExpandedCard | null;
}) {
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
  const palette = usePalette();
  const { ready, error } = usePflegeShiftStatus();
  const isFocused = useIsFocused();
  const activeMonthCoordinator = useActiveMonthCoordinator();
  const navigation = useAnalysisNavigation(profile?.timeZone);
  const { month, period, routeMonth, selectMonth, changePeriod } = navigation;
  const [headerState, setHeaderState] = useState<AnalysisHeaderState | null>(null);
  const updateHeader = useCallback((next: AnalysisHeaderState) => {
    setHeaderState((previous) =>
      previous?.month === next.month &&
      previous.period === next.period &&
      previous.visibleMonth === next.visibleMonth &&
      previous.activeMonthCount === next.activeMonthCount
        ? previous
        : next,
    );
  }, []);
  const visibleHeader =
    headerState?.month === month && headerState.period === period ? headerState : null;
  useAnalysisPerformance(month, isFocused, period);
  useEffect(() => {
    if (initialExpandedCard) {
      const targetMonth =
        routeMonth ?? activeMonthCoordinator.analysisRequests.getMonth() ?? currentMonth();
      router.push(
        initialExpandedCard === "PAY"
          ? salaryRoute(targetMonth)
          : complianceDetailsRoute(targetMonth),
      );
    }
  }, [initialExpandedCard, routeMonth, activeMonthCoordinator]);
  return (
    <AnalysisScene focused={isFocused}>
      <AnalysisSalaryInputsProvider
        enabled={isFocused && period === "MONTH" && ready && error === null}
        profile={savedProfile}
      >
        <ReportScrollHeaderProvider>
          <ReportPeriodPager
            value={month}
            unit={period}
            enabled={isFocused}
            onChange={selectMonth}
            preparationRadius={period === "MONTH" ? 2 : 1}
            renderHeader={(pageMonth, move) =>
              period === "YEAR" ? (
                <AnalysisYearHeader
                  year={Number(pageMonth.slice(0, 4))}
                  activeMonthCount={visibleHeader?.activeMonthCount}
                  onPrevious={() => move(-1)}
                  onNext={() => move(1)}
                  onOpenMonth={() => changePeriod("MONTH")}
                />
              ) : (
                <AnalysisMonthHeader
                  label={formatMonthRangeLabel(visibleHeader?.visibleMonth ?? pageMonth)}
                  onOpenYear={() => changePeriod("YEAR")}
                  onPrevious={() => move(-1)}
                  onNext={() => move(1)}
                />
              )
            }
            renderPlaceholder={() => (
              <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
                <ReportScrollHeaderPlaceholder>
                  <AnalysisCoverageNote message="Auswertung wird vorbereitet …" />
                </ReportScrollHeaderPlaceholder>
              </View>
            )}
            preparePage={(pageMonth, active, distance, content) => (
              <MonthPreparationBoundary key={period} month={pageMonth}>
                <AnalysisMonthDataProvider
                  month={pageMonth}
                  active={active}
                  distance={distance}
                  // Native swiping may reveal a distant page before selection commits.
                  // Its placeholder stays visible without starting more distant work.
                  enabled={period === "MONTH" && Math.abs(distance) <= 2}
                >
                  <ReportScrollHeaderPage active={active}>{content}</ReportScrollHeaderPage>
                </AnalysisMonthDataProvider>
              </MonthPreparationBoundary>
            )}
            renderPage={(pageMonth, move, active) => (
              <AnalysisPage
                month={pageMonth}
                period={period}
                move={move}
                active={active}
                changePeriod={changePeriod}
                onHeaderChange={updateHeader}
              />
            )}
          />
        </ReportScrollHeaderProvider>
      </AnalysisSalaryInputsProvider>
    </AnalysisScene>
  );
}

function AnalysisPage({
  month,
  period,
  move,
  active,
  changePeriod,
  onHeaderChange,
}: {
  readonly month: string;
  readonly period: "MONTH" | "YEAR";
  readonly move: (delta: number) => void;
  readonly active: boolean;
  readonly changePeriod: (period: "MONTH" | "YEAR") => void;
  readonly onHeaderChange: (state: AnalysisHeaderState) => void;
}) {
  const year = Number(month.slice(0, 4));
  const moveYear = move;
  const palette = usePalette();
  const isFocused = useIsFocused();
  const checkPreferences = useCheckPreferences();
  const {
    error,
    ready,
    reload,
    profile,
    entries,
    tariffDecisions,
    workPatternSettings,
    testMonths,
    ruleResolver,
    salaryPayments,
    payment,
    salaryRequest,
    salary,
    monthlyData,
    monthlyCompliance,
  } = useAnalysisMonthData();
  const calculationMonth = month;
  const paymentLoadError = payment.ready ? null : payment.error;
  const salarySettled =
    testMonths.includes(month) ||
    Boolean(paymentLoadError ?? salaryPayments.error ?? salary.error) ||
    (salaryPayments.status === "ready" &&
      payment.ready &&
      salaryRequest !== null &&
      salary.result !== null &&
      !salary.pending);
  const compliance = monthlyCompliance.result;
  useAnalysisCommit(
    month,
    active,
    (ready ? 1 : 0) |
      (monthlyData !== null ? 2 : 0) |
      (compliance !== null || monthlyCompliance.error !== null ? 4 : 0) |
      (salaryPayments.status !== "loading" ? 8 : 0) |
      (!salary.pending && salaryRequest !== null ? 16 : 0) |
      (checkPreferences.enabled !== null || checkPreferences.error ? 32 : 0),
    isFocused && period === "MONTH",
  );
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
    enabled: ready && !error && period === "YEAR" && annualInputs !== null,
    active: active && isFocused,
    entries: annualInputs?.ok ? annualInputs.value.entries : entries,
    profile,
    ruleResolver,
    tariffDecisions: annualInputs?.ok ? annualInputs.value.tariffDecisions : tariffDecisions,
    workPatternSettings,
    year,
    testMonths,
  });
  const activeMonthCount =
    annualReport.ruleFailure !== null
      ? 0
      : (annualReport.report ?? annualReport.coreReport)?.activeMonthCount;
  useLayoutEffect(() => {
    if (!active) return;
    if (period === "YEAR") {
      onHeaderChange({ month, period, visibleMonth: month, activeMonthCount });
    } else if (ready && error) {
      onHeaderChange({ month, period, visibleMonth: month });
    }
  }, [active, activeMonthCount, error, month, onHeaderChange, period, ready]);
  const updateVisibleMonth = useCallback(
    (visibleMonth: string) => {
      if (active && period === "MONTH") onHeaderChange({ month, period, visibleMonth });
    },
    [active, month, onHeaderChange, period],
  );

  function retainScene(content: ReactNode) {
    return <AnalysisScene focused={isFocused}>{content}</AnalysisScene>;
  }

  if (ready && error) {
    return retainScene(
      <ReportScrollHeaderPlaceholder>
        <LoadFailureView message={error} onRetry={() => void reload()} />
      </ReportScrollHeaderPlaceholder>,
    );
  }

  if (period === "YEAR") {
    if (active && annualReport.fatalError !== null)
      return retainScene(
        <PreparationFailureView
          month={month}
          annual
          error={annualReport.fatalError}
          retry={annualReport.retry}
        />,
      );
    if (annualReport.ruleFailure !== null) {
      return retainScene(
        <AnnualReportRuleFailure
          showHeader={false}
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
        <ReportScrollHeaderPlaceholder>
          <LoadFailureView
            message={annualReport.error}
            onRetry={annualReport.retry}
            title="Jahresauswertung nicht verfügbar"
          />
        </ReportScrollHeaderPlaceholder>,
      );
    }
    const visibleReport = annualReport.report ?? annualReport.coreReport;
    if (!ready || visibleReport === null)
      return retainScene(
        <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
          <ReportScrollHeaderPlaceholder>
            <LoadingView label="Jahresauswertung wird berechnet …" />
          </ReportScrollHeaderPlaceholder>
        </View>,
      );
    return retainScene(
      <AnnualReportScreen
        showHeader={false}
        resumeKey={active ? appResumeHref("/analysis", { month, period }) : null}
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
        available={
          ready &&
          profile !== null &&
          monthlyData !== null &&
          calculationMonth === month &&
          salarySettled
        }
        ready={
          ready &&
          profile !== null &&
          monthlyData !== null &&
          calculationMonth === month &&
          salarySettled &&
          (!monthlyData.complianceShifts.ok ||
            compliance !== null ||
            monthlyCompliance.error !== null) &&
          (testMonths.includes(month) || salaryPayments.status !== "loading")
        }
        onVisibleMonthChange={updateVisibleMonth}
      >
        {!ready ||
        profile === null ||
        monthlyData === null ||
        calculationMonth !== month ||
        !salarySettled ? (
          <ReportScrollHeaderPlaceholder>
            <LoadingView />
          </ReportScrollHeaderPlaceholder>
        ) : (
          <ReportScrollView
            resumeKey={active ? appResumeHref("/analysis", { month, period }) : null}
          >
            <ReportPeriodContent>
              {testMonths.includes(month) ? <ReportTestBadge /> : null}
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
                projection={testMonths.includes(month) ? undefined : salary.result?.projection}
                projectionPending={
                  !testMonths.includes(month) && (!payment.ready || salary.pending)
                }
                annualPayments={
                  salary.annual?.payments ?? salaryPayments.annualPayments ?? EMPTY_PAYMENTS
                }
                annualIssue={salary.annual?.issue}
                additionalRecurringGrossCents={
                  testMonths.includes(month)
                    ? 0
                    : (salaryPayments.saved?.settings.automation?.additionalRecurringGrossCents ??
                      0)
                }
                salaryLoading={
                  !testMonths.includes(month) &&
                  (salaryPayments.status === "loading" || !payment.ready || salary.pending)
                }
                salaryError={
                  testMonths.includes(month)
                    ? null
                    : (paymentLoadError ?? salaryPayments.error ?? salary.error)
                }
                netPay={
                  <AnalysisNetPayRow
                    month={month}
                    model={{
                      blocked: testMonths.includes(month),
                      status:
                        paymentLoadError || salary.error
                          ? "error"
                          : !payment.ready
                            ? "loading"
                            : salaryPayments.status,
                      error: paymentLoadError ?? salaryPayments.error ?? salary.error,
                      forecast: salary.result?.forecast ?? null,
                      pending: !payment.ready || salary.pending,
                    }}
                  />
                }
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
  timeZone = "Europe/Berlin",
  expanded,
  onToggle,
}: {
  readonly compliance: MonthlyComplianceResult;
  readonly showPlanning?: boolean;
  readonly shifts: readonly ShiftEntry[];
  readonly timeZone?: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const palette = usePalette();
  const compliance = selectVisibleCompliance(sourceCompliance, showPlanning);
  const messageCount = compliance.criticalCount + compliance.warningCount + compliance.infoCount;
  const limited = (compliance.prerequisiteCount ?? 0) > 0 || (compliance.scopeCount ?? 0) > 0;
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
      title={CHECK_TITLE}
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
        timeZone={timeZone}
      />
    </ExpandableHighlightCard>
  );
}
