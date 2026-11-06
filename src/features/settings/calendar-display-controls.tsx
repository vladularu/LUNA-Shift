import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import type { ComponentProps } from "react";
import { Pressable, View } from "react-native";
import { useCalendarPreferences } from "@/features/calendar/calendar-preferences";
import { CALENDAR_HOLIDAY_COLORS } from "@/theme/calendar-day-tints";
import { readableTextColor } from "@/theme/color-contrast";
import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, RowButton, SurfaceCard } from "@/ui/design-system";
import { SelectionGroup } from "@/ui/selection-group";
import { ShiftColorSchemePicker } from "./shift-color-scheme-picker";
import { CalendarChoiceRows } from "./calendar-choice-rows";
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
  const legacyTimeDisplay = preferences.showShiftTimes && preferences.showShiftDuration;
  const timeDisplay = legacyTimeDisplay
    ? null
    : preferences.showShiftTimes
      ? "START"
      : preferences.showShiftDuration
        ? "DURATION"
        : "NONE";
  const displayDisabled = !preferences.ready || !preferences.showShifts;
  return (
    <>
      <SelectionGroup title="Dienstfarben" testID="calendar-shift-colors-settings">
        <SurfaceCard>
          <ShiftColorSchemePicker
            pastelColors={preferences.pastelColors}
            disabled={displayDisabled}
            onChange={preferences.setPastelColors}
          />
        </SurfaceCard>
      </SelectionGroup>
      <SelectionGroup title="Dienstbezeichnung" testID="calendar-label-settings">
        <SurfaceCard>
          <CalendarChoiceRows
            label="Dienstbezeichnung"
            options={[
              { value: "FULL", label: "Name" },
              { value: "SHORT", label: "Kürzel" },
              { value: "SYMBOL", label: "Symbol" },
            ]}
            value={preferences.labelMode}
            disabled={displayDisabled}
            onChange={preferences.setLabelMode}
          />
        </SurfaceCard>
      </SelectionGroup>
      <SelectionGroup title="Zeitangabe" testID="calendar-time-settings">
        <SurfaceCard>
          <CalendarChoiceRows
            label="Zeitangabe"
            options={[
              { value: "NONE", label: "Keine" },
              { value: "START", label: "Startzeit" },
              { value: "DURATION", label: "Gesamtdauer" },
            ]}
            value={timeDisplay}
            disabled={displayDisabled}
            onChange={preferences.setTimeDisplay}
          />
          {legacyTimeDisplay ? (
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{ ...TYPOGRAPHY.caption, color: palette.textMuted, padding: SPACING.lg }}
            >
              Bisher werden Startzeit und Gesamtdauer angezeigt. Wähle, welche Zeitangabe du künftig
              sehen möchtest.
            </Text>
          ) : null}
        </SurfaceCard>
      </SelectionGroup>
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
