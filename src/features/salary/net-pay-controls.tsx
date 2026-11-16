import { Text } from "@/ui/text";
import { Pressable, View } from "react-native";
import type { PropsWithChildren } from "react";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";
import { SelectionChip } from "@/ui/selection-option";
import Ionicons from "@/ui/icon";

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
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING.xs }}
      >
        {options.map((option) => (
          <SelectionChip
            key={String(option.value)}
            label={option.label}
            accessibilityLabel={`${label}: ${option.label}`}
            selected={value === option.value}
            disabled={disabled}
            onPress={() => onChange(option.value)}
          />
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
        borderRadius: RADII.control,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <View
        accessibilityElementsHidden
        style={{
          width: 24,
          height: 24,
          borderRadius: RADII.small,
          borderWidth: 1.5,
          borderColor: palette.text,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Ionicons name="checkmark" size={18} color={palette.text} /> : null}
      </View>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ flex: 1, color: palette.textMuted, ...TYPOGRAPHY.body }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
