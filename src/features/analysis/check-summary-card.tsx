import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { View } from "react-native";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { SPACING } from "@/theme/tokens";

export function CheckClearStatus({
  title,
  limited = false,
}: {
  readonly title: string;
  readonly limited?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm }}>
      <Ionicons
        name={limited ? "information-circle-outline" : "checkmark-circle-outline"}
        size={19}
        color={limited ? palette.info : palette.success}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={{ flex: 1, minWidth: 0, gap: SPACING.xxs }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.text, ...TYPOGRAPHY.label }}
        >
          {title}
        </Text>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
        >
          {limited ? "Bisher keine Auffälligkeiten · Angaben fehlen noch" : "Keine Auffälligkeiten"}
        </Text>
      </View>
    </View>
  );
}

export function CheckPeriod({ period }: { readonly period: string }) {
  const p = usePalette();
  return (
    <Text style={{ color: p.textMuted, textAlign: "center", ...TYPOGRAPHY.caption }}>{period}</Text>
  );
}
