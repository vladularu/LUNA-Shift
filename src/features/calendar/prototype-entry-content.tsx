import { Text } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import type { CalendarEntry, CalendarPreferencesData } from "@/domain/types";
import { calendarChipPalette } from "@/theme/color-contrast";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, CALENDAR_METRICS } from "@/theme/tokens";
import { ShiftSymbol } from "@/ui/shift-symbol";
import { calendarShiftDetail } from "./calendar-display";
import { CalendarAppointmentLabel } from "./calendar-appointment-label";

export type PrototypeDisplay = Pick<
  CalendarPreferencesData,
  "labelMode" | "showShiftTimes" | "showShiftDuration"
>;

export const PrototypeEntryContent = memo(function PrototypeEntryContent({
  entry,
  display,
  timeZone,
  lineHeight = CALENDAR_METRICS.entryRowHeight,
}: {
  entry: CalendarEntry;
  display: PrototypeDisplay;
  timeZone: string;
  lineHeight?: number;
}) {
  const palette = usePalette();
  const rowStyle = { height: lineHeight, lineHeight, fontSize: Math.min(12, lineHeight - 1) };
  if (entry.kind === "APPOINTMENT")
    return <CalendarAppointmentLabel title={entry.title} lineHeight={lineHeight} />;
  const colors = calendarChipPalette(entry.color, palette.dark);
  const detail = calendarShiftDetail(entry, { ...display, timeZone });
  return (
    <View style={styles.chip}>
      <View style={[styles.main, { height: lineHeight, backgroundColor: colors.main }]}>
        {display.labelMode === "SYMBOL" ? (
          <ShiftSymbol value={entry.symbol} color={CALENDAR_METRICS.chipTextColor} size={12} />
        ) : (
          <Text
            numberOfLines={1}
            allowFontScaling={false}
            style={[styles.row, rowStyle, styles.center, { color: CALENDAR_METRICS.chipTextColor }]}
          >
            {display.labelMode === "SHORT" ? entry.title.slice(0, 1) : entry.title}
          </Text>
        )}
      </View>
      {detail ? (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[
            styles.row,
            rowStyle,
            styles.center,
            { backgroundColor: colors.detail, color: colors.onDetail },
          ]}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    borderRadius: CALENDAR_METRICS.chipRadius,
    borderCurve: CORNER_CURVE,
    overflow: "hidden",
  },
  main: { height: CALENDAR_METRICS.entryRowHeight, justifyContent: "center", alignItems: "center" },
  row: {
    height: CALENDAR_METRICS.entryRowHeight,
    lineHeight: CALENDAR_METRICS.entryRowHeight,
    fontFamily: INTER_FONTS.medium,
    fontSize: CALENDAR_METRICS.entryFontSize,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  center: { textAlign: "center", width: "100%" },
});
