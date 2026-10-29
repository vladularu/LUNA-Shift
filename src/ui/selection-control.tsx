import type { ComponentProps } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { usePalette } from "@/theme/palette";
import { MOTION } from "@/theme/motion";
import { CORNER_CURVE, RADII, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";

type SelectionItem<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly icon?: ComponentProps<typeof Ionicons>["name"];
  readonly selectedIcon?: ComponentProps<typeof Ionicons>["name"];
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
};

export type SelectionControlProps<T extends string = string> = {
  readonly items: readonly SelectionItem<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly stacked?: boolean;
  readonly density?: "regular" | "compact";
  readonly kind?: "setting" | "view";
  readonly accessibilityLabel?: string;
  readonly testID?: string;
};

export function SelectionControl<T extends string>({
  items,
  value,
  onChange,
  disabled = false,
  stacked = false,
  density = "regular",
  kind = "setting",
  accessibilityLabel,
  testID,
}: SelectionControlProps<T>) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const vertical =
    stacked ||
    fontScale > SELECTION_METRICS.stackFontScale ||
    (width < SELECTION_METRICS.narrowWidth && items.length > 2);
  const intrinsicWidth = kind === "view" && density === "compact";
  const optionRadius = RADII.control - SELECTION_METRICS.trackInset;
  return (
    <View
      accessibilityRole={kind === "setting" ? "radiogroup" : "tablist"}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={{
        flexDirection: vertical ? "column" : "row",
        gap: SELECTION_METRICS.trackInset,
        paddingHorizontal: SELECTION_METRICS.trackInset,
        paddingVertical: vertical ? SELECTION_METRICS.trackInset : 0,
        borderRadius: RADII.control,
        borderCurve: CORNER_CURVE,
        backgroundColor: palette.selectionTrack,
      }}
    >
      {items.map((item) => {
        const selected = item.value === value;
        const icon = selected ? (item.selectedIcon ?? item.icon) : item.icon;
        return (
          <Pressable
            key={item.value}
            accessibilityRole={kind === "setting" ? "radio" : "tab"}
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityHint={item.accessibilityHint}
            accessibilityState={
              kind === "setting" ? { checked: selected, disabled } : { selected, disabled }
            }
            disabled={disabled}
            onPress={() => onChange(item.value)}
            style={({ pressed }) => ({
              minHeight: SELECTION_METRICS.optionHeight,
              flexGrow: vertical ? undefined : 1,
              flexShrink: 1,
              flexBasis: vertical || intrinsicWidth ? "auto" : 0,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: SPACING.xs,
              paddingVertical: SPACING.sm,
              paddingHorizontal: density === "compact" ? SPACING.sm : SPACING.md,
              borderRadius: optionRadius,
              borderCurve: CORNER_CURVE,
              opacity: disabled
                ? SELECTION_METRICS.disabledOpacity
                : pressed
                  ? SELECTION_METRICS.pressedOpacity
                  : 1,
            })}
          >
            {selected ? (
              <Animated.View
                testID={`${testID ?? accessibilityLabel ?? "selection"}:active-surface`}
                entering={FadeIn.duration(MOTION.duration.fast).reduceMotion(MOTION.reduceMotion)}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: vertical ? 0 : SELECTION_METRICS.trackInset,
                  right: 0,
                  bottom: vertical ? 0 : SELECTION_METRICS.trackInset,
                  left: 0,
                  borderRadius: optionRadius,
                  borderCurve: CORNER_CURVE,
                  borderWidth: 1,
                  borderColor: palette.selectionActiveBorder,
                  backgroundColor: palette.selectionActiveSurface,
                }}
              />
            ) : null}
            {icon ? (
              <Ionicons
                name={icon}
                size={SELECTION_METRICS.iconSize}
                color={selected ? palette.text : palette.textSecondary}
                accessible={false}
              />
            ) : null}
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{
                ...(density === "compact"
                  ? TYPOGRAPHY.label
                  : selected
                    ? TYPOGRAPHY.bodyStrong
                    : TYPOGRAPHY.body),
                flexShrink: 1,
                textAlign: "center",
                color: selected ? palette.text : palette.textSecondary,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
