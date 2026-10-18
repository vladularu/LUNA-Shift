import type { Ref } from "react";
import { View, useWindowDimensions, type TextInputProps } from "react-native";

import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { Text, TextInput } from "@/ui/text";

export function CompactInputRow({
  error,
  inputRef,
  keyboardType,
  label,
  maxLength,
  onChangeText,
  suffix,
  testID,
  value,
}: {
  readonly error?: string | null;
  readonly inputRef?: Ref<TextInput>;
  readonly keyboardType?: TextInputProps["keyboardType"];
  readonly label: string;
  readonly maxLength?: number;
  readonly onChangeText: (value: string) => void;
  readonly suffix?: string;
  readonly testID?: string;
  readonly value: string;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.6;

  return (
    <View>
      <View
        testID={testID}
        style={{
          minHeight: CONTROL_HEIGHT.large,
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "stretch" : "center",
          justifyContent: "space-between",
          gap: SPACING.sm,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.xs,
        }}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
        >
          {label}
        </Text>
        <View
          style={{
            minWidth: 0,
            flex: stacked ? undefined : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: stacked ? "flex-start" : "flex-end",
            gap: SPACING.xs,
          }}
        >
          <TextInput
            ref={inputRef}
            accessibilityLabel={error ? `${label}, ungültig` : label}
            accessibilityHint={error ? `Fehler: ${error}` : undefined}
            enablesReturnKeyAutomatically
            keyboardType={keyboardType}
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            maxLength={maxLength}
            onChangeText={onChangeText}
            placeholderTextColor={palette.textMuted}
            selectTextOnFocus={keyboardType === "number-pad"}
            style={{
              minWidth: keyboardType === "number-pad" ? 44 : 96,
              minHeight: CONTROL_HEIGHT.compact,
              flex: keyboardType === "number-pad" ? undefined : 1,
              color: error ? palette.danger : palette.textSecondary,
              textAlign: stacked ? "left" : "right",
              paddingVertical: 0,
              ...TYPOGRAPHY.body,
              ...(keyboardType === "number-pad" ? { fontVariant: ["tabular-nums"] } : {}),
            }}
            value={value}
          />
          {suffix ? (
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}
            >
              {suffix}
            </Text>
          ) : null}
        </View>
      </View>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          selectable
          style={{
            color: palette.danger,
            paddingHorizontal: SPACING.lg,
            paddingBottom: SPACING.sm,
            ...TYPOGRAPHY.footnote,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
