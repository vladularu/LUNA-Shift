import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import type { ComponentProps } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import type { CalendarLabelMode } from "@/domain/types";
import { useCalendarPreferences } from "@/features/calendar/calendar-preferences";
import { CALENDAR_HOLIDAY_COLORS } from "@/theme/calendar-day-tints";
import { readableTextColor } from "@/theme/color-contrast";
import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, RowButton, SegmentedControl, SurfaceCard } from "@/ui/design-system";
import { SelectionGroup } from "@/ui/selection-group";
import { ShiftColorSchemePicker } from "./shift-color-scheme-picker";
import { LabeledSwitch } from "@/ui/labeled-switch";

function DisplaySwitch({
  label,
  icon,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly icon: ComponentProps<typeof Ionicons>["name"];
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
  readonly disabled: boolean;
}) {
  const palette = usePalette();
  return (
    <RowButton
      title={label}
      leading={
        <Ionicons
          name={icon}
          size={24}
          color={disabled ? palette.textMuted : palette.primary}
          accessible={false}
        />
      }
      trailing={
        <Pressable
          hitSlop={2}
          accessibilityRole="switch"
          accessibilityLabel={label}
          accessibilityState={{ checked: value, disabled }}
          disabled={disabled}
          onPress={() => onChange(!value)}
          style={{
            minHeight: CONTROL_HEIGHT.regular,
            minWidth: CONTROL_HEIGHT.regular,
            justifyContent: "center",
          }}
        >
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <LabeledSwitch label={label} value={value} disabled={disabled} accessible={false} />
          </View>
        </Pressable>
      }
    />
  );
}

export function CalendarDisplayControls() {
  const preferences = useCalendarPreferences();
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const displayDisabled = !preferences.ready || !preferences.showShifts;
  return (
    <>
      <SelectionGroup title="Kalenderinhalt" testID="calendar-content-settings">
        <SurfaceCard>
          <DisplaySwitch
            label="Dienste & Abwesenheiten"
            icon="briefcase-outline"
            value={preferences.showShifts}
            onChange={preferences.setShowShifts}
            disabled={!preferences.ready}
          />
          <CardSeparator />
          <DisplaySwitch
            label="Termine"
            icon="calendar-outline"
            value={preferences.showAppointments}
            onChange={preferences.setShowAppointments}
            disabled={!preferences.ready}
          />
          <CardSeparator />
          <DisplaySwitch
            label="Feiertage"
            icon="sparkles-outline"
            value={preferences.showHolidays}
            onChange={preferences.setShowHolidays}
            disabled={!preferences.ready}
          />
        </SurfaceCard>
      </SelectionGroup>
      <SelectionGroup title="Feiertage & Sondertage" testID="calendar-holiday-color-settings">
        <SurfaceCard>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Farbe für Feiertage und Sondertage"
            style={{ flexDirection: "row", flexWrap: "wrap", padding: SPACING.lg, gap: SPACING.md }}
          >
            {(
              [
                { value: "RED", label: "Rot" },
                { value: "BLUE", label: "Blau" },
                { value: "ORANGE", label: "Orange" },
              ] as const
            ).map(({ value, label }) => {
              const selected = preferences.holidayColor === value;
              const disabled = !preferences.ready || !preferences.showHolidays;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    if (!selected) preferences.setHolidayColor(value);
                  }}
                  style={{
                    flexGrow: 1,
                    flexBasis: 64,
                    minHeight: 44,
                    alignItems: "center",
                    gap: SPACING.sm,
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: RADII.pill,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: CALENDAR_HOLIDAY_COLORS[value],
                      borderWidth: selected ? 2 : 0,
                      borderColor: palette.text,
                    }}
                  >
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={22}
                        color={readableTextColor(CALENDAR_HOLIDAY_COLORS[value])}
                        accessible={false}
                      />
                    ) : null}
                  </View>
                  <Text
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    style={{ ...TYPOGRAPHY.caption, color: palette.text }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SurfaceCard>
      </SelectionGroup>
      <SelectionGroup title="Dienstfarben" testID="calendar-shift-colors-settings">
        <SurfaceCard>
          <ShiftColorSchemePicker
            pastelColors={preferences.pastelColors}
            disabled={displayDisabled}
            onChange={preferences.setPastelColors}
          />
        </SurfaceCard>
      </SelectionGroup>
      <SelectionGroup title="Dienstanzeige" testID="calendar-label-settings">
        <SurfaceCard>
          <View style={{ padding: SPACING.lg }}>
            <SegmentedControl
              accessibilityLabel="Dienstbezeichnung"
              items={[
                { value: "FULL", label: "Name" },
                { value: "SHORT", label: "Kürzel" },
                { value: "SYMBOL", label: "Symbol" },
              ]}
              value={preferences.labelMode}
              disabled={displayDisabled}
              stacked={width < 360 || fontScale > 1.2}
              onChange={(value) => preferences.setLabelMode(value as CalendarLabelMode)}
            />
          </View>
          <CardSeparator inset={0} />
          <DisplaySwitch
            label="Startzeit"
            icon="time-outline"
            value={preferences.showShiftTimes}
            onChange={preferences.setShowShiftTimes}
            disabled={displayDisabled}
          />
          <CardSeparator />
          <DisplaySwitch
            label="Gesamtdauer"
            icon="hourglass-outline"
            value={preferences.showShiftDuration}
            onChange={preferences.setShowShiftDuration}
            disabled={displayDisabled}
          />
        </SurfaceCard>
      </SelectionGroup>
      {!preferences.showShifts ? (
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}
        >
          Aktiviere Dienste, um die Anzeige zu ändern.
        </Text>
      ) : null}
    </>
  );
}
