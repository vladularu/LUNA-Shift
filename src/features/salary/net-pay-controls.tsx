import { Text } from "@/ui/text";
import { Pressable, View } from "react-native";
import type { PropsWithChildren } from "react";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";

export function NetPayText({ children }: PropsWithChildren) {
  const palette = usePalette();
  return (
    <Text
      selectable
      maxFontSizeMultiplier={TEXT_MAX_SCALE}
      style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}
    >
      {children}
    </Text>
  );
}

export function NetPayChoice<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: SPACING.xs }}>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.textMuted, ...TYPOGRAPHY.label }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING.xs }}>
        {options.map((option) => (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${option.label}`}
            accessibilityState={{ selected: value === option.value, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              minHeight: CONTROL_HEIGHT.regular,
              padding: SPACING.sm,
              justifyContent: "center",
              borderRadius: RADII.control,
              borderWidth: value === option.value ? 2 : 1,
              borderColor: value === option.value ? palette.accent : palette.border,
              backgroundColor: value === option.value ? palette.surfaceMuted : palette.surface,
              opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{ color: palette.text, ...TYPOGRAPHY.body }}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function NetPayCheck({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        minHeight: CONTROL_HEIGHT.regular,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACING.sm,
        padding: SPACING.sm,
        borderWidth: 1,
        borderColor: checked ? palette.accent : palette.border,
        borderRadius: RADII.control,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text accessibilityElementsHidden style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}>
        {checked ? "☑" : "☐"}
      </Text>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ flex: 1, color: palette.text, ...TYPOGRAPHY.body }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
