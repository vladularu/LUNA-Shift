import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewProps,
} from "react-native";

import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";

export function SheetBackFooter({
  accessibilityLabel,
  busy = false,
  disabled = false,
  icon = "chevron-back",
  label = "Zurück",
  onLayout,
  onPress,
}: {
  readonly accessibilityLabel?: string;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly icon?: "chevron-back" | "close";
  readonly label?: string;
  readonly onLayout?: ViewProps["onLayout"];
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  const blocked = disabled || busy;
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    let active = true;
    const update = (enabled: boolean) => {
      if (active) setReduceTransparency(enabled);
    };
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", update);
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then(update)
      .catch(() => update(true));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const nativeGlass =
    Platform.OS === "ios" &&
    isGlassEffectAPIAvailable() &&
    isLiquidGlassAvailable() &&
    !reduceTransparency;
  const Surface = nativeGlass ? GlassView : View;
  return (
    <Surface
      onLayout={onLayout}
      testID="back-footer-surface"
      {...(nativeGlass
        ? {
            colorScheme: palette.dark ? ("dark" as const) : ("light" as const),
            isInteractive: !blocked,
          }
        : {})}
      style={{
        borderCurve: CORNER_CURVE,
        borderRadius: RADII.pill,
        borderWidth: nativeGlass ? 0 : StyleSheet.hairlineWidth,
        borderColor: palette.separator,
        backgroundColor: nativeGlass
          ? "transparent"
          : reduceTransparency
            ? palette.surface
            : `${palette.surface}ed`,
      }}
    >
      <Pressable
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked, busy }}
        disabled={blocked}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 48,
          justifyContent: "center",
          paddingHorizontal: SPACING.xl * 2,
          paddingVertical: SPACING.sm,
          borderCurve: CORNER_CURVE,
          borderRadius: RADII.pill,
          backgroundColor: pressed ? `${palette.text}0a` : "transparent",
        })}
      >
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: SPACING.lg, opacity: blocked ? 0.45 : 1 }}
        >
          {busy ? (
            <ActivityIndicator color={palette.text} size="small" />
          ) : (
            <Ionicons accessibilityElementsHidden name={icon} size={20} color={palette.text} />
          )}
        </View>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            color: palette.text,
            ...TYPOGRAPHY.body,
            textAlign: "center",
            opacity: blocked ? 0.45 : 1,
          }}
        >
          {label}
        </Text>
      </Pressable>
    </Surface>
  );
}
