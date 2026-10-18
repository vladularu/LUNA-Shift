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
            <SurfaceCard>
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
            <SectionHeader title="Planungshinweise" />
            <SurfaceCard>
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
                  Planungshinweise
                </Text>
                <LabeledSwitch
                  label="Planungshinweise"
                  value={enabled}
                  disabled={saving}
                  onValueChange={(value) => void save(value)}
                />
              </View>
              <View style={{ padding: SPACING.md, paddingTop: 0 }}>
                <InfoDisclosure
                  summary="Dienstfolgen, Nächte, Wochenenden – freiwillige Hinweise."
                  details="Planungshinweise sind keine festgestellten Gesetzesverstöße."
                  label="Über die Planungshinweise"
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
