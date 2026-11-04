import Ionicons from "@/ui/icon";
import { Pressable, useWindowDimensions } from "react-native";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, MINIMUM_TOUCH_TARGET, RADII } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";

export function PeriodArrow({
  accessibilityLabel,
  direction,
  onPress,
  alignTop = false,
}: {
  readonly accessibilityLabel: string;
  readonly direction: "back" | "forward";
  readonly onPress: () => void;
  readonly alignTop?: boolean;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const previous = direction === "back";
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        borderCurve: CORNER_CURVE,
        width: MINIMUM_TOUCH_TARGET,
        height: MINIMUM_TOUCH_TARGET,
        alignItems: "center",
        justifyContent: alignTop ? "flex-start" : "center",
        paddingTop: alignTop ? Math.max(0, (TYPOGRAPHY.body.lineHeight * fontScale - 20) / 2) : 0,
        borderRadius: RADII.control,
        backgroundColor: pressed ? palette.primarySoft : "transparent",
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Ionicons
        color={palette.textSecondary}
        name={previous ? "chevron-back" : "chevron-forward"}
        size={20}
      />
    </Pressable>
  );
}
