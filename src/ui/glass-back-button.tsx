import { GlassView } from "expo-glass-effect";
import { Pressable, StyleSheet, View } from "react-native";

import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, MINIMUM_TOUCH_TARGET, RADII } from "@/theme/tokens";
import { useGlassAppearance } from "./glass-appearance";
import Ionicons from "./icon";

export function GlassBackButton({
  label = "Zurück",
  onPress,
  disabled = false,
  testID,
}: {
  readonly label?: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}) {
  const palette = usePalette();
  const { nativeGlass, reduceTransparency } = useGlassAppearance();
  const Surface = nativeGlass ? GlassView : View;
  return (
    <Surface
      testID={testID ? `${testID}-surface` : undefined}
      {...(nativeGlass
        ? {
            glassEffectStyle: "regular" as const,
            colorScheme: palette.dark ? ("dark" as const) : ("light" as const),
            isInteractive: !disabled,
          }
        : {})}
      style={{
        width: MINIMUM_TOUCH_TARGET,
        height: MINIMUM_TOUCH_TARGET,
        borderRadius: RADII.pill,
        borderCurve: CORNER_CURVE,
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
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => ({
          width: MINIMUM_TOUCH_TARGET,
          height: MINIMUM_TOUCH_TARGET,
          borderRadius: RADII.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? `${palette.text}0a` : "transparent",
          opacity: disabled ? 0.45 : 1,
        })}
      >
        <Ionicons name="chevron-back" size={24} color={palette.text} accessibilityElementsHidden />
      </Pressable>
    </Surface>
  );
}
