import Ionicons from "@/ui/icon";
import { router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState, type ComponentProps } from "react";
import { Alert, Platform, View, useWindowDimensions } from "react-native";

import { AccountSummaryCard } from "@/features/account/account-summary-card";
import { PRODUCT_NAME } from "@/brand";
import {
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import {
  isDeveloperModeEnabled,
  setDeveloperMode,
} from "@/infrastructure/database/dev-tools-repository";
import { DEV_TOOLS_AVAILABLE } from "@/infrastructure/dev-tools-policy";
import { APP_RUNTIME_LABEL } from "@/infrastructure/app-version";
import { CalendarPerformanceControls } from "@/features/calendar/calendar-performance-controls";
import {
  localBackupRoute,
  settingsInfoRoute,
  settingsEditorRoute,
  tariffAssessmentRoute,
} from "@/navigation/routes";
import { usePalette } from "@/theme/palette";
import { calendarDesignRoute } from "@/navigation/calendar-design-route";
import { profileSalaryLabel, profileWorkLabel } from "./work-profile-summary";
import { currentMonth } from "@/engine/calendar";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { CardSeparator, RowButton, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { successFeedback } from "@/ui/haptics";
import { ScreenScrollView } from "@/ui/screen-layout";
import { TabRootHeader } from "@/ui/tab-root-header";
import { useThemeStatusBar } from "@/ui/use-theme-status-bar";

export function SettingsScreen() {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const subtitleBelow = fontScale >= 1.3;
  useThemeStatusBar();
  const db = useSQLiteContext();
  const { error, ready, reload } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { workPatternSettings } = usePflegeShiftTariff();
  const [developerMode, setDeveloperModeState] = useState(false);

  useEffect(() => {
    if (!DEV_TOOLS_AVAILABLE) return;
    let active = true;
    void isDeveloperModeEnabled(db).then(
      (enabled) => {
        if (active) setDeveloperModeState(enabled);
      },
      () => {
        if (active) setDeveloperModeState(false);
      },
    );
    return () => {
      active = false;
    };
  }, [db]);

  if (ready && error) return <LoadFailureView message={error} onRetry={() => void reload()} />;
  if (!ready || profile === null) return <LoadingView />;

  async function activateDeveloperMode() {
    if (developerMode) return;
    try {
      await setDeveloperMode(db, true);
      setDeveloperModeState(true);
      successFeedback();
      Alert.alert("Testlabor aktiviert", "Das interne Testlabor ist jetzt unter Mehr verfügbar.");
    } catch {
      Alert.alert("Aktivierung fehlgeschlagen", "Das Testlabor konnte nicht aktiviert werden.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
      <TabRootHeader surface="groupedBackground" title="Mehr" />
      <ScreenScrollView surface="groupedBackground">
        {Platform.OS === "ios" ? (
          <View style={{ gap: SPACING.sm }}>
            <SectionHeader title="LUNA Cloud" />
            <AccountSummaryCard />
          </View>
        ) : null}
        <View style={{ gap: SPACING.sm }}>
          <SectionHeader title="Arbeit" />
          <SurfaceCard>
            <RowButton
              title="Arbeitgeber"
              subtitle={profile.employerName || "Ergänzen"}
              subtitleBelow={subtitleBelow}
              leading={<SettingsIcon name="briefcase-outline" />}
              onPress={() => router.push(settingsEditorRoute("EMPLOYER", "settings"))}
            />
            <CardSeparator />
            <RowButton
              title="Arbeitszeit & Ort"
              subtitle={profileWorkLabel(profile)}
              subtitleBelow={subtitleBelow}
              leading={<SettingsIcon name="time-outline" />}
              onPress={() => router.push(settingsEditorRoute("WORK", "settings"))}
            />
            <CardSeparator />
            <RowButton
              title="Sollzeitangaben"
              subtitle="Arbeitszeitmodell & Gültigkeit"
              subtitleBelow={subtitleBelow}
              leading={<SettingsIcon name="calendar-outline" />}
              onPress={() =>
                router.push({ pathname: "/working-time-profile", params: { origin: "settings" } })
              }
            />
            <CardSeparator />
            <RowButton
              title="Tarif & Gehalt"
              subtitle={profileSalaryLabel(profile).split(" · ").slice(0, 3).join(" · ")}
              subtitleBelow={subtitleBelow}
              leading={<SettingsIcon name="document-text-outline" />}
              onPress={() => router.push(settingsEditorRoute("TARIFF", "settings"))}
            />
            {profile.tariff || profile.vkaETariff || profile.tvlKrTariff ? (
              <>
                <CardSeparator />
                <RowButton
                  title="Schichtmodell"
                  subtitle={
                    workPatternSettings.workplaceCoverage === "AROUND_THE_CLOCK"
                      ? "Durchgehend 24/7"
                      : workPatternSettings.workplaceCoverage === "NOT_AROUND_THE_CLOCK"
                        ? "Nicht durchgehend 24/7"
                        : "Noch nicht bestätigt"
                  }
                  subtitleBelow={subtitleBelow}
                  leading={<SettingsIcon name="repeat-outline" />}
                  onPress={() => router.push(tariffAssessmentRoute(currentMonth(profile.timeZone)))}
                />
              </>
            ) : null}
          </SurfaceCard>
        </View>
        <View style={{ gap: SPACING.sm }}>
          <SectionHeader title="Deine App" />
          <SurfaceCard>
            <RowButton
              subtitleBelow={subtitleBelow}
              leading={<SettingsIcon name="color-palette-outline" />}
              title="Kalender gestalten"
              onPress={() => router.push(calendarDesignRoute("settings"))}
            />
            <CardSeparator />
            <RowButton
              subtitleBelow={subtitleBelow}
              leading={<SettingsIcon name="shield-checkmark-outline" />}
              title="Prüfung & Hinweise"
              onPress={() => router.push("/check-settings")}
            />
          </SurfaceCard>
        </View>

        <CalendarPerformanceControls subtitleBelow={subtitleBelow} />
        {DEV_TOOLS_AVAILABLE ? (
          <View style={{ gap: SPACING.sm }}>
            <SectionHeader title="Intern" />
            <SurfaceCard>
              <RowButton
                subtitleBelow={subtitleBelow}
                leading={<SettingsIcon name="sparkles-outline" />}
                onPress={() => router.push({ pathname: "/onboarding", params: { preview: "1" } })}
                subtitle="Ausprobieren, ohne deine Daten zu ändern"
                title="Onboarding testen"
              />
              {developerMode ? (
                <>
                  <CardSeparator />
                  <RowButton
                    subtitleBelow={subtitleBelow}
                    leading={<SettingsIcon name="flask-outline" />}
                    onPress={() => router.push("/dev-tools")}
                    subtitle="Testdaten sicher erzeugen und zurücksetzen"
                    title="Testlabor"
                  />
                </>
              ) : null}
            </SurfaceCard>
          </View>
        ) : null}

        <View style={{ gap: SPACING.sm }}>
          <SectionHeader title="Daten & App" />
          <SurfaceCard>
            {Platform.OS === "ios" ? (
              <>
                <RowButton
                  subtitleBelow={subtitleBelow}
                  leading={<SettingsIcon name="archive-outline" />}
                  onPress={() => router.push(localBackupRoute())}
                  subtitle="Backup-Datei erstellen und sicher ablegen"
                  title="Datensicherung"
                />
                <CardSeparator />
              </>
            ) : null}
            <RowButton
              subtitleBelow={subtitleBelow}
              leading={<SettingsIcon name="phone-portrait-outline" />}
              onPress={() => router.push(settingsInfoRoute("STORAGE"))}
              subtitle="Deine Daten auf diesem Gerät"
              title="Lokale Datenspeicherung"
            />
            <CardSeparator />
            <RowButton
              subtitleBelow={subtitleBelow}
              leading={<SettingsIcon name="calculator-outline" />}
              onPress={() => router.push(settingsInfoRoute("CALCULATION"))}
              subtitle="Feiertage, Zuschläge und Arbeitszeit"
              title="Berechnungshinweise"
            />
            <CardSeparator />
            <RowButton
              subtitleBelow={subtitleBelow}
              accessibilityHint={
                DEV_TOOLS_AVAILABLE
                  ? "Fünf Sekunden gedrückt halten, um das interne Testlabor zu aktivieren."
                  : undefined
              }
              delayLongPress={DEV_TOOLS_AVAILABLE ? 5000 : undefined}
              leading={<SettingsIcon name="information-circle-outline" />}
              onLongPress={DEV_TOOLS_AVAILABLE ? () => void activateDeveloperMode() : undefined}
              onPress={() => router.push(settingsInfoRoute("ABOUT"))}
              subtitle={APP_RUNTIME_LABEL}
              title={`Über ${PRODUCT_NAME}`}
            />
          </SurfaceCard>
        </View>
      </ScreenScrollView>
    </View>
  );
}

function SettingsIcon({ name }: { readonly name: ComponentProps<typeof Ionicons>["name"] }) {
  const palette = usePalette();
  return (
    <View
      accessibilityElementsHidden
      style={{
        borderCurve: CORNER_CURVE,
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: RADII.small,
        backgroundColor: palette.primarySoft,
      }}
    >
      <Ionicons color={palette.primary} name={name} size={18} />
    </View>
  );
}
