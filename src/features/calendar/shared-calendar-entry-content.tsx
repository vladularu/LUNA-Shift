import { View } from "react-native";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { CALENDAR_METRICS } from "@/theme/tokens";
import { sharedCalendarChipPalette } from "@/theme/color-contrast";
import { SharedShiftSymbol } from "@/ui/shared-shift-symbol";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import type { PrototypeDisplay } from "./prototype-entry-content";
import { sharedShiftDetail } from "./shared-shift-detail";

export function SharedCalendarEntryContent({
  row,
  display,
  lineHeight,
}: {
  readonly row: SharedCalendarDayEntry;
  readonly display: PrototypeDisplay;
  readonly lineHeight: number;
}) {
  const palette = usePalette();
  const colors = sharedCalendarChipPalette(row.entry.color, palette.dark);
  const detail = sharedShiftDetail(row.entry, row.when.split("–")[0], display);
  const textStyle = {
    height: lineHeight,
    lineHeight,
    fontSize: Math.min(12, lineHeight - 1),
    textAlign: "center" as const,
    color: colors.onDetail,
  };
  return (
    <View
      testID={`shared-calendar-entry-${row.calendarId}-${row.entry.id}`}
      style={{
        borderRadius: CALENDAR_METRICS.chipRadius,
        overflow: "hidden",
        borderLeftWidth: CALENDAR_METRICS.sharedCalendarStripeWidth,
        borderLeftColor: row.calendarColor,
        backgroundColor: colors.detail,
      }}
    >
      {display.labelMode === "SYMBOL" ? (
        <View style={{ height: lineHeight, alignItems: "center", justifyContent: "center" }}>
          <SharedShiftSymbol color={colors.onDetail} size={12} value={row.entry.symbol} />
        </View>
      ) : (
        <Text numberOfLines={1} allowFontScaling={false} style={textStyle}>
          {display.labelMode === "SHORT" ? row.entry.title.slice(0, 1) : row.entry.title}
        </Text>
      )}
      {detail !== null ? (
        <Text numberOfLines={1} allowFontScaling={false} style={textStyle}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
