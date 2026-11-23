import { memo, useContext } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { formatMonthTitle } from "@/engine/calendar";
import { CONTROL_HEIGHT } from "@/theme/tokens";
import { nativeScrollEdge } from "@/ui/native-scroll-edge";
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
  const safeTop = useContext(SafeAreaInsetsContext)?.top ?? 0;
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
        testID={`calendar-month-header-${month}`}
        title={title}
        stableTitle
        minimumTitleScale={0.75}
        titleHeightMode="content"
        transparent
        compactTitleArea
        safeTopOverride={nativeScrollEdge ? safeTop : 0}
        accessory={
          <View
            testID={`calendar-month-header-accessory-${month}`}
            style={{
              width: CONTROL_HEIGHT.compact * 3 + StyleSheet.hairlineWidth * 2 + 2,
              height: CONTROL_HEIGHT.compact,
            }}
          />
        }
      />
    </View>
  );
});
