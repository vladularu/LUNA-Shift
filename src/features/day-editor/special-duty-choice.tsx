import { useState } from "react";
import { ActionSheetIOS, Platform } from "react-native";
import { EntryEditValueRow } from "./entry-edit-fields";
import { usePalette } from "@/theme/palette";

export function DutyChoice({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const palette = usePalette();
  return (
    <>
      <EntryEditValueRow
        label={label}
        value={options.find((option) => option.value === value)?.label ?? value}
        onPress={() => {
          if (Platform.OS !== "ios") {
            setOpen(!open);
            return;
          }
          ActionSheetIOS.showActionSheetWithOptions(
            {
              title: label,
              options: [...options.map((option) => option.label), "Abbrechen"],
              cancelButtonIndex: options.length,
              userInterfaceStyle: palette.dark ? "dark" : "light",
            },
            (index) => {
              if (options[index]) onChange(options[index].value);
            },
          );
        }}
      />
      {open
        ? options.map((option) => (
            <EntryEditValueRow
              key={option.value}
              label={option.label}
              value={option.value === value ? "Ausgewählt" : ""}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
            />
          ))
        : null}
    </>
  );
}
