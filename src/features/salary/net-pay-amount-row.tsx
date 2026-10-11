import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { RowButton } from "@/ui/design-system";

export function NetPayAmountRow({
  label,
  value,
  onPress,
  expanded,
}: {
  readonly label: string;
  readonly value: string;
  readonly onPress?: () => void;
  readonly expanded?: boolean;
}) {
  const palette = usePalette();
  const description = `${label}: ${value}`;
  return (
    <View
      accessible={!onPress}
      accessibilityLabel={onPress ? undefined : description}
      style={{ marginHorizontal: -SPACING.lg }}
    >
      <RowButton
        title={label}
        accessibilityLabel={description}
        accessibilityHint={onPress ? "Details öffnen" : undefined}
        onPress={onPress}
        accessibilityState={expanded === undefined ? undefined : { expanded }}
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.sm }}>
            <Text
              selectable={!onPress}
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{
                color: palette.text,
                ...TYPOGRAPHY.bodyStrong,
                fontVariant: ["tabular-nums"],
              }}
            >
              {value}
            </Text>
            {onPress ? (
              <Ionicons
                accessibilityElementsHidden
                color={palette.textMuted}
                name={
                  expanded === undefined
                    ? "chevron-forward"
                    : expanded
                      ? "chevron-up"
                      : "chevron-down"
                }
                size={18}
              />
            ) : null}
          </View>
        }
      />
    </View>
  );
}
