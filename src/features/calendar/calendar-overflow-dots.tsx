import { View } from "react-native";

import { usePalette } from "@/theme/palette";
import { CALENDAR_METRICS, RADII } from "@/theme/tokens";
import type { CombinedCalendarRow } from "./combined-calendar-preview";

export function CalendarOverflowDots({
  date,
  hiddenRows,
  headerHeight,
}: {
  readonly date: string;
  readonly hiddenRows: readonly CombinedCalendarRow[];
  readonly headerHeight: number;
}) {
  const palette = usePalette();
  if (hiddenRows.length === 0) return null;
  return (
    <View
      testID={`calendar-overflow-${date}`}
      accessibilityLabel={`${hiddenRows.length} weitere Einträge`}
      accessible={false}
      style={{
        position: "absolute",
        top: headerHeight - CALENDAR_METRICS.entryDotSize - 1,
        left: 0,
        right: 0,
        height: CALENDAR_METRICS.entryDotSize,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      {hiddenRows.slice(0, 5).map((item, index) => {
        const entry = item.kind === "own" ? item.entry : item.row.entry;
        return (
          <View
            key={index}
            testID={`calendar-overflow-dot-${date}-${index}`}
            style={{
              width: CALENDAR_METRICS.entryDotSize,
              height: CALENDAR_METRICS.entryDotSize,
              borderRadius: RADII.pill,
              backgroundColor: entry.kind === "APPOINTMENT" ? palette.textMuted : entry.color,
            }}
          />
        );
      })}
      {hiddenRows.length > 5 ? (
        <View testID={`calendar-overflow-more-${date}`} style={{ flexDirection: "row", gap: 1 }}>
          {[0, 1, 2].map((index) => (
            <View
              key={index}
              style={{
                width: 1,
                height: 1,
                borderRadius: RADII.pill,
                backgroundColor: palette.textMuted,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
