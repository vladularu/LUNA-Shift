import { Pressable, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { SHIFT_PRESET_COLOR_PAIRS } from "@/theme/shift-colors";
import { RADII, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";

export function ShiftColorSchemePicker({
  pastelColors,
  disabled,
  onChange,
}: {
  readonly pastelColors: boolean;
  readonly disabled: boolean;
  readonly onChange: (pastelColors: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Farbschema für Dienste">
      {[
        { id: "vivid", label: "Kräftige Farben", value: false },
        { id: "pastel", label: "Pastellfarben", value: true },
      ].map(({ id, label, value }, index) => {
        const selected = value === pastelColors;
        return (
          <View key={id}>
            {index > 0 ? (
              <View
                style={{
                  height: 1,
                  marginHorizontal: SPACING.lg,
                  backgroundColor: palette.separator,
                }}
              />
            ) : null}
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => {
                if (!selected) onChange(value);
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: SPACING.lg,
                paddingVertical: SPACING.md,
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.md,
                backgroundColor: "transparent",
                opacity: disabled
                  ? SELECTION_METRICS.disabledOpacity
                  : pressed
                    ? SELECTION_METRICS.pressedOpacity
                    : 1,
              })}
            >
              <View
                testID={`shift-color-scheme-${id}-swatches`}
                accessible={false}
                style={{ flexDirection: "row", flexShrink: 0 }}
              >
                {[5, 4, 0].map((colorIndex, swatchIndex) => {
                  const pair = SHIFT_PRESET_COLOR_PAIRS[colorIndex];
                  return (
                    <View
                      key={colorIndex}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: RADII.pill,
                        marginLeft: swatchIndex > 0 ? -5 : 0,
                        backgroundColor: value ? pair.soft : pair.main,
                      }}
                    />
                  );
                })}
              </View>
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{ ...TYPOGRAPHY.body, color: palette.text, flex: 1 }}
              >
                {label}
              </Text>
              <View
                testID={`shift-color-scheme-${id}-indicator`}
                accessible={false}
                style={{
                  width: 18,
                  height: 18,
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
