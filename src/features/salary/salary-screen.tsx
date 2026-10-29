import { Text } from "@/ui/text";
import { SpecialDutyPayCard } from "./special-duty-pay-card";
import { ReportExportButton } from "@/features/report-export/report-export-button";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable } from "react-native";
import { addMonths, formatMonthTitle } from "@/engine/calendar";
import { RuleComputationNotice } from "@/features/analysis/rule-computation";
import { dayEditorRoute, settingsEditorRoute } from "@/navigation/routes";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { useReportMonth } from "@/navigation/use-report-month";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";
import { SurfaceCard } from "@/ui/design-system";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ReportPeriodContent, ReportTestBadge } from "@/ui/report-layout";
import { NetPayAutomaticEntryCard } from "./net-pay-automatic-entry-card";
import { useSalaryReport } from "./use-salary-report";
import { salaryProfileCaption } from "./salary-composition";
import { SalaryMonthNavigator, SalaryPage } from "./salary-ui";

export function SalaryScreen() {
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const routeMonth = parsed.status === "valid" ? parsed.value : null;
  const { month, selectMonth } = useReportMonth(routeMonth);
  if (parsed.status === "invalid")
    return (
      <SalaryPage title="Gehalt" backLabel="Zurück zur Auswertung">
        <LoadFailureView
          title="Gehalt kann nicht geöffnet werden"
          message="Der Link enthält keinen gültigen Monat."
          actionLabel="Schließen"
          onRetry={() => router.back()}
        />
      </SalaryPage>
    );
  return (
    <SalaryMonthPage month={month} moveMonth={(delta) => selectMonth(addMonths(month, delta))} />
  );
}

function SalaryMonthPage({
  month,
  moveMonth,
}: {
  readonly month: string;
  readonly moveMonth: (delta: number) => void;
}) {
  const palette = usePalette();
  const { ready, error, reload, profile, calculation, retryRules, testMonths } =
    useSalaryReport(month);
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
    const specialDutyLines = pay.specialDutyBreakdowns ?? [];
    const specialDutiesOpen = specialDutyLines.some((line) => !line.complete);
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
              {specialDutiesOpen
                ? "Gehaltsprognose noch offen"
                : "Für diesen Monat nicht verfügbar"}
            </Text>
            <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>
              {specialDutiesOpen
                ? "Bei mindestens einer Bereitschaft sind noch Beträge offen. Öffne den jeweiligen Dienst unten und prüfe die Angaben."
                : (pay.specialDutyNotes?.join(" ") ?? "Für diesen Zeitraum fehlen Tarifdaten.")}
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
        <SpecialDutyPayCard
          lines={specialDutyLines}
          onOpenDuty={(line) => router.push(dayEditorRoute(line.date, "SHIFT", line.shiftId))}
        />
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
      backLabel="Zurück zur Auswertung"
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
          backgroundColor: palette.primaryAction,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.onPrimaryAction, ...TYPOGRAPHY.button }}
        >
          Gehalt einrichten
        </Text>
      </Pressable>
    </SurfaceCard>
  );
}
