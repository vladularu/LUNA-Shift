import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { formatMonthTitle } from "@/engine/calendar";
import { CONTROL_HEIGHT } from "@/theme/tokens";
import { TabScreenHeader } from "@/ui/screen-layout";

/** A real part of each native page: title and dates have exactly one scroll position. */
export const CalendarMonthTitle = memo(function CalendarMonthTitle({
  month,
  referenceMonth,
  accessible,
}: {
  readonly month: string;
  readonly referenceMonth: string;
  readonly accessible: boolean;
}) {
  const title =
    month.slice(0, 4) === referenceMonth.slice(0, 4)
      ? formatMonthTitle(month).replace(/\s+\d{4}$/, "")
      : formatMonthTitle(month);
  return (
    <View
      pointerEvents="none"
      testID={`calendar-month-title-${month}`}
      accessibilityElementsHidden={!accessible}
      importantForAccessibility={accessible ? "auto" : "no-hide-descendants"}
    >
      <TabScreenHeader
        title={title}
        stableTitle
        transparent
        safeTopOverride={0}
        accessory={
          <View
            style={{
              width: CONTROL_HEIGHT.compact * 3 + StyleSheet.hairlineWidth * 2 + 2,
              height: CONTROL_HEIGHT.compact + 2,
            }}
          />
        }
      />
    </View>
  );
});
