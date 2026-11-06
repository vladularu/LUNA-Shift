import { Pressable, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { RADII, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { CardSeparator } from "@/ui/design-system";

export function CalendarChoiceRows<T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T | null;
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
}) {
  const palette = usePalette();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option, index) => {
        const selected = value === option.value;
        return (
          <View key={option.value}>
            {index > 0 ? <CardSeparator /> : null}
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => {
                if (!selected) onChange(option.value);
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: SPACING.lg,
                paddingVertical: SPACING.md,
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.md,
                opacity: disabled
                  ? SELECTION_METRICS.disabledOpacity
                  : pressed
                    ? SELECTION_METRICS.pressedOpacity
                    : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{ ...TYPOGRAPHY.body, color: palette.text, flex: 1 }}
              >
                {option.label}
              </Text>
              <View
                accessible={false}
                style={{
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  borderRadius: RADII.pill,
                  borderWidth: selected ? 0 : 2,
                  borderColor: palette.textMuted,
                  backgroundColor: selected ? palette.text : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {selected ? (
                  <View
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: RADII.pill,
                      backgroundColor: palette.surface,
                    }}
                  />
                ) : null}
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
