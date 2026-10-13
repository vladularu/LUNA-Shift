import { Text } from "@/ui/text";
import { ReportExportButton } from "@/features/report-export/report-export-button";
import { Temporal } from "@js-temporal/polyfill";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import { formatMonthTitle } from "@/engine/calendar";
import { RuleComputationNotice } from "@/features/analysis/rule-computation";
import { settingsEditorRoute } from "@/navigation/routes";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { useActiveMonthCoordinator } from "@/navigation/active-month";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";
import { SurfaceCard } from "@/ui/design-system";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { selectionFeedback } from "@/ui/haptics";
import { ReportPeriodContent, ReportTestBadge } from "@/ui/report-layout";
import { NetPayAutomaticEntryCard } from "./net-pay-automatic-entry-card";
import { useSalaryReport } from "./use-salary-report";
import { salaryProfileCaption } from "./salary-composition";
import { SalaryMonthNavigator, SalaryPage } from "./salary-ui";

export function SalaryScreen() {
  const palette = usePalette();
  const coordinator = useActiveMonthCoordinator();
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const routeMonth = parsed.status === "valid" ? parsed.value : null;
  const [month, setMonth] = useState(() => routeMonth ?? coordinator.getMonth());
  useEffect(() => {
    if (routeMonth !== null) {
      coordinator.setMonth(routeMonth);
      setMonth(routeMonth);
    }
  }, [coordinator, routeMonth]);
  useFocusEffect(
    useCallback(() => {
      const active = coordinator.getMonth();
      setMonth((current) => (current === active ? current : active));
    }, [coordinator]),
  );
  const { ready, error, reload, profile, calculation, retryRules, testMonths } = useSalaryReport(
    month,
    parsed.status !== "invalid",
  );
  function moveMonth(delta: number) {
    const next = Temporal.PlainDate.from(`${month}-01`)
      .add({ months: delta })
      .toString()
      .slice(0, 7);
    coordinator.setMonth(next);
    setMonth(next);
    selectionFeedback();
  }
  if (parsed.status === "invalid")
    return (
      <SalaryPage title="Gehalt">
        <LoadFailureView
          title="Gehalt kann nicht geöffnet werden"
          message="Der Link enthält keinen gültigen Monat."
          actionLabel="Schließen"
          onRetry={() => router.back()}
        />
      </SalaryPage>
    );
  const navigation = (
    <SalaryMonthNavigator
      label={formatMonthTitle(month)}
      onNext={() => moveMonth(1)}
      onPrevious={() => moveMonth(-1)}
    />
  );
  let content;
  if (ready && error) content = <LoadFailureView message={error} onRetry={() => void reload()} />;
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
    const { pay, monthShifts } = calculation.value;
    const manual = profile.tariff === null && profile.manualMonthlyGrossCents != null;
    const salaryReady = !!(
      profile.tariff ||
      profile.nursingTrainingTariff ||
      profile.vkaETariff ||
      profile.tvlKrTariff ||
      profile.tvUkNursingTariff ||
      profile.tvhKrTariff ||
      profile.tvalPflegeTariff ||
      manual
    );
    const caption = salaryProfileCaption(profile);
    content = (
      <ReportPeriodContent>
        {testMonths.includes(month) ? <ReportTestBadge /> : null}
        {!salaryReady ? (
          <SetupCard />
        ) : !pay.available ? (
          <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.xs }}>
            <Text style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text }}>
              Für diesen Monat nicht verfügbar
            </Text>
            <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>
              Für den gewählten Zeitraum liegt kein unterstützter Tarifstand vor.
            </Text>
          </SurfaceCard>
        ) : !manual && !monthShifts.length ? (
          <SurfaceCard style={{ padding: SPACING.md, gap: SPACING.xs }}>
            <Text style={{ ...TYPOGRAPHY.bodyStrong, color: palette.text }}>
              Noch keine Dienste in diesem Monat
            </Text>
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
              Grundentgelt und feste Zulagen sind bereits enthalten. Variable Zeitzuschläge
              erscheinen nach dem ersten Dienst.
            </Text>
          </SurfaceCard>
        ) : null}
        <NetPayAutomaticEntryCard
          key={month}
          month={month}
          caption={caption ?? undefined}
          showPremiumDetails={salaryReady && pay.available && !manual}
          blocked={testMonths.includes(month)}
          premiumCents={pay.available ? Math.round(pay.timePremiumAmount * 100) : undefined}
          proposedGrossCents={
            pay.available && pay.estimatedGrossAmount !== null
              ? Math.round(pay.estimatedGrossAmount * 100)
              : null
          }
        />
      </ReportPeriodContent>
    );
  }
  return (
    <SalaryPage
      title="Gehalt"
      action={<ReportExportButton key={month} period={month} variant="icon" />}
    >
      {navigation}
      {content}
    </SalaryPage>
  );
}
function SetupCard() {
  const palette = usePalette();
  return (
    <SurfaceCard style={{ gap: SPACING.md, padding: SPACING.lg }}>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.text, ...TYPOGRAPHY.screenTitle }}
      >
        Gehalt aktivieren
      </Text>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}
      >
        Wähle TVöD-P oder hinterlege dein Monatsbrutto.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(settingsEditorRoute("TARIFF"))}
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT.regular,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: RADII.control,
          borderCurve: CORNER_CURVE,
          backgroundColor: palette.accent,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.onAccent, ...TYPOGRAPHY.button }}
        >
          Gehalt einrichten
        </Text>
      </Pressable>
    </SurfaceCard>
  );
}
