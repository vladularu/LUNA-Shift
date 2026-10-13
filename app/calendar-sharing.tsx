import { Stack } from "expo-router";
import { CalendarSharingScreen } from "@/features/sharing/calendar-sharing-screen";
import { SharingUnavailableScreen } from "@/features/sharing/sharing-ui-elements";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
export default function CalendarSharingRoute() {
  const palette = usePalette();
  const controller = useSharingUiController();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Kalender teilen",
          headerShown: true,
          headerStyle: { backgroundColor: palette.groupedBackground },
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text, ...TYPOGRAPHY.screenTitle },
          contentStyle: { backgroundColor: palette.groupedBackground },
        }}
      />
      {controller ? (
        <CalendarSharingScreen controller={controller} />
      ) : (
        <SharingUnavailableScreen />
      )}
    </>
  );
}
