import { SelectionControl } from "@/ui/selection-control";
import { SelectionRow } from "@/ui/selection-option";
import { Text } from "@/ui/text";

import { View, useWindowDimensions } from "react-native";

import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, RADII, SCREEN_LAYOUT, SPACING, SELECTION_METRICS } from "@/theme/tokens";
import { selectionFeedback } from "@/ui/haptics";

export function TariffQuestion({
  title,
  caption,
  options,
  value,
  onChange,
}: {
  readonly title: string;
  readonly caption: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= SCREEN_LAYOUT.headerAccessoryStackFontScale;

  return (
    <View style={{ gap: SPACING.md }}>
      <View style={{ gap: SPACING.xxs }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
        >
          {title}
        </Text>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
        >
          {caption}
        </Text>
      </View>
      {options.length <= SELECTION_METRICS.maxInlineOptions &&
      options.every((option) => option.label.length <= SELECTION_METRICS.inlineLabelLimit) ? (
        <SelectionControl
          accessibilityLabel={title}
          items={options.map((option) => ({
            ...option,
            accessibilityLabel: `${title}: ${option.label}`,
          }))}
          value={value}
          stacked={stacked}
          onChange={(next) => {
            onChange(next);
            selectionFeedback();
          }}
        />
      ) : (
        <View
          accessibilityLabel={title}
          accessibilityRole="radiogroup"
          style={{
            borderRadius: RADII.control,
            borderCurve: CORNER_CURVE,
            overflow: "hidden",
            backgroundColor: palette.surface,
          }}
        >
          {options.map((option) => (
            <SelectionRow
              key={option.value}
              label={option.label}
              accessibilityLabel={`${title}: ${option.label}`}
              selected={option.value === value}
              separator
              onPress={() => {
                onChange(option.value);
                selectionFeedback();
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
