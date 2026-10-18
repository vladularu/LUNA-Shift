import { SelectionRow } from "@/ui/selection-option";
import { Text } from "@/ui/text";
import { CONTROL_CORNERS, SHADOWS, SPACING } from "@/theme/tokens";
import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View, type ViewProps } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { SHIFT_TYPE_LABELS } from "@/domain/types";
import { EntryEditOverlayFrame } from "@/features/day-editor/entry-edit-overlay-frame";
import { shouldDismissEntryEditOverlay } from "@/features/day-editor/entry-edit-overlay-pattern";
import { notificationLabel } from "@/features/day-editor/entry-options";
import { DAY_EDITOR_SHIFT_TYPES } from "@/features/day-editor/day-editor-layout";
import { ShiftNotificationOverlay } from "@/features/day-editor/shift-notification-overlay";
import type { ShiftEditOverlayProps } from "@/features/day-editor/shift-edit-overlay.types";
import {
  ShiftOvertimeFields,
  ShiftOvertimeConfirmation,
} from "@/features/day-editor/shift-overtime-fields";
import { LocationPreview } from "@/features/location/location-preview";
import { accessibleChipBackgroundColor } from "@/theme/color-contrast";
import { MOTION } from "@/theme/motion";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import {
  EntryEditGroup,
  EntryEditNotesLocation,
  EntryEditTimePair,
  EntryEditValueRow as ValueRow,
  ENTRY_EDIT_FIELD_STYLES,
} from "@/features/day-editor/entry-edit-fields";
import { PauseWheel } from "@/ui/pause-wheel";
import { ShiftSymbol } from "@/ui/shift-symbol";
import { ResponsiveFieldRow } from "@/ui/form-controls";

type Popup = "PAUSE" | "TYPE" | null;

export function shouldDismissShiftEditOverlay(translationY: number, velocityY: number): boolean {
  "worklet";
  return shouldDismissEntryEditOverlay(translationY, velocityY);
}

function PauseRow({
  onLayout,
  onPress,
  value,
}: {
  readonly onLayout: ViewProps["onLayout"];
  readonly onPress: () => void;
  readonly value: string;
}) {
  const palette = usePalette();
  const minutes = Number(value) || 0;
  return (
    <Pressable
      accessibilityLabel={`Pause: ${minutes} Minuten`}
      accessibilityRole="button"
      onPress={onPress}
      onLayout={onLayout}
      style={({ pressed }) => [
        styles.valueRow,
        {
          borderBottomColor: palette.separator,
          backgroundColor: pressed ? palette.surfaceMuted : "transparent",
        },
      ]}
    >
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={[styles.rowLabel, { color: palette.textMuted }]}
      >
        Pause
      </Text>
      <View style={styles.pauseValue}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={[styles.pauseValueText, { color: palette.text }]}
        >
          {minutes} Min.
        </Text>
      </View>
    </Pressable>
  );
}

export function ShiftEditOverlay({
  alarmEnabled,
  breakMinutes,
  busy,
  date,
  durationMinutes,
  error,
  location,
  note,
  notification,
  onAlarmPress,
  onBreakMinutesChange,
  onBreakPress,
  onDelete,
  onDismiss,
  onEndTimeChange,
  onLocationPress,
  onNoteChange,
  onNotificationChange,
  onNotificationPress,
  onOvertimeMinutesChange,
  onRequestClose,
  onShiftTypeChange,
  onStartTimeChange,
  onTariffOvertimeConfirmedChange,
  overtimeInputRef,
  overtimeMinutes,
  shiftColor,
  shiftIsTimed,
  shiftSymbol,
  shiftTitle,
  shiftType,
  startTime,
  tariffOvertimeConfirmed,
  endTime,
}: ShiftEditOverlayProps) {
  const palette = usePalette();
  const [popup, setPopup] = useState<Popup>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);
  const [timeGroupTop, setTimeGroupTop] = useState(0);
  const [pauseRowBottom, setPauseRowBottom] = useState(144);
  const headerColor = palette.dark ? shiftColor : accessibleChipBackgroundColor(shiftColor);
  const serviceLabel = shiftType === "CUSTOM" ? shiftTitle : SHIFT_TYPE_LABELS[shiftType];

  const openPausePicker = useCallback(() => {
    if (Platform.OS !== "ios") {
      onBreakPress();
      return;
    }
    if (popup === "PAUSE") {
      setPopup(null);
      return;
    }
    setPopup("PAUSE");
  }, [onBreakPress, popup]);

  const openNotificationPicker = useCallback(() => {
    if (Platform.OS !== "ios") {
      onNotificationPress();
      return;
    }
    setPopup(null);
    setNotificationVisible(true);
  }, [onNotificationPress]);

  return (
    <EntryEditOverlayFrame
      busy={busy}
      cardContent={
        <>
          <View style={styles.body}>
            <EntryEditGroup
              testID="shift-edit-time-group"
              onLayout={({ nativeEvent: { layout } }) => setTimeGroupTop(layout.y)}
            >
              {shiftIsTimed ? (
                <>
                  <EntryEditTimePair
                    startTime={startTime}
                    endTime={endTime}
                    onStartChange={onStartTimeChange}
                    onEndChange={onEndTimeChange}
                  />
                  <View
                    testID="shift-edit-pause-overtime-pair"
                    onLayout={({ nativeEvent: { layout } }) =>
                      setPauseRowBottom(layout.y + layout.height)
                    }
                  >
                    <ResponsiveFieldRow style={ENTRY_EDIT_FIELD_STYLES.pair}>
                      <PauseRow
                        onLayout={undefined}
                        onPress={openPausePicker}
                        value={breakMinutes}
                      />
                      <ShiftOvertimeFields
                        compact
                        confirmed={tariffOvertimeConfirmed}
                        inputRef={overtimeInputRef}
                        onConfirmedChange={onTariffOvertimeConfirmedChange}
                        onMinutesChange={onOvertimeMinutesChange}
                        overtimeMinutes={overtimeMinutes}
                      />
                    </ResponsiveFieldRow>
                  </View>
                  {Number(overtimeMinutes) > 0 ? (
                    <ShiftOvertimeConfirmation
                      confirmed={tariffOvertimeConfirmed}
                      onConfirmedChange={onTariffOvertimeConfirmedChange}
                    />
                  ) : null}
                </>
              ) : (
                <ValueRow label="Dauer" separator={false} value="Ganztägig" />
              )}
            </EntryEditGroup>
            <EntryEditGroup testID="shift-edit-reminder-group">
              <ValueRow
                label="Erinnerung"
                onPress={openNotificationPicker}
                separator={shiftIsTimed}
                value={notificationLabel(notification)}
              />
              {shiftIsTimed ? (
                <ValueRow
                  label="Wecker"
                  separator={false}
                  onPress={() => {
                    setPopup(null);
                    onAlarmPress();
                  }}
                  value={alarmEnabled ? "Zum Dienstbeginn" : "Aus"}
                />
              ) : null}
            </EntryEditGroup>
            <EntryEditNotesLocation
              emptyLocationLabel="Kein Ort"
              location={location}
              note={note}
              onLocationPress={onLocationPress}
              onNoteChange={onNoteChange}
              testID="shift-edit-notes-location"
            />
            {location ? <LocationPreview location={location} /> : null}
          </View>

          {popup === "PAUSE" ? (
            <Pressable
              accessibilityLabel="Auswahl schließen"
              onPress={() => setPopup(null)}
              style={styles.popupDismissLayer}
              testID="shift-edit-popup-dismiss-layer"
            />
          ) : null}

          {popup === "PAUSE" ? (
            <Animated.View
              accessibilityLabel="Pausendauer auswählen"
              entering={FadeIn.duration(MOTION.duration.fast).reduceMotion(MOTION.reduceMotion)}
              style={[
                styles.pausePopup,
                {
                  backgroundColor: palette.surfaceRaised,
                  borderColor: palette.border,
                  shadowColor: palette.shadow,
                  top: timeGroupTop + pauseRowBottom + SPACING.xs,
                },
              ]}
              testID="shift-edit-pause-popover"
            >
              <PauseWheel
                animatedOptions
                onChange={onBreakMinutesChange}
                selectionStyle={styles.pauseWheelSelection}
                selectionTestID="shift-edit-pause-selection"
                testID="shift-edit-pause-wheel"
                value={Number(breakMinutes) || 0}
              />
            </Animated.View>
          ) : null}

          {popup === "TYPE" ? (
            <View
              style={[
                styles.typePopup,
                {
                  backgroundColor: palette.surfaceRaised,
                  borderColor: palette.border,
                  shadowColor: palette.shadow,
                  top: SPACING.xs,
                },
              ]}
              testID="shift-edit-type-popover"
            >
              <ScrollView style={styles.typeScroll}>
                {DAY_EDITOR_SHIFT_TYPES.map((type) => {
                  const selected = type === shiftType;
                  return (
                    <SelectionRow
                      key={type}
                      label={SHIFT_TYPE_LABELS[type]}
                      selected={selected}
                      separator
                      onPress={() => {
                        onShiftTypeChange(type);
                        setPopup(null);
                      }}
                    />
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </>
      }
      date={date}
      durationMinutes={durationMinutes}
      error={error}
      headerColor={headerColor}
      headerSubtitle={serviceLabel}
      headerAccessibilityLabel={`Dienst: ${serviceLabel}`}
      headerLeading={<ShiftSymbol color={headerColor} size={22} value={shiftSymbol} />}
      onHeaderPress={() => setPopup(popup === "TYPE" ? null : "TYPE")}
      onDelete={onDelete}
      deleteLabel="Dienst löschen"
      onBackdropPress={() => setPopup(null)}
      onClosingStart={() => {
        setPopup(null);
        setNotificationVisible(false);
      }}
      onDismiss={onDismiss}
      onRequestClose={onRequestClose}
      overlay={
        notificationVisible ? (
          <ShiftNotificationOverlay
            onChange={onNotificationChange}
            onClose={() => setNotificationVisible(false)}
            value={notification}
          />
        ) : null
      }
      testIDPrefix="shift-edit"
    />
  );
}

const styles = StyleSheet.create({
  body: ENTRY_EDIT_FIELD_STYLES.body,
  valueRow: { minHeight: 44, alignItems: "flex-start", gap: 0 },
  rowLabel: TYPOGRAPHY.small,
  pauseValue: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "flex-start",
    justifyContent: "center",
    ...CONTROL_CORNERS,
    paddingHorizontal: 0,
  },
  pauseValueText: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  deleteLabel: { fontSize: TYPOGRAPHY.compact.fontSize, fontWeight: "500" },
  popupDismissLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
  },
  pausePopup: {
    position: "absolute",
    right: 16,
    zIndex: 2,
    width: 210,
    height: 220,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    ...CONTROL_CORNERS,

    boxShadow: SHADOWS.overlay,
  },
  pauseWheelSelection: {
    ...CONTROL_CORNERS,
  },
  typePopup: {
    position: "absolute",
    left: 16,
    right: 16,
    maxHeight: 330,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    ...CONTROL_CORNERS,

    boxShadow: SHADOWS.overlay,
  },
  typeScroll: { maxHeight: 330 },
  typeItem: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 15,
  },
  typeLabel: { fontSize: TYPOGRAPHY.compact.fontSize, fontWeight: "500" },
});
