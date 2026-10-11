import { Pressable, View, type SwitchProps } from "react-native";

import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SHADCN_METRICS } from "@/theme/tokens";

// Figma toggle: 44x24 track, 20px thumb, 2px inset. Its hit area stays 44px high.
export function Switch({
  value = false,
  disabled = false,
  onValueChange,
  onChange,
  style,
  testID,
  accessibilityLabel,
  accessibilityHint,
  accessible,
  accessibilityElementsHidden,
  importantForAccessibility,
  accessibilityState,
  hitSlop,
}: SwitchProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, checked: value, disabled }}
      accessible={accessible}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility={importantForAccessibility}
      disabled={disabled}
      hitSlop={hitSlop}
      pointerEvents={!onValueChange && !onChange ? "none" : "auto"}
      testID={testID}
      onPress={(event) => {
        const nextValue = !value;
        onValueChange?.(nextValue);
        onChange?.({
          ...event,
          nativeEvent: {
            ...event.nativeEvent,
            target: Number(event.nativeEvent.target),
            value: nextValue,
          },
        });
      }}
      style={[
        {
          minWidth: SHADCN_METRICS.switchWidth,
          minHeight: MINIMUM_TOUCH_TARGET,
          justifyContent: "center",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <View
        style={{
          width: SHADCN_METRICS.switchWidth,
          height: SHADCN_METRICS.switchHeight,
          padding: SHADCN_METRICS.switchInset,
          borderRadius: SHADCN_METRICS.switchHeight / 2,
          backgroundColor: value ? palette.accent : palette.surfaceMuted,
        }}
      >
        <View
          style={{
            width: SHADCN_METRICS.switchThumbSize,
            height: SHADCN_METRICS.switchThumbSize,
            borderRadius: SHADCN_METRICS.switchThumbSize / 2,
            backgroundColor: value ? palette.onAccent : palette.textMuted,
            marginLeft: value ? SHADCN_METRICS.switchThumbSize : 0,
          }}
        />
      </View>
    </Pressable>
  );
}
