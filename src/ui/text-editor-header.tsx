import { Pressable, StyleSheet, View } from "react-native";

import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";

export function TextEditorHeader({
  canConfirm,
  onCancel,
  onConfirm,
  testID,
  title,
}: {
  readonly canConfirm: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly testID?: string;
  readonly title: string;
}) {
  const palette = usePalette();

  return (
    <View style={styles.header} testID={testID}>
      <Pressable
        accessibilityLabel="Abbrechen"
        accessibilityRole="button"
        onPress={onCancel}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="close" size={24} color={palette.textSecondary} />
      </Pressable>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={[styles.title, { color: palette.text }]}
      >
        {title}
      </Text>
      <Pressable
        accessibilityLabel={`${title} übernehmen`}
        accessibilityRole="button"
        disabled={!canConfirm}
        onPress={onConfirm}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons
          name="checkmark"
          size={26}
          color={canConfirm ? palette.primary : palette.textMuted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  title: { flex: 1, textAlign: "center", ...TYPOGRAPHY.sectionTitle },
  action: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
