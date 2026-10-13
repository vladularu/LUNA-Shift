import { router, Stack } from "expo-router";
import { CalendarSharingScreen } from "@/features/sharing/calendar-sharing-screen";
import { SharingUnavailableScreen } from "@/features/sharing/sharing-ui-elements";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
export default function CalendarSharingRoute({
  embedded = false,
}: { readonly embedded?: boolean } = {}) {
  const palette = usePalette();
  const controller = useSharingUiController();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Kalender teilen",
          headerShown: !controller && !embedded,
          headerStyle: { backgroundColor: palette.groupedBackground },
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text, ...TYPOGRAPHY.screenTitle },
          contentStyle: { backgroundColor: palette.groupedBackground },
        }}
      />
      {controller ? (
        <CalendarSharingScreen
          controller={controller}
          onClose={
            embedded
              ? undefined
              : () => {
                  if (router.canGoBack()) router.back();
                  else router.replace("/");
                }
          }
        />
      ) : (
        <SharingUnavailableScreen />
      )}
    </>
  );
}
