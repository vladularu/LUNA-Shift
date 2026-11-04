import { Stack } from "expo-router";
import { usePalette } from "@/theme/palette";
import { PAGE_HEADER_OPTIONS, nativePageHeaderStyle } from "@/theme/page-header";
import { pageBackButtonOptions } from "@/ui/native-page-header";

export default function MoreStack() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: palette.background },
        headerLargeTitle: true,
        headerLargeTitleStyle: { color: palette.text },
        ...PAGE_HEADER_OPTIONS,
        ...pageBackButtonOptions(),
        headerStyle: nativePageHeaderStyle(palette.background),
        headerTintColor: palette.text,
        headerTitleStyle: { color: palette.text },
        statusBarStyle: palette.dark ? "light" : "dark",
      }}
    >
      <Stack.Screen name="more" options={{ headerShown: false, title: "Mehr" }} />
    </Stack>
  );
}
