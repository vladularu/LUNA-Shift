import Ionicons from "@/ui/icon";
import { Tabs } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";

import { requestCalendarTodayOnPress, useActiveMonthCoordinator } from "@/navigation/active-month";
import { requestAnalysisCurrentPeriodOnReselect } from "./analysis-period-navigation";
import { appTabMotionOptions } from "@/navigation/app-tabs-motion";
import { useCalendarTabDate } from "@/navigation/calendar-tab-date";
import { CalendarTabIcon } from "@/navigation/calendar-tab-icon";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";

export function AppTabs() {
  const palette = usePalette();
  const today = useCalendarTabDate();
  const activeMonthCoordinator = useActiveMonthCoordinator();
  const reduceMotion = useReducedMotion();

  return (
    <Tabs
      initialRouteName="(calendar)"
      screenOptions={{
        freezeOnBlur: true,
        headerShown: false,
        lazy: true,
        tabBarActiveTintColor: palette.primary,
        tabBarHideOnKeyboard: true,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarLabelStyle: TYPOGRAPHY.overline,
        tabBarStyle: { backgroundColor: palette.tabBar, borderTopColor: palette.border },
        ...appTabMotionOptions(reduceMotion),
      }}
    >
      <Tabs.Screen
        listeners={() => ({
          tabPress: () => {
            requestCalendarTodayOnPress(activeMonthCoordinator);
          },
        })}
        name="(calendar)"
        options={{
          title: "Kalender",
          tabBarAccessibilityLabel: today.accessibilityLabel,
          // Keep external month changes positioned before this tab is revealed.
          freezeOnBlur: false,
          tabBarIcon: ({ color, size, focused }) => (
            <CalendarTabIcon day={today.day} color={focused ? palette.accent : color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="(analysis)"
        listeners={({ navigation }) => ({
          tabPress: () =>
            requestAnalysisCurrentPeriodOnReselect(activeMonthCoordinator, navigation.isFocused()),
        })}
        options={{
          title: "Auswertung",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              accessible={false}
              color={focused ? palette.accent : color}
              name="stats-chart-outline"
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="(templates)"
        options={{
          title: "Vorlagen",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              accessible={false}
              color={focused ? palette.accent : color}
              name="documents-outline"
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="(more)"
        options={{
          title: "Mehr",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              accessible={false}
              color={focused ? palette.accent : color}
              name="ellipsis-horizontal-circle-outline"
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
