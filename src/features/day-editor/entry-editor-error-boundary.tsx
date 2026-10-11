import { router, Stack, type ErrorBoundaryProps } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { SheetBackFooter } from "@/ui/sheet-back-footer";
import { Text } from "@/ui/text";

export function EntryEditorErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{
          gap: SPACING.lg,
          padding: SPACING.lg,
          paddingTop: Math.max(insets.top, SPACING.lg),
        }}
        style={{ flex: 1 }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
        >
          Editor konnte nicht geöffnet werden
        </Text>
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}>
          Versuche es erneut oder schließe den Editor. Falls der Fehler wieder auftritt, kannst du
          diese Fehlermeldung kopieren.
        </Text>
        <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.sm }}>
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>Fehlermeldung</Text>
          <Text
            selectable
            accessibilityRole="alert"
            style={{ color: palette.text, ...TYPOGRAPHY.small }}
          >
            {error.message}
          </Text>
        </SurfaceCard>
        <Pressable
          accessibilityRole="button"
          onPress={() => void retry()}
          style={({ pressed }) => ({
            minHeight: 48,
            padding: SPACING.md,
            alignItems: "center",
            justifyContent: "center",
            borderCurve: CORNER_CURVE,
            borderRadius: RADII.pill,
            backgroundColor: palette.surfaceRaised,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>Erneut versuchen</Text>
        </Pressable>
      </ScrollView>
      <View
        style={{
          paddingHorizontal: SPACING.md,
          paddingTop: SPACING.sm,
          paddingBottom: Math.max(insets.bottom, SPACING.md),
        }}
      >
        <SheetBackFooter
          icon="close"
          label="Schließen"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/");
          }}
        />
      </View>
    </View>
  );
}
