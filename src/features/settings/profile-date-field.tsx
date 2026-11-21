import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Pressable, View } from "react-native";
import { Text } from "@/ui/text";
import { Field } from "@/ui/form-controls";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";

/** Calendar-only selection on devices; keep the web input usable without native modules. */
export function ProfileDateField({
  value,
  onChange,
  disabled,
  label = "Gültig ab",
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
  readonly label?: string;
}) {
  const palette = usePalette();
  const [day, month, year] = value.split(".").map(Number);
  const date = new Date(year, month - 1, day, 12);
  const choose = (next: Date) =>
    onChange(
      [
        String(next.getDate()).padStart(2, "0"),
        String(next.getMonth() + 1).padStart(2, "0"),
        next.getFullYear(),
      ].join("."),
    );
  if (process.env.EXPO_OS === "web")
    return (
      <Field
        label={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        placeholder="TT.MM.JJJJ"
      />
    );
  if (process.env.EXPO_OS === "android")
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value}, Datum wählen`}
        disabled={disabled}
        style={{ minHeight: 48, justifyContent: "center" }}
        onPress={() =>
          DateTimePickerAndroid.open({
            mode: "date",
            value: date,
            onValueChange: (_, next) => choose(next),
          })
        }
      >
        <Text style={{ color: palette.primary, ...TYPOGRAPHY.bodyStrong }}>
          {label} {value}
        </Text>
      </Pressable>
    );
  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: SPACING.sm,
        justifyContent: "space-between",
      }}
    >
      <Text style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}>{label}</Text>
      <DateTimePicker
        accessibilityLabel={label}
        mode="date"
        display="compact"
        locale="de-DE"
        value={date}
        disabled={disabled}
        onValueChange={(_, next) => choose(next)}
      />
    </View>
  );
}
