import { Stack } from "expo-router";

import { usePalette } from "@/theme/palette";
import { PAGE_HEADER_OPTIONS } from "@/theme/page-header";

export default function TemplatesStack() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: palette.background },
        headerLargeTitle: true,
        headerLargeTitleStyle: { color: palette.text },
        ...PAGE_HEADER_OPTIONS,
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        headerTitleStyle: { color: palette.text },
        statusBarStyle: palette.dark ? "light" : "dark",
      }}
    >
      <Stack.Screen name="templates" options={{ headerShown: false, title: "Dienstvorlagen" }} />
    </Stack>
  );
}
