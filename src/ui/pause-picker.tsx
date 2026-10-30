import { useMemo, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { MOTION } from "@/theme/motion";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, SurfaceCard } from "./design-system";
import { PAUSE_OPTIONS, PauseWheel } from "./pause-wheel";
import { Text } from "./text";

export function PausePicker({
  value,
  onChange,
  embedded = false,
  accessibilityLabel = "Pause",
  testID = "pause",
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly embedded?: boolean;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}) {
  const palette = usePalette();
  const minutes = Number(value) || 0;
  const [expanded, setExpanded] = useState(false);
  const [exactOption, setExactOption] = useState<number | null>(null);
  const options = useMemo(
    () =>
      exactOption === null ? PAUSE_OPTIONS : [...PAUSE_OPTIONS, exactOption].sort((a, b) => a - b),
    [exactOption],
  );
  const content = (
    <>
      <Pressable
        accessibilityHint={expanded ? "Klappt die Auswahl ein" : "Öffnet die Pausenauswahl"}
        accessibilityLabel={`${accessibilityLabel}: ${minutes} Minuten`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          Keyboard.dismiss();
          if (!expanded)
            setExactOption(PAUSE_OPTIONS.some((option) => option === minutes) ? null : minutes);
          setExpanded(!expanded);
        }}
        testID={`${testID}-row`}
        style={({ pressed }) => ({
          minHeight: 56,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: SPACING.md,
          backgroundColor: pressed ? palette.surfaceMuted : "transparent",
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.xs,
        })}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
        >
          Pause
        </Text>
        <View
          style={{
            borderCurve: CORNER_CURVE,
            minHeight: 36,
            minWidth: 92,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: RADII.control,
            backgroundColor: palette.surfaceMuted,
            paddingHorizontal: SPACING.md,
          }}
        >
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ color: palette.text, fontVariant: ["tabular-nums"], ...TYPOGRAPHY.body }}
          >
            {minutes} Min.
          </Text>
        </View>
      </Pressable>
      {expanded ? (
        <>
          <CardSeparator />
          <Animated.View
            accessibilityLabel="Pausendauer auswählen"
            entering={FadeInDown.duration(MOTION.duration.fast).reduceMotion(MOTION.reduceMotion)}
            exiting={FadeOut.duration(MOTION.duration.instant).reduceMotion(MOTION.reduceMotion)}
            style={{ alignItems: "center", paddingVertical: SPACING.sm }}
            testID={`${testID}-popover`}
          >
            <PauseWheel
              value={minutes}
              options={options}
              onChange={(next) => onChange(String(next))}
              selectionTestID={`${testID}-selection`}
              testID={`${testID}-wheel`}
            />
          </Animated.View>
        </>
      ) : null}
    </>
  );
  return embedded ? <View>{content}</View> : <SurfaceCard>{content}</SurfaceCard>;
}
