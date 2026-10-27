import { useState } from "react";
import { router, Stack } from "expo-router";
import { View } from "react-native";
import { Text } from "@/ui/text";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import { useCheckPreferences } from "./check-preferences";
import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { formatMinutes } from "@/engine/working-time";
import { formatMonthTitle } from "@/engine/calendar";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { RuleResolutionError } from "@/rules/rule-resolver";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import { FEDERAL_STATE_LABELS } from "@/domain/types";
import { settingsEditorRoute } from "@/navigation/routes";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard, RowButton, SectionHeader, InlineNotice } from "@/ui/design-system";
import { ProfilePage } from "./profile-page";
import { targetDateText, targetWeeklyHoursText } from "./working-time-target-form-model";

export function WorkingTimeTargetOverview({
  snapshot,
  month,
  origin,
}: {
  readonly snapshot: WorkingTimeTargetSnapshot;
  readonly month: string;
  readonly origin?: string;
}) {
  const { profile, calculationProfile, refreshWorkingTimeTarget } = usePflegeShiftProfile();
  const { resolver } = useRuleCatalogRuntime();
  const palette = usePalette();
  const { retry: retryProtection, youthEnabled, error: youthError } = useCheckPreferences();
  const [expanded, setExpanded] = useState(false);
  if (!profile) return null;
  const inputProfile =
    calculationProfile ??
    createWorkingTimeCalculationProfile(
      profile,
      snapshot,
      [],
      "ready",
      [],
      youthEnabled ?? null,
      youthEnabled === null ? (youthError ? "error" : "loading") : "ready",
    );
  const periods =
    inputProfile.workingTimeTarget?.context?.periods.filter(
      (period) =>
        period.validFrom <= month + "-31" &&
        (period.validTo === null || period.validTo >= month + "-01"),
    ) ?? [];
  const hours = [...new Set(periods.map((period) => period.weeklyMinutes))];
  const states = [...new Set(periods.map((period) => period.federalState))];
  const employmentLabel =
    (hours.length > 1
      ? "Wochenstundenwechsel"
      : targetWeeklyHoursText(hours[0] ?? profile.weeklyMinutes) + " Std./Woche") +
    " · " +
    (states.length > 1
      ? "Arbeitsortwechsel"
      : FEDERAL_STATE_LABELS[states[0] ?? profile.federalState]);
  const model = periods[0]?.model;
  const modelLabel = periods.some(
    (period) => JSON.stringify(period.model) !== JSON.stringify(model),
  )
    ? "Arbeitszeitmodell wechselt im Monat"
    : model?.kind === "ROTATING_FIVE_IN_SEVEN"
      ? "Wechselnde Tage Mo–So" +
        (model.sevenDayShiftPlanConfirmed !== true ? " · aus deinem Profil" : "")
      : model?.kind === "FIXED_WEEK"
        ? "Feste Wochentage"
        : "Verteilung noch unbekannt";
  const calculation = (() => {
    try {
      return {
        value: calculateMonthlyWorkingTimeTarget(month, inputProfile, resolver),
        error: null,
      };
    } catch (error) {
      if (!(error instanceof WorkingTimeTargetError) && !(error instanceof RuleResolutionError))
        throw error;
      return { value: null, error: error.message };
    }
  })();
  const result = calculation.value;
  const trainingGuard = result?.notices.find((notice) => notice.code.startsWith("TRAINING_YOUTH_"));
  const projection = result?.adjustments.some((line) => line.status === "PROFILE_ESTIMATE");
  const forecastExplanation = [
    ...new Set(
      result?.notices
        .filter((notice) =>
          ["CONDITIONAL_ROSTER_FREE_FORECAST", "TARGET_RULE_FORECAST"].includes(notice.code),
        )
        .map((notice) => notice.message),
    ),
  ].join(" ");
  const unsupported = result?.notices.some((notice) =>
    ["TARIFF_UNSUPPORTED", "TARIFF_VERSION_UNREVIEWED"].includes(notice.code),
  );
  return (
    <ProfilePage
      title="Arbeitszeit"
      backLabel={
        origin === "analysis"
          ? "Zurück zur Auswertung"
          : origin === "settings"
            ? "Zurück zu Mehr"
            : "Zurück zum Arbeitsprofil"
      }
      onBack={() => router.back()}
    >
      <Stack.Screen
        options={{
          title: "Arbeitszeit",
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text },
          statusBarStyle: palette.dark ? "light" : "dark",
        }}
      />
      <SectionHeader
        title={formatMonthTitle(month)}
        caption="Automatische Prognose aus deiner Beschäftigung."
      />
      <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.sm }}>
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}>Sollarbeitszeit</Text>
        <Text
          accessibilityRole="header"
          style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
        >
          {result?.targetMinutes == null
            ? "Nicht verfügbar"
            : formatMinutes(result.targetMinutes) + " h"}
        </Text>
        {trainingGuard ? (
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
            {trainingGuard.message}
          </Text>
        ) : null}
        {trainingGuard?.code === "TRAINING_YOUTH_PREFERENCE_ERROR" ? (
          <RowButton title="Erneut versuchen" onPress={retryProtection} />
        ) : null}
        {result?.status === "PROVISIONAL" ? (
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
            {unsupported
              ? "Vorläufige Referenz · Sonderregeln für deinen Tarif noch nicht vollständig verfügbar."
              : "Prognose · aus Wochenstunden, Arbeitsort und Tarif."}
          </Text>
        ) : null}
      </SurfaceCard>
      {calculation.error ? (
        <>
          <InlineNotice message={calculation.error} />
          {inputProfile.workingTimeTarget?.status === "error" && refreshWorkingTimeTarget ? (
            <RowButton title="Erneut berechnen" onPress={refreshWorkingTimeTarget} />
          ) : null}
        </>
      ) : null}
      {result?.notices.some((notice) => notice.code === "HOLIDAY_REGION_UNKNOWN") ? (
        <RowButton
          title="Feiertagsregion ergänzen"
          subtitle="An deinem Arbeitsort gibt es unterschiedliche regionale Feiertage."
          subtitleBelow
          onPress={() => router.push(settingsEditorRoute("EMPLOYMENT"))}
        />
      ) : null}
      <SurfaceCard>
        <RowButton
          title="So wird die Sollzeit berechnet"
          onPress={() => setExpanded((value) => !value)}
        />
        {expanded && result ? (
          <View style={{ padding: SPACING.lg, gap: SPACING.sm }}>
            <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
              {employmentLabel + " · " + modelLabel}
            </Text>
            <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>
              Monatsbasis: {formatMinutes(result.baseMinutes)} h
            </Text>
            {result.adjustments.map((line) => (
              <View key={line.date + line.ruleId} style={{ gap: SPACING.xs }}>
                <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>
                  {targetDateText(line.date) + " · " + line.label}
                </Text>
                <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                  {line.status === "PENDING"
                    ? "Nicht eingerechnet · Berechnungsgrundlage fehlt"
                    : "−" + formatMinutes(line.minutes) + " h"}
                </Text>
              </View>
            ))}
            {projection || forecastExplanation ? (
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                {forecastExplanation ||
                  "Monatsprognose mit vertraglichen Referenzstunden. Eingetragene Dienste ändern diese Prognose nicht."}
              </Text>
            ) : null}
            {!trainingGuard && periods.some((period) => period.tariff.kind === "TVAL_COMMON") ? (
              <RowButton
                title="Arbeitsbereich auswählen"
                onPress={() => router.push(settingsEditorRoute("TARIFF"))}
              />
            ) : null}
            {result.roundingMinutes ? (
              <Text style={{ color: palette.textMuted }}>
                Minutenausgleich: {result.roundingMinutes}
              </Text>
            ) : null}
            <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
              Istzeit, Freizeitausgleich und Gehaltszuschläge werden getrennt berechnet.
            </Text>
            {result.notices.some((notice) =>
              [
                "WORK_MODEL_UNKNOWN",
                "EMPLOYMENT_REFERENCE_UNCONFIRMED",
                "FIXED_DISTRIBUTION_CHANGED",
              ].includes(notice.code),
            ) ? (
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                Für nicht dokumentierte Zeiträume oder Arbeitstage wird eine Referenz verwendet.
                Änderungen hinterlegst du in deinen vorhandenen Profileinstellungen mit „Gültig ab“.
              </Text>
            ) : null}
            {result.status === "UNAVAILABLE" && !trainingGuard ? (
              <RowButton
                title="Arbeitsprofil öffnen"
                onPress={() => router.push("/work-profile")}
              />
            ) : null}
          </View>
        ) : null}
      </SurfaceCard>
    </ProfilePage>
  );
}
