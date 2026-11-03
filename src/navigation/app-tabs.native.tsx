import { APP_FONT_FAMILY } from "@/theme/app-font";
import Ionicons from "@expo/vector-icons/Ionicons";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { requestCalendarTodayOnPress, useActiveMonthCoordinator } from "@/navigation/active-month";
import { requestAnalysisCurrentPeriodOnReselect } from "./analysis-period-navigation";
import { useCalendarTabDate } from "@/navigation/calendar-tab-date";
import { calendarTabIconSource } from "@/navigation/calendar-tab-icon";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";

export function AppTabs() {
  const palette = usePalette();
  const today = useCalendarTabDate();
  const activeMonthCoordinator = useActiveMonthCoordinator();
  return (
    <NativeTabs
      unstable_nativeProps={{ colorScheme: palette.dark ? "dark" : "light" }}
      backgroundColor={palette.tabBar}
      iconColor={{ default: palette.textMuted, selected: palette.accent }}
      labelStyle={{
        default: {
          color: palette.textMuted,
          fontFamily: APP_FONT_FAMILY,
          fontSize: TYPOGRAPHY.overline.fontSize,
          fontWeight: TYPOGRAPHY.overline.fontWeight,
        },
        selected: {
          color: palette.primary,
          fontFamily: APP_FONT_FAMILY,
          fontSize: TYPOGRAPHY.overline.fontSize,
          fontWeight: TYPOGRAPHY.overline.fontWeight,
        },
      }}
      minimizeBehavior="never"
      tintColor={palette.accent}
    >
      <NativeTabs.Trigger
        disableScrollToTop
        listeners={({ navigation }) => ({
          tabPress: () => {
            requestCalendarTodayOnPress(activeMonthCoordinator, navigation.isFocused());
          },
        })}
        name="(calendar)"
        accessibilityLabel={today.accessibilityLabel}
      >
        <NativeTabs.Trigger.Label>Kalender</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={calendarTabIconSource(today.day)} renderingMode="template" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="(analysis)"
        disableScrollToTop
        listeners={({ navigation }) => ({
          tabPress: () =>
            requestAnalysisCurrentPeriodOnReselect(activeMonthCoordinator, navigation.isFocused()),
        })}
      >
        <NativeTabs.Trigger.Label>Auswertung</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          renderingMode="template"
          src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="bar-chart-outline" />}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(templates)">
        <NativeTabs.Trigger.Label>Vorlagen</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          renderingMode="template"
          src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="documents-outline" />}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(more)">
        <NativeTabs.Trigger.Label>Mehr</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          renderingMode="template"
          src={
            <NativeTabs.Trigger.VectorIcon
              family={Ionicons}
              name="ellipsis-horizontal-circle-outline"
            />
          }
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
