import { Stack, router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { CalendarDesignScreen } from "@/features/settings/calendar-design-screen";
import { usePalette } from "@/theme/palette";
import { BackFooterLayout } from "@/ui/back-footer-layout";

export default function CalendarDesignRoute() {
  const palette = usePalette();
  const { origin, notice } = useLocalSearchParams<{
    origin?: string | string[];
    notice?: string | string[];
  }>();
  const fromSettings = origin === "settings";
  const message =
    notice === "holidays"
      ? "Feiertagsregeln für den gewählten Monat sind nicht verfügbar."
      : notice === "loading"
        ? "Die Kalenderdaten wurden beim Öffnen dieser Ansicht noch geladen."
        : undefined;
  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace(fromSettings ? "/more" : "/");
  }
  return (
    <BackFooterLayout
      label={fromSettings ? "Zurück zu Mehr" : "Zurück zum Kalender"}
      onPress={goBack}
    >
      {(bottomPadding) => (
        <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
          <Stack.Screen
            options={{
              title: "Kalender gestalten",
              headerShown: true,
              headerStyle: { backgroundColor: palette.groupedBackground },
              headerTintColor: palette.text,
              headerTitleStyle: { color: palette.text },
              statusBarStyle: palette.dark ? "light" : "dark",
            }}
          />
          <CalendarDesignScreen notice={message} bottomPadding={bottomPadding} />
        </View>
      )}
    </BackFooterLayout>
  );
}
