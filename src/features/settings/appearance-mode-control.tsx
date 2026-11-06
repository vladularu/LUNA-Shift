import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@/ui/icon";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { AppearanceMode } from "@/domain/appearance";
import { usePalette } from "@/theme/palette";
import { MOTION } from "@/theme/motion";
import { CORNER_CURVE, RADII, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { selectionFeedback } from "@/ui/haptics";

const MODES = [
  { id: "light", label: "Hell", icon: "sunny-outline", selectedIcon: "sunny" },
  { id: "dark", label: "Dunkel", icon: "moon-outline", selectedIcon: "moon" },
  { id: "system", label: "System", icon: "phone-portrait-outline", selectedIcon: "phone-portrait" },
] as const;

export function AppearanceModeControl({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: AppearanceMode;
  readonly onChange: (mode: AppearanceMode) => void;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  const index = MODES.findIndex((mode) => mode.id === value);
  const position = useSharedValue(index);
  const inset = SELECTION_METRICS.trackInset;
  const segmentWidth = Math.max(0, width - inset * 2) / MODES.length;
  useEffect(() => {
    position.set(
      withTiming(index, {
        duration: MOTION.duration.normal,
        easing: MOTION.easing.calm,
        reduceMotion: MOTION.reduceMotion,
      }),
    );
  }, [index, position]);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.get() * segmentWidth }],
  }));

  return (
    <View
      testID="appearance-mode-track"
      accessibilityRole="radiogroup"
      accessibilityLabel="Erscheinungsbild"
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={{
        flexDirection: "row",
        flexWrap: "nowrap",
        padding: inset,
        borderRadius: RADII.pill,
        borderCurve: CORNER_CURVE,
        backgroundColor: palette.selectionTrack,
        opacity: disabled ? SELECTION_METRICS.disabledOpacity : 1,
      }}
    >
      {width > 0 ? (
        <Animated.View
          testID="appearance-mode-active-surface"
          accessible={false}
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: inset,
              top: inset,
              bottom: inset,
              width: segmentWidth,
              borderRadius: RADII.pill,
              borderCurve: CORNER_CURVE,
              backgroundColor: palette.primary,
            },
            indicatorStyle,
          ]}
        />
      ) : null}
      {MODES.map((mode) => {
        const selected = mode.id === value;
        const foreground = selected ? palette.onPrimary : palette.textSecondary;
        return (
          <Pressable
            key={mode.id}
            accessibilityRole="radio"
            accessibilityLabel={mode.label}
            accessibilityHint={
              mode.id === "system" ? "Folgt der Darstellung deines Geräts" : undefined
            }
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (selected) return;
              selectionFeedback();
              onChange(mode.id);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              minHeight: SELECTION_METRICS.optionHeight,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: SPACING.xs,
              paddingHorizontal: SPACING.sm,
              paddingVertical: SPACING.sm,
              borderRadius: RADII.pill,
              backgroundColor: selected && width === 0 ? palette.primary : "transparent",
              opacity: pressed ? SELECTION_METRICS.pressedOpacity : 1,
            })}
          >
            <Ionicons
              name={selected ? mode.selectedIcon : mode.icon}
              size={SELECTION_METRICS.iconSize}
              color={foreground}
              accessible={false}
            />
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={{
                ...(selected ? TYPOGRAPHY.bodyStrong : TYPOGRAPHY.body),
                color: foreground,
                flexShrink: 1,
                textAlign: "center",
              }}
            >
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
