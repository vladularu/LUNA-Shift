import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Keyboard, Platform, Pressable, View, useWindowDimensions } from "react-native";
import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Field, PrimaryButton } from "@/ui/form-controls";
import Ionicons from "@/ui/icon";
import { SelectionSheet } from "@/ui/selection-sheet";
import { Text } from "@/ui/text";

export function NetPaySettingDate({
  value,
  onChange,
  disabled,
  compact,
  month,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
  readonly compact: boolean;
  readonly month: string;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(new Date(1990, 0, 15, 12));
  const maximumDate = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1, 12);
  const minimumDate = new Date(1900, 0, 1, 12);
  const stacked =
    fontScale > SELECTION_METRICS.stackFontScale || width < SELECTION_METRICS.narrowWidth;
  const formatted = (date: Date) =>
    [
      String(date.getDate()).padStart(2, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      date.getFullYear(),
    ].join(".");

  if (!compact || Platform.OS === "web") {
    return (
      <Field
        label="Geburtsdatum (TT.MM.JJJJ)"
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        placeholder="15.01.1990"
      />
    );
  }
  const open = () => {
    Keyboard.dismiss();
    const [day, birthMonth, year] = value.split(".").map(Number);
    const parsed = new Date(year, birthMonth - 1, day, 12);
    const valid = Number.isFinite(parsed.getTime()) && formatted(parsed) === value;
    const initial = valid ? parsed : new Date(1990, 0, 15, 12);
    const bounded = new Date(
      Math.max(minimumDate.getTime(), Math.min(maximumDate.getTime(), initial.getTime())),
    );
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: bounded,
        minimumDate,
        maximumDate,
        onValueChange: (_, next) => onChange(formatted(next)),
      });
      return;
    }
    setDraft(bounded);
    setVisible(true);
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Geburtsdatum auswählen: ${value || "Noch nicht angegeben"}`}
        accessibilityHint="Öffnet die Datumsauswahl."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={open}
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT.regular,
          padding: SPACING.lg,
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "stretch" : "center",
          gap: SPACING.md,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ flex: stacked ? undefined : 1, color: palette.text, ...TYPOGRAPHY.body }}>
          Geburtsdatum
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
          <Text style={{ color: value ? palette.text : palette.textMuted, ...TYPOGRAPHY.body }}>
            {value || "Datum auswählen"}
          </Text>
          <Ionicons
            accessibilityElementsHidden
            name="calendar-outline"
            size={18}
            color={palette.textMuted}
          />
        </View>
      </Pressable>
      {visible ? (
        <SelectionSheet
          title="Geburtsdatum"
          visible
          disabled={disabled}
          onClose={() => setVisible(false)}
          cancelLabel="Abbrechen"
          closeInHeader
        >
          {() => (
            <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
              <DateTimePicker
                accessibilityLabel="Geburtsdatum im Kalender"
                value={draft}
                mode="date"
                display="inline"
                locale="de-DE"
                themeVariant={palette.dark ? "dark" : "light"}
                accentColor={palette.text}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                disabled={disabled}
                onValueChange={(_, next) => setDraft(next)}
              />
              <PrimaryButton
                disabled={disabled}
                onPress={() => {
                  onChange(formatted(draft));
                  setVisible(false);
                }}
              >
                Datum übernehmen
              </PrimaryButton>
            </View>
          )}
        </SelectionSheet>
      ) : null}
    </>
  );
}
