import { View } from "react-native";

import { INTER_FONTS } from "@/theme/shadcn";
import { usePalette } from "@/theme/palette";
import { CALENDAR_METRICS, RADII } from "@/theme/tokens";
import { Text } from "@/ui/text";

export function CalendarAppointmentLabel({
  title,
  lineHeight,
}: {
  readonly title: string;
  readonly lineHeight: number;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        height: lineHeight,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
      }}
    >
      <View
        style={{
          width: CALENDAR_METRICS.entryDotSize,
          height: CALENDAR_METRICS.entryDotSize,
          borderRadius: RADII.pill,
          backgroundColor: palette.textMuted,
        }}
      />
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        allowFontScaling={false}
        style={{
          flex: 1,
          minWidth: 0,
          height: lineHeight,
          lineHeight,
          fontFamily: INTER_FONTS.medium,
          fontSize: Math.min(CALENDAR_METRICS.entryFontSize, lineHeight - 1),
          fontWeight: "500",
          color: palette.text,
        }}
      >
        {title}
      </Text>
    </View>
  );
}
