import { Text, TextInput } from "@/ui/text";
import type { Ref } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";

export function ShiftOvertimeFields({
  confirmed,
  inputRef,
  onConfirmedChange,
  onMinutesChange,
  overtimeMinutes,
  compact = false,
}: {
  readonly confirmed: boolean;
  readonly inputRef: Ref<TextInput>;
  readonly onConfirmedChange: (value: boolean) => void;
  readonly onMinutesChange: (value: string) => void;
  readonly overtimeMinutes: string;
  readonly compact?: boolean;
}) {
  const palette = usePalette();
  return (
    <>
      <View
        style={[styles.row, compact && styles.compact, { borderBottomColor: palette.separator }]}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={[
            styles.label,
            compact && TYPOGRAPHY.small,
            { color: compact ? palette.textMuted : palette.text },
          ]}
        >
          Überstunden
        </Text>
        <TextInput
          ref={inputRef}
          accessibilityLabel="Tariflich bestätigte Überstunden in Minuten"
          keyboardType="number-pad"
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          onChangeText={onMinutesChange}
          selectTextOnFocus
          style={[
            styles.input,
            compact && styles.compactInput,
            {
              color: palette.text,
              backgroundColor: compact ? "transparent" : palette.surfaceMuted,
            },
          ]}
          value={overtimeMinutes}
        />
      </View>
      {!compact && Number(overtimeMinutes) > 0 ? (
        <ShiftOvertimeConfirmation confirmed={confirmed} onConfirmedChange={onConfirmedChange} />
      ) : null}
    </>
  );
}

export function ShiftOvertimeConfirmation({
  confirmed,
  onConfirmedChange,
}: {
  readonly confirmed: boolean;
  readonly onConfirmedChange: (value: boolean) => void;
}) {
  const palette = usePalette();
  const status = confirmed ? "Als Überstunden bestätigt" : "Nicht bestätigt";
  return (
    <Pressable
      accessibilityLabel={`Tarifstatus: ${status}`}
      accessibilityRole="button"
      onPress={() => onConfirmedChange(!confirmed)}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: palette.separator,
          backgroundColor: pressed ? palette.surfaceMuted : "transparent",
        },
      ]}
    >
      <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[styles.label, { color: palette.text }]}>
        Tarifstatus
      </Text>
      <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[styles.value, { color: palette.text }]}>
        {status}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flexShrink: 0, ...TYPOGRAPHY.bodyStrong },
  compact: { flexDirection: "column", alignItems: "flex-start", borderBottomWidth: 0, gap: 0 },
  compactInput: {
    minWidth: 44,
    minHeight: 44,
    textAlign: "left",
    padding: 0,
    ...TYPOGRAPHY.body,
  },
  value: {
    flex: 1,
    textAlign: "right",
    ...TYPOGRAPHY.bodyStrong,
  },
  input: {
    borderCurve: CORNER_CURVE,
    minWidth: 92,
    borderRadius: RADII.control,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
    ...TYPOGRAPHY.bodyStrong,
  },
});
