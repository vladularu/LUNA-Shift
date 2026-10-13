import { useState } from "react";
import { Pressable, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { ShiftColorPickerSheet } from "@/ui/shift-color-picker-sheet";

export function SharingCalendarColorPicker({
  name,
  value,
  disabled,
  onChange,
}: {
  readonly name: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (color: string) => void;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Farbe für ${name}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: SPACING.xl,
            height: SPACING.xl,
            borderRadius: SPACING.xl / 2,
            backgroundColor: value,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        />
      </Pressable>
      {open ? (
        <ShiftColorPickerSheet
          value={value}
          symbol="people"
          visible={open}
          onClose={() => setOpen(false)}
          onChange={(color) => {
            setOpen(false);
            onChange(color);
          }}
        />
      ) : null}
    </>
  );
}
