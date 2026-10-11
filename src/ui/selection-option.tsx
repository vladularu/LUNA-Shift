import type { StyleProp, ViewStyle } from "react-native";
import { Pressable, View } from "react-native";

import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";

type SelectionOptionProps = {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly caption?: string;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
};

export function SelectionChip({
  label,
  selected,
  onPress,
  caption,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
}: SelectionOptionProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: SELECTION_METRICS.optionHeight,
          justifyContent: "center",
          paddingVertical: SPACING.sm,
          paddingHorizontal: SPACING.md,
          gap: SPACING.xxs,
          borderRadius: SELECTION_METRICS.optionRadius,
          borderCurve: CORNER_CURVE,
          borderWidth: 1,
          borderColor: selected ? palette.selectionActiveBorder : palette.border,
          backgroundColor: selected ? palette.selectionTrack : palette.surface,
          opacity: disabled
            ? SELECTION_METRICS.disabledOpacity
            : pressed
              ? SELECTION_METRICS.pressedOpacity
              : 1,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.xxs }}>
        <Ionicons
          name="checkmark"
          color={palette.text}
          size={SELECTION_METRICS.iconSize}
          accessible={false}
          style={{ opacity: selected ? 1 : 0 }}
        />
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            ...TYPOGRAPHY.label,
            flexShrink: 1,
            color: selected ? palette.text : palette.textSecondary,
          }}
        >
          {label}
        </Text>
      </View>
      {caption ? (
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}
        >
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function SelectionRow({
  label,
  selected,
  onPress,
  caption,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
  separator = false,
  navigation = false,
}: SelectionOptionProps & { readonly separator?: boolean; readonly navigation?: boolean }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: SELECTION_METRICS.optionHeight,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: SPACING.lg,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          borderBottomWidth: separator ? 1 : 0,
          borderBottomColor: palette.separator,
          backgroundColor: selected ? palette.selectionTrack : "transparent",
          opacity: disabled
            ? SELECTION_METRICS.disabledOpacity
            : pressed
              ? SELECTION_METRICS.pressedOpacity
              : 1,
        },
        style,
      ]}
    >
      <View style={{ flex: 1, minWidth: 0, gap: SPACING.xxs }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ ...(selected ? TYPOGRAPHY.bodyStrong : TYPOGRAPHY.body), color: palette.text }}
        >
          {label}
        </Text>
        {caption ? (
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}
          >
            {caption}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name="checkmark"
        size={SELECTION_METRICS.iconSize}
        color={palette.text}
        accessible={false}
        style={{ opacity: selected ? 1 : 0 }}
      />
      {navigation ? (
        <Ionicons
          name="chevron-forward"
          size={SELECTION_METRICS.iconSize}
          color={palette.textMuted}
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
}
