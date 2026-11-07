import { Text } from "@/ui/text";
import { router } from "expo-router";
import { View } from "react-native";

import { useCheckPreferences } from "./check-preferences";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { InlineNotice, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { LabeledSwitch } from "@/ui/labeled-switch";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { InfoDisclosure } from "@/ui/info-disclosure";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import {
  PLANNING_KIND_LABEL,
  PLANNING_SUBTITLE,
  PLANNING_TITLE,
} from "@/features/analysis/check-presentation";

export function CheckSettingsScreen() {
  const palette = usePalette();
  const { enabled, youthEnabled, error, saving, save, saveYouth, retry } = useCheckPreferences();

  return (
    <BackFooterLayout
      disabled={saving}
      label="Zurück zu Mehr"
      onPress={() => router.back()}
      style={{ backgroundColor: palette.groupedBackground }}
    >
      {(bottomPadding) =>
        enabled === null || youthEnabled === null ? (
          error ? (
            <LoadFailureView message={error} onRetry={retry} />
          ) : (
            <LoadingView label="Prüfung wird geladen …" />
          )
        ) : (
          <ScreenScrollView bottomPadding={bottomPadding} surface="groupedBackground">
            <InlineNotice message="Gesetzliche Hinweise bleiben immer sichtbar." />
            <SectionHeader title="Gesetzliche Prüfung" />
            <SurfaceCard testID="legal-check-settings-card">
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: SPACING.md,
                  padding: SPACING.md,
                }}
              >
                <Text
                  maxFontSizeMultiplier={TEXT_MAX_SCALE}
                  style={{ ...TYPOGRAPHY.body, color: palette.text, flex: 1 }}
                >
                  Prüfung für Jugendliche
                </Text>
                <LabeledSwitch
                  label="Prüfung für Jugendliche"
                  value={youthEnabled}
                  disabled={saving}
                  onValueChange={(value) => void saveYouth(value)}
                />
              </View>
              <View style={{ padding: SPACING.md, paddingTop: 0 }}>
                <InfoDisclosure
                  summary="Für 15–17-Jährige ohne Vollzeitschulpflicht."
                  details="Prüft die erfassten Dienstzeiten nach dem Jugendarbeitsschutzgesetz."
                  label="Über die Prüfung für Jugendliche"
                />
              </View>
            </SurfaceCard>
            <SectionHeader title={PLANNING_TITLE} />
            <SurfaceCard testID="planning-settings-card">
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: SPACING.md,
                  padding: SPACING.md,
                }}
              >
                <Text
                  maxFontSizeMultiplier={TEXT_MAX_SCALE}
                  style={{ ...TYPOGRAPHY.body, color: palette.text, flex: 1 }}
                >
                  {PLANNING_TITLE}
                </Text>
                <LabeledSwitch
                  label={PLANNING_TITLE}
                  value={enabled}
                  disabled={saving}
                  onValueChange={(value) => void save(value)}
                />
              </View>
              <View style={{ padding: SPACING.md, paddingTop: 0 }}>
                <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                  {PLANNING_KIND_LABEL}
                </Text>
                <InfoDisclosure
                  summary={PLANNING_SUBTITLE}
                  details="Arbeitswissenschaftliche Hinweise zur Schichtgestaltung. Eine Auffälligkeit ist für sich allein kein festgestellter Gesetzesverstoß."
                  label="Über Dienstfolgen & Erholung"
                />
              </View>
            </SurfaceCard>
            <Text
              accessibilityLiveRegion="polite"
              style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}
            >
              {error
                ? "Die bisherige Auswahl bleibt erhalten."
                : saving
                  ? "Wird gespeichert …"
                  : "Auswahl gespeichert."}
            </Text>
            {error ? <InlineNotice message={error} /> : null}
          </ScreenScrollView>
        )
      }
    </BackFooterLayout>
  );
}
