import { Pressable } from "react-native";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { SPACING, RADII, CONTROL_HEIGHT, CORNER_CURVE } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";

export function ReportExportAction({
  variant,
  busy,
  disabled,
  onPress,
}: {
  readonly variant: "button" | "icon";
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={variant === "icon" ? "Bericht exportieren" : undefined}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: variant === "icon" ? CONTROL_HEIGHT.compact : CONTROL_HEIGHT.regular,
        width: variant === "icon" ? CONTROL_HEIGHT.compact : undefined,
        justifyContent: "center",
        alignItems: "center",
        padding: SPACING.sm,
        borderRadius: variant === "icon" ? RADII.pill : RADII.control,
        borderWidth: variant === "icon" ? 1 : 0,
        borderColor: palette.separator,
        borderCurve: CORNER_CURVE,
        backgroundColor: variant === "icon" ? palette.surface : palette.surfaceMuted,
        opacity: disabled || pressed ? 0.5 : 1,
      })}
    >
      {variant === "icon" ? (
        <Ionicons
          name={busy ? "hourglass-outline" : "share-outline"}
          size={23}
          color={palette.text}
          accessibilityElementsHidden
        />
      ) : (
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.primary, ...TYPOGRAPHY.button }}
        >
          {busy ? "Bericht wird erstellt …" : "Bericht exportieren"}
        </Text>
      )}
    </Pressable>
  );
}
