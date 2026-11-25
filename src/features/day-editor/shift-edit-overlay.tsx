import { SelectionRow } from "@/ui/selection-option";
import { Text } from "@/ui/text";
import { CONTROL_CORNERS, SHADOWS, SPACING } from "@/theme/tokens";
import { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { SHIFT_TYPE_LABELS } from "@/domain/types";
import {
  EntryEditOverlayFrame,
  useEntryOverviewStage,
} from "@/features/day-editor/entry-edit-overlay-frame";
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
import { SoftScrollAnchor, SoftScrollScope, SoftScrollView } from "@/ui/soft-scroll-layout";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import {
  EntryEditGroup,
  EntryEditNotesLocation,
  EntryEditTimePair,
  EntryEditValueRow as ValueRow,
  ENTRY_EDIT_FIELD_STYLES,
} from "@/features/day-editor/entry-edit-fields";
import { PauseChoiceMenu } from "@/ui/pause-picker";
import { LunaChoiceMenu } from "@/ui/luna-choice-menu";
import { ShiftSymbol } from "@/ui/shift-symbol";
import { ResponsiveFieldRow } from "@/ui/form-controls";
import { ShiftEditOverview } from "./shift-edit-overview";
import type { ShiftEntry } from "@/domain/types";

export function shiftOverviewEntry(shift: ShiftEntry | null, billingFocus: boolean) {
  return Platform.OS === "ios" && !billingFocus ? (shift ?? undefined) : undefined;
}

export function shouldDismissShiftEditOverlay(translationY: number, velocityY: number): boolean {
  "worklet";
  return shouldDismissEntryEditOverlay(translationY, velocityY);
}

function PauseRow({ onPress, value }: { readonly onPress: () => void; readonly value: string }) {
  const palette = usePalette();
  const minutes = Number(value) || 0;
  return (
    <Pressable
      accessibilityLabel={`Pause: ${minutes} Minuten`}
      accessibilityRole="button"
      onPress={onPress}
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
  specialDutyFields,
  specialDutyKind,
  specialDuty,
  overview,
  children,
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
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [notificationVisible, setNotificationVisible] = useState(false);
  const closePickers = () => {
    setTypePickerOpen(false);
    setNotificationVisible(false);
  };
  const overviewStage = useEntryOverviewStage("SHIFT", overview !== undefined, closePickers);
  const headerColor = palette.dark ? shiftColor : accessibleChipBackgroundColor(shiftColor);
  const serviceLabel = shiftType === "CUSTOM" ? shiftTitle : SHIFT_TYPE_LABELS[shiftType];
  const entryType = DAY_EDITOR_SHIFT_TYPES.includes(shiftType) ? shiftType : "CUSTOM";
  const showingOverview = overview !== undefined && overviewStage?.expanded === false;

  const openNotificationPicker = useCallback(() => {
    if (Platform.OS !== "ios") {
      onNotificationPress();
      return;
    }
    setTypePickerOpen(false);
    setNotificationVisible(true);
  }, [onNotificationPress]);

  const frame = (
    <EntryEditOverlayFrame
      busy={busy}
      contentKey={showingOverview ? "overview" : "editor"}
      closeLabel={overviewStage?.expanded ? "Speichern" : "Schließen"}
      nativePresentation={overviewStage ? false : undefined}
      overviewStage={overviewStage}
      cardContent={
        showingOverview ? (
          <ShiftEditOverview
            durationMinutes={durationMinutes}
            shift={{
              ...overview,
              allDay: !shiftIsTimed,
              type: shiftType,
              startTime: shiftIsTimed ? startTime : null,
              endTime: shiftIsTimed ? endTime : null,
              breakMinutes: Number(breakMinutes) || 0,
              overtimeMinutes: Number(overtimeMinutes) || 0,
              tariffOvertimeConfirmed,
              specialDuty,
            }}
          />
        ) : (
          <>
            <View style={styles.body}>
              {specialDutyFields}
              {!specialDutyKind ? (
                <EntryEditGroup testID="shift-edit-time-group">
                  {shiftIsTimed ? (
                    <>
                      <EntryEditTimePair
                        startTime={startTime}
                        endTime={endTime}
                        onStartChange={onStartTimeChange}
                        onEndChange={onEndTimeChange}
                      />
                      <View testID="shift-edit-pause-overtime-pair">
                        <ResponsiveFieldRow style={ENTRY_EDIT_FIELD_STYLES.pair}>
                          {Platform.OS === "ios" ? (
                            <PauseChoiceMenu
                              disabled={busy}
                              layout="field"
                              onChange={onBreakMinutesChange}
                              testID="shift-edit-pause"
                              value={Number(breakMinutes) || 0}
                            />
                          ) : (
                            <PauseRow onPress={onBreakPress} value={breakMinutes} />
                          )}
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
              ) : null}
              {specialDutyKind === "SPLIT" ? (
                <EntryEditGroup testID="shift-edit-split-overtime-group">
                  <Text
                    style={{
                      ...TYPOGRAPHY.small,
                      color: palette.textSecondary,
                      padding: SPACING.md,
                    }}
                  >
                    Überstunden im ersten Dienstteil
                  </Text>
                  <ShiftOvertimeFields
                    compact
                    confirmed={tariffOvertimeConfirmed}
                    inputRef={overtimeInputRef}
                    onConfirmedChange={onTariffOvertimeConfirmedChange}
                    onMinutesChange={onOvertimeMinutesChange}
                    overtimeMinutes={overtimeMinutes}
                  />
                  {Number(overtimeMinutes) > 0 ? (
                    <ShiftOvertimeConfirmation
                      confirmed={tariffOvertimeConfirmed}
                      onConfirmedChange={onTariffOvertimeConfirmedChange}
                    />
                  ) : null}
                </EntryEditGroup>
              ) : null}
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
                      setTypePickerOpen(false);
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

            {typePickerOpen ? (
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
                <SoftScrollScope>
                  <SoftScrollAnchor>
                    <Text
                      style={{
                        ...TYPOGRAPHY.label,
                        color: palette.textSecondary,
                        paddingHorizontal: SPACING.lg,
                        paddingTop: SPACING.md,
                        paddingBottom: SPACING.sm,
                      }}
                    >
                      Eintragsart
                    </Text>
                  </SoftScrollAnchor>
                  <SoftScrollView
                    accessibilityRole="radiogroup"
                    accessibilityLabel="Eintragsart auswählen"
                    style={styles.typeScroll}
                  >
                    {DAY_EDITOR_SHIFT_TYPES.map((type) => {
                      const selected = type === entryType;
                      return (
                        <SelectionRow
                          key={type}
                          label={SHIFT_TYPE_LABELS[type]}
                          selected={selected}
                          separator
                          onPress={() => {
                            if (!selected) onShiftTypeChange(type);
                            setTypePickerOpen(false);
                          }}
                        />
                      );
                    })}
                  </SoftScrollView>
                </SoftScrollScope>
              </View>
            ) : null}
          </>
        )
      }
      date={date}
      durationMinutes={durationMinutes}
      error={error}
      headerColor={headerColor}
      headerSubtitle={serviceLabel}
      hideHeaderDuration={showingOverview}
      headerAccessibilityLabel={`Dienst: ${serviceLabel}`}
      headerLeading={<ShiftSymbol color={headerColor} size={22} value={shiftSymbol} />}
      headerSubtitleControl={
        Platform.OS === "ios" && !showingOverview
          ? (disabled) => (
              <LunaChoiceMenu
                disabled={disabled}
                displayValue={serviceLabel}
                label="Eintragsart"
                layout="inline"
                onChange={(type) => {
                  if (type !== entryType) onShiftTypeChange(type);
                }}
                options={DAY_EDITOR_SHIFT_TYPES.map((value) => ({
                  value,
                  label: SHIFT_TYPE_LABELS[value],
                }))}
                testPrefix="shift-edit-type"
                value={entryType}
              />
            )
          : undefined
      }
      onHeaderPress={
        Platform.OS !== "ios" && !showingOverview
          ? () => setTypePickerOpen((open) => !open)
          : undefined
      }
      onDelete={onDelete}
      deleteLabel="Dienst löschen"
      onBackdropPress={() => setTypePickerOpen(false)}
      onClosingStart={closePickers}
      onDismiss={onDismiss}
      onRequestClose={onRequestClose}
      overlay={
        notificationVisible && !showingOverview ? (
          <ShiftNotificationOverlay
            luna
            onChange={onNotificationChange}
            onClose={() => setNotificationVisible(false)}
            value={notification}
          />
        ) : null
      }
      testIDPrefix="shift-edit"
    />
  );
  return (
    <>
      {frame}
      {children}
    </>
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
});
