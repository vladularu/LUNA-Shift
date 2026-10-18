import { Switch } from "@/ui/switch";
import { Text, TextInput } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import Ionicons from "@/ui/icon";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import type { EntryLocation, EntryNotification, RecurrenceRule } from "@/domain/types";
import { LocationPreview } from "@/features/location/location-preview";
import { AppointmentRecurrenceOverlay } from "@/features/day-editor/appointment-recurrence-overlay";
import { EntryEditOverlayFrame } from "@/features/day-editor/entry-edit-overlay-frame";
import { notificationLabel, recurrenceLabel } from "@/features/day-editor/entry-options";
import { ShiftNotificationOverlay } from "@/features/day-editor/shift-notification-overlay";
import { accessibleChipBackgroundColor, chipTextColor } from "@/theme/color-contrast";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import {
  EntryEditGroup,
  EntryEditNotesLocation,
  EntryEditTimePair,
  EntryEditValueRow as ValueRow,
  ENTRY_EDIT_FIELD_STYLES,
} from "@/features/day-editor/entry-edit-fields";

export function AppointmentEditOverlay({
  allDay,
  appointmentColor,
  busy,
  date,
  durationMinutes,
  endTime,
  error,
  location,
  note,
  notification,
  onAllDayChange,
  onDelete,
  onDismiss,
  onEndTimeChange,
  onLocationPress,
  onNoteChange,
  onNotificationChange,
  onNotificationPress,
  onRecurrenceChange,
  onRequestClose,
  onStartTimeChange,
  onTitleChange,
  recurrence,
  startTime,
  title,
}: {
  readonly allDay: boolean;
  readonly appointmentColor: string;
  readonly busy: boolean;
  readonly date: string;
  readonly durationMinutes: number | null;
  readonly endTime: string;
  readonly error: string | null;
  readonly location: EntryLocation | null;
  readonly note: string;
  readonly notification: EntryNotification | null;
  readonly onAllDayChange: (value: boolean) => void;
  readonly onDelete?: (() => void) | undefined;
  readonly onDismiss: () => void;
  readonly onEndTimeChange: (value: string) => void;
  readonly onLocationPress: () => void;
  readonly onNoteChange: (value: string) => void;
  readonly onNotificationChange: (value: EntryNotification | null) => void;
  readonly onNotificationPress: () => void;
  readonly onRecurrenceChange: (value: RecurrenceRule | null) => void;
  readonly onRequestClose: () => Promise<boolean>;
  readonly onStartTimeChange: (value: string) => void;
  readonly onTitleChange: (value: string) => void;
  readonly recurrence: RecurrenceRule | null;
  readonly startTime: string;
  readonly title: string;
}) {
  const palette = usePalette();
  const headerColor = palette.dark
    ? appointmentColor
    : accessibleChipBackgroundColor(appointmentColor);
  const [notificationVisible, setNotificationVisible] = useState(false);
  const [recurrenceVisible, setRecurrenceVisible] = useState(false);
  const openNotificationPicker = () => {
    if (Platform.OS !== "ios") {
      onNotificationPress();
      return;
    }
    setNotificationVisible(true);
  };

  return (
    <EntryEditOverlayFrame
      busy={busy}
      cardContent={
        <View style={styles.body}>
          <EntryEditGroup testID="appointment-edit-title-group">
            <View style={[styles.valueRow, { borderBottomWidth: 0 }]}>
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.rowLabel, { color: palette.text }]}
              >
                Titel
              </Text>
              <TextInput
                accessibilityLabel="Titel"
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                maxLength={60}
                onChangeText={onTitleChange}
                selectTextOnFocus={title === "Ohne Titel"}
                style={[styles.titleInput, { color: palette.text }]}
                value={title}
              />
            </View>
          </EntryEditGroup>
          <EntryEditGroup testID="appointment-edit-time-group">
            <View style={[styles.valueRow, { borderBottomColor: palette.separator }]}>
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.rowLabel, { color: palette.text }]}
              >
                Ganztägig
              </Text>
              <Switch
                accessibilityLabel="Termin ganztägig"
                onValueChange={onAllDayChange}
                thumbColor={chipTextColor}
                trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
                value={allDay}
              />
            </View>

            {!allDay ? (
              <EntryEditTimePair
                startLabel="Start"
                startTime={startTime}
                endTime={endTime}
                onStartChange={onStartTimeChange}
                onEndChange={onEndTimeChange}
              />
            ) : null}
          </EntryEditGroup>
          <EntryEditGroup testID="appointment-edit-reminder-group">
            <ValueRow
              label="Wiederholen"
              onPress={() => setRecurrenceVisible(true)}
              value={recurrence ? recurrenceLabel(recurrence) : "Niemals"}
            />

            <View style={[styles.valueRow, { borderBottomColor: palette.separator }]}>
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.rowLabel, { color: palette.text }]}
              >
                Kalender
              </Text>
              <View style={styles.calendarValue}>
                <View style={[styles.calendarDot, { backgroundColor: appointmentColor }]} />
                <Text
                  maxFontSizeMultiplier={TEXT_MAX_SCALE}
                  style={[styles.rowValue, styles.calendarLabel, { color: palette.text }]}
                >
                  Termine
                </Text>
              </View>
            </View>

            <ValueRow
              label="Erinnerung"
              onPress={openNotificationPicker}
              separator={false}
              value={notificationLabel(notification)}
            />
          </EntryEditGroup>
          <EntryEditNotesLocation
            emptyLocationLabel="Kein Ort"
            location={location}
            note={note}
            onLocationPress={onLocationPress}
            onNoteChange={onNoteChange}
            testID="appointment-edit-notes-location"
          />
          {location ? <LocationPreview location={location} /> : null}
        </View>
      }
      date={date}
      durationMinutes={durationMinutes}
      error={error}
      headerColor={headerColor}
      headerSubtitle="Termin"
      headerLeading={<Ionicons name="calendar-outline" color={headerColor} size={22} />}
      onDelete={onDelete}
      deleteLabel="Termin löschen"
      onClosingStart={() => {
        setNotificationVisible(false);
        setRecurrenceVisible(false);
      }}
      onDismiss={onDismiss}
      onRequestClose={onRequestClose}
      overlay={
        recurrenceVisible ? (
          <AppointmentRecurrenceOverlay
            onChange={onRecurrenceChange}
            onClose={() => setRecurrenceVisible(false)}
            value={recurrence}
          />
        ) : notificationVisible ? (
          <ShiftNotificationOverlay
            onChange={onNotificationChange}
            onClose={() => setNotificationVisible(false)}
            value={notification}
          />
        ) : null
      }
      testIDPrefix="appointment-edit"
    />
  );
}

const styles = StyleSheet.create({
  body: ENTRY_EDIT_FIELD_STYLES.body,
  valueRow: ENTRY_EDIT_FIELD_STYLES.row,
  rowLabel: ENTRY_EDIT_FIELD_STYLES.label,
  rowValue: ENTRY_EDIT_FIELD_STYLES.value,
  titleInput: {
    minWidth: 0,
    flex: 1,
    paddingVertical: 8,
    fontFamily: INTER_FONTS.medium,
    fontSize: TYPOGRAPHY.body.fontSize,
    lineHeight: TYPOGRAPHY.compact.lineHeight,
    fontWeight: "500",
    textAlign: "right",
  },
  calendarValue: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  calendarDot: { width: 9, height: 9, marginLeft: "auto", borderRadius: 5 },
  calendarLabel: { flex: 0 },
  deleteLabel: {
    fontFamily: INTER_FONTS.medium,
    fontSize: TYPOGRAPHY.compact.fontSize,
    fontWeight: "500",
  },
});
