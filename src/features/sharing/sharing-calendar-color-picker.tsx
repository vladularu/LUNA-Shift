import { useState } from "react";
import { Pressable } from "react-native";
import { PersonAvatar } from "@/ui/person-avatar";
import { ShiftColorPickerSheet } from "@/ui/shift-color-picker-sheet";

export function SharingCalendarColorPicker({
  name,
  value,
  disabled,
  photoUri,
  visible = true,
  onChange,
}: {
  readonly name: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly photoUri?: string | null;
  readonly visible?: boolean;
  readonly onChange: (color: string) => void;
}) {
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
        <PersonAvatar
          name={name}
          color={value}
          photoUri={photoUri}
          selected={visible}
          showSelectionBadge={false}
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
