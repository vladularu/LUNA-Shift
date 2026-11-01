import { Stack } from "expo-router";
import { usePalette } from "@/theme/palette";
import { PAGE_HEADER_OPTIONS } from "@/theme/page-header";

export default function AnalysisStack() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        freezeOnBlur: true,
        gestureEnabled: true,
        fullScreenGestureEnabled: false,
        contentStyle: { backgroundColor: palette.background },
        headerLargeTitle: false,
        ...PAGE_HEADER_OPTIONS,
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerTitleStyle: { color: palette.text },
        statusBarStyle: palette.dark ? "light" : "dark",
      }}
    >
      <Stack.Screen name="analysis" options={{ title: "Auswertung" }} />
      <Stack.Screen name="period" options={{ title: "Auswertung", headerShown: false }} />
    </Stack>
  );
}
