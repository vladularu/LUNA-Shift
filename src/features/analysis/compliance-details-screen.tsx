import { restFindingKeys } from "@/engine/workplace-resolution";
import { WorkplacePanel } from "@/features/workplace/panel";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import Ionicons from "@/ui/icon";

import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { currentMonth, formatMonthTitle, monthRange } from "@/engine/calendar";
import { selectComplianceShifts } from "@/features/analysis/analysis-data";
import { captureRuleComputation, RuleComputationNotice } from "./rule-computation";
import { requireResolvedPackage } from "@/rules/rule-resolver";
import type { ShiftEntry } from "@/domain/types";
import { ComplianceDayList } from "./compliance-day-list";
import { useDeferredMonthlyCompliance } from "@/features/analysis/use-monthly-compliance";
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { selectVisibleCompliance } from "./check-visibility";
import { AnalysisCoverageNote } from "./analysis-coverage-note";
import { CheckPeriod } from "./check-summary-card";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { ReportScrollView } from "@/ui/report-layout";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import { Text } from "@/ui/text";
import { SecondaryButton } from "@/ui/form-controls";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { CHECK_TITLE } from "./check-copy";
import { checkPeriodLabel } from "./check-period-label";

const EMPTY_SHIFTS: readonly ShiftEntry[] = Object.freeze([]);

export function ComplianceDetailsScreen() {
  return (
    <BackFooterLayout
      footerTestID="compliance-back-footer"
      label="Zurück zur Auswertung"
      onPress={() => router.back()}
    >
      {(bottomPadding) => <ComplianceDetailsContent bottomPadding={bottomPadding} />}
    </BackFooterLayout>
  );
}

function ComplianceDetailsContent({ bottomPadding }: { readonly bottomPadding: number }) {
  const palette = usePalette();
  const preferences = useCheckPreferences();
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const { error, ready, reload } = usePflegeShiftStatus();
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
  const { entries } = usePflegeShiftEntries();
  const { resolver: ruleResolver } = useRuleCatalogRuntime();
  const parsedMonth = parseMonthRouteParam(params.month);
  const month =
    parsedMonth.status === "valid" ? parsedMonth.value : currentMonth(profile?.timeZone);
  const [retryRevision, setRetryRevision] = useState(0);
  const window = useMemo(() => {
    void retryRevision;
    if (!ready || error || !profile || parsedMonth.status !== "valid") return null;
    return captureRuleComputation(() => {
      requireResolvedPackage(ruleResolver.resolveHoliday(`${month}-01`));
      return selectComplianceShifts(entries, month, ruleResolver);
    });
  }, [entries, month, ruleResolver, retryRevision, ready, error, profile, parsedMonth.status]);
  const monthlyCompliance = useDeferredMonthlyCompliance({
    enabled: window?.ok === true,
    month,
    profile,
    ruleResolver,
    shifts: window?.ok ? window.value : EMPTY_SHIFTS,
  });
  const sourceCompliance = monthlyCompliance.result;
  const compliance =
    sourceCompliance === null
      ? null
      : selectVisibleCompliance(sourceCompliance, preferences.enabled !== false);

  if (parsedMonth.status !== "valid") {
    return (
      <LoadFailureView
        actionLabel="Schließen"
        message="Der Link zur Arbeitszeitprüfung enthält keinen gültigen Monat."
        onRetry={() => router.back()}
        title="Arbeitszeitprüfung kann nicht geöffnet werden"
      />
    );
  }
  if (ready && error) {
    return <LoadFailureView message={error} onRetry={() => void reload()} />;
  }
  if (window && !window.ok)
    return (
      <ReportScrollView bottomPadding={bottomPadding}>
        <CheckPeriod period={formatMonthTitle(month)} />
        <WorkplacePanel period={month} />
        <RuleComputationNotice
          failure={window}
          onRetry={() => setRetryRevision((value) => value + 1)}
          title="Arbeitszeitprüfung nicht verfügbar"
        />
      </ReportScrollView>
    );
  if (monthlyCompliance.error) {
    return (
      <ReportScrollView bottomPadding={bottomPadding}>
        <CheckPeriod period={formatMonthTitle(month)} />
        <WorkplacePanel period={month} />
        <AnalysisCoverageNote message={monthlyCompliance.error} />
        <SecondaryButton onPress={monthlyCompliance.retry}>
          Arbeitszeitprüfung erneut versuchen
        </SecondaryButton>
      </ReportScrollView>
    );
  }
  if (!ready || profile === null || compliance === null) return <LoadingView />;
  const { start, end } = monthRange(month);

  return (
    <ScreenScrollView
      surface="groupedBackground"
      bottomPadding={bottomPadding}
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      {preferences.error ? <AnalysisCoverageNote message={preferences.error} /> : null}
      {preferences.enabled === null && !preferences.error ? (
        <AnalysisCoverageNote message="Prüfung wird geladen …" />
      ) : null}
      <View style={{ gap: SPACING.sm }}>
        <Text accessibilityRole="header" style={{ ...TYPOGRAPHY.screenTitle, color: palette.text }}>
          {CHECK_TITLE}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.xs }}>
          <Ionicons
            name="calendar-outline"
            size={15}
            color={palette.textMuted}
            accessibilityElementsHidden
          />
          <Text style={{ flexShrink: 1, ...TYPOGRAPHY.small, color: palette.textMuted }}>
            {checkPeriodLabel(start, end)}
          </Text>
        </View>
      </View>
      <WorkplacePanel period={month} restKeys={restFindingKeys(compliance.issues)}>
        {(count) => (
          <ComplianceDayList
            hasWorkplaceFindings={count > 0}
            compliance={sourceCompliance!}
            showPlanning={preferences.enabled !== false}
            shifts={window?.ok ? window.value : EMPTY_SHIFTS}
            timeZone={profile.timeZone}
          />
        )}
      </WorkplacePanel>
    </ScreenScrollView>
  );
}
