import { useState, type PropsWithChildren } from "react";
import { Pressable, StyleSheet, View, type ViewProps } from "react-native";

import type { EntryLocation } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { ResponsiveFieldRow, TimePickerField } from "@/ui/form-controls";
import Ionicons from "@/ui/icon";
import { Text, TextInput } from "@/ui/text";

export function EntryEditGroup({
  children,
  onLayout,
  testID,
}: PropsWithChildren<{ readonly onLayout?: ViewProps["onLayout"]; readonly testID?: string }>) {
  return (
    <View onLayout={onLayout}>
      <SurfaceCard style={ENTRY_EDIT_FIELD_STYLES.group} testID={testID}>
        {children}
      </SurfaceCard>
    </View>
  );
}

export function EntryEditValueRow({
  label,
  onPress,
  separator = true,
  value,
}: {
  readonly label: string;
  readonly onPress?: () => void;
  readonly separator?: boolean;
  readonly value: string;
}) {
  const palette = usePalette();
  const content = (
    <>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={[ENTRY_EDIT_FIELD_STYLES.label, { color: palette.text }]}
      >
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={[ENTRY_EDIT_FIELD_STYLES.value, { color: palette.textMuted }]}
      >
        {value}
      </Text>
      {onPress ? (
        <Ionicons
          accessibilityElementsHidden
          name="chevron-forward"
          size={16}
          color={palette.textMuted}
        />
      ) : null}
    </>
  );
  const rowStyle = [
    ENTRY_EDIT_FIELD_STYLES.row,
    {
      borderBottomColor: palette.separator,
      borderBottomWidth: separator ? StyleSheet.hairlineWidth : 0,
    },
  ];
  return onPress ? (
    <Pressable
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        rowStyle,
        { backgroundColor: pressed ? palette.surfaceMuted : "transparent" },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={rowStyle}>{content}</View>
  );
}

export function EntryEditTimeRow({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const palette = usePalette();
  return (
    <View style={[ENTRY_EDIT_FIELD_STYLES.timeRow, { borderBottomColor: palette.separator }]}>
      <TimePickerField label={label} onChange={onChange} value={value} />
    </View>
  );
}

export function EntryEditNotesLocation({
  emptyLocationLabel,
  location,
  note,
  onLocationPress,
  onNoteChange,
  testID,
}: {
  readonly emptyLocationLabel: string;
  readonly location: EntryLocation | null;
  readonly note: string;
  readonly onLocationPress: () => void;
  readonly onNoteChange: (value: string) => void;
  readonly testID: string;
}) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const locationName = location?.name ?? null;
  return (
    <SurfaceCard testID={testID}>
      {expanded ? (
        <TextInput
          accessibilityLabel="Notizen"
          autoFocus
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          multiline
          onChangeText={onNoteChange}
          placeholder="Notizen"
          placeholderTextColor={palette.textMuted}
          style={[
            ENTRY_EDIT_FIELD_STYLES.note,
            { color: palette.text, borderBottomColor: palette.separator },
          ]}
          value={note}
        />
      ) : (
        <Pressable
          accessibilityLabel={note ? `Notiz bearbeiten: ${note}` : "Notiz hinzufügen"}
          accessibilityRole="button"
          onPress={() => setExpanded(true)}
          style={[
            ENTRY_EDIT_FIELD_STYLES.location,
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.separator },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            name="file-document-outline"
            size={18}
            color={palette.textMuted}
          />
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={[
              ENTRY_EDIT_FIELD_STYLES.locationText,
              { color: note ? palette.text : palette.textMuted },
            ]}
          >
            {note || "Notiz hinzufügen"}
          </Text>
          <Ionicons
            accessibilityElementsHidden
            name="chevron-forward"
            size={16}
            color={palette.textMuted}
          />
        </Pressable>
      )}
      <Pressable
        accessibilityLabel={`Ort: ${locationName ?? emptyLocationLabel}`}
        accessibilityRole="button"
        onPress={onLocationPress}
        style={({ pressed }) => [
          ENTRY_EDIT_FIELD_STYLES.location,
          { backgroundColor: pressed ? palette.surfaceMuted : "transparent" },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          name="location-outline"
          size={18}
          color={palette.textMuted}
        />
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={[
            ENTRY_EDIT_FIELD_STYLES.locationText,
            { color: locationName ? palette.text : palette.textMuted },
          ]}
        >
          {locationName ?? "Ort"}
        </Text>
        <Ionicons
          accessibilityElementsHidden
          name="chevron-forward"
          size={16}
          color={palette.textMuted}
        />
      </Pressable>
    </SurfaceCard>
  );
}

export function EntryEditTimePair({
  startLabel = "Beginn",
  startTime,
  endTime,
  onStartChange,
  onEndChange,
}: {
  readonly startLabel?: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly onStartChange: (value: string) => void;
  readonly onEndChange: (value: string) => void;
}) {
  const palette = usePalette();
  return (
    <ResponsiveFieldRow
      style={[ENTRY_EDIT_FIELD_STYLES.pair, { borderBottomColor: palette.separator }]}
    >
      <TimePickerField
        label={startLabel}
        layout="stacked"
        value={startTime}
        onChange={onStartChange}
      />
      <TimePickerField label="Ende" layout="stacked" value={endTime} onChange={onEndChange} />
    </ResponsiveFieldRow>
  );
}

export const ENTRY_EDIT_FIELD_STYLES = StyleSheet.create({
  body: { padding: SPACING.md, gap: SPACING.sm },
  group: { paddingHorizontal: SPACING.md },
  pair: { paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flexShrink: 1, ...TYPOGRAPHY.body },
  value: { flex: 1, ...TYPOGRAPHY.body, textAlign: "right", fontVariant: ["tabular-nums"] },
  timeRow: { minHeight: 48, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  note: {
    minHeight: 88,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    ...TYPOGRAPHY.compact,
    textAlignVertical: "top",
  },
  location: {
    minHeight: 44,
    flexDirection: "row",
    gap: SPACING.sm,
    alignItems: "center",
    paddingHorizontal: SPACING.md,
  },
  locationText: { flex: 1, ...TYPOGRAPHY.body },
});
