import { useState } from "react";
import { View } from "react-native";

import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { Text } from "@/ui/text";
import type { CalendarWidgetDiagnostics } from "./calendar-widget-diagnostics";
import { inspectCalendarWidget, reloadCalendarWidget } from "./native-calendar-widget";

export function CalendarWidgetDiagnosticsCard() {
  const palette = usePalette();
  const [result, setResult] = useState<CalendarWidgetDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadError, setReloadError] = useState(false);
  async function inspect(reload: boolean) {
    setBusy(true);
    setReloadError(false);
    try {
      if (reload) reloadCalendarWidget();
      setResult(await inspectCalendarWidget());
    } catch {
      setReloadError(true);
    } finally {
      setBusy(false);
    }
  }
  const lines = result
    ? [
        `Natives Modul: ${result.nativeAvailable ? "vorhanden" : "nicht verfügbar"}`,
        `Gemeinsamer Speicher: ${result.groupAvailable ? "erreichbar" : "nicht verfügbar"}`,
        `Timeline-Einträge: ${result.entryCount}`,
        `Aktueller Zustand: ${result.currentState === "ready" ? "bereit" : result.currentState === "setup" ? "Einrichtung" : result.currentState === "expired" ? "abgelaufen" : "kein aktueller Eintrag"}`,
        ...(result.entryCount > 0
          ? [
              `Datenformat: ${result.dataFormat === "calendar" ? "aktuelles Kalenderdesign" : "altes Kalenderdesign"}`,
            ]
          : []),
        ...(result.dataFormat === "calendar"
          ? [
              `Wochenraster: ${result.weekDayCount ?? 0} Tage`,
              `Monatsraster: ${result.monthDayCount ?? 0} Tage`,
              `Darstellung: ${result.themeMode === "light" ? "Hell" : result.themeMode === "dark" ? "Dunkel" : result.themeMode === "system" ? "System" : "nicht bekannt"}`,
              `Kalenderfoto: ${result.hasPhoto ? "übernommen" : "Standardhintergrund"}`,
            ]
          : []),
        ...(result.errorClass ? [`Fehlerklasse: ${result.errorClass}`] : []),
      ]
    : [];
  return (
    <View
      accessibilityLabel="Widget-Prüfung"
      style={{
        backgroundColor: palette.surface,
        borderCurve: CORNER_CURVE,
        borderRadius: RADII.control,
        padding: SPACING.lg,
        gap: SPACING.md,
      }}
    >
      <Text style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}>Widgets</Text>
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
        Prüft Modul, gemeinsamen Speicher und Timeline. Deine Dienste und Einstellungen bleiben
        erhalten.
      </Text>
      {lines.map((line) => (
        <Text key={line} style={{ color: palette.text, ...TYPOGRAPHY.label }}>
          {line}
        </Text>
      ))}
      {reloadError && (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
          Die Widget-Prüfung konnte nicht abgeschlossen werden.
        </Text>
      )}
      <PrimaryButton
        busy={busy}
        busyLabel="Widgets werden geprüft"
        disabled={busy}
        onPress={() => void inspect(false)}
      >
        Widgets prüfen
      </PrimaryButton>
      {result?.nativeAvailable && result.groupAvailable && result.entryCount > 0 && (
        <SecondaryButton disabled={busy} onPress={() => void inspect(true)}>
          Widgets neu laden
        </SecondaryButton>
      )}
    </View>
  );
}
