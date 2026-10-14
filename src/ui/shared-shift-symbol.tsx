import { View, type StyleProp, type ViewStyle } from "react-native";
import Icon from "@/ui/icon";
import { ShiftSymbol } from "@/ui/shift-symbol";

/** Translate the stable sharing protocol without changing personal text symbols. */
export function SharedShiftSymbol({
  value,
  color,
  size,
  style,
}: {
  readonly value: string;
  readonly color: string;
  readonly size: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  if (value === "calendar" || value === "unavailable")
    return (
      <View style={[{ alignItems: "center", justifyContent: "center" }, style]}>
        <Icon
          name={value === "calendar" ? "calendar-outline" : "close-circle"}
          color={color}
          size={size}
          accessible={false}
        />
      </View>
    );
  return (
    <ShiftSymbol
      value={value === "sunrise" ? "rise" : value === "clock" ? "time" : value}
      color={color}
      size={size}
      style={style}
    />
  );
}
