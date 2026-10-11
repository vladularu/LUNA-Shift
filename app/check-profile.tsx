import { Stack } from "expo-router";
import { CheckProfileScreen } from "@/features/settings/check-profile-screen";
import { usePalette } from "@/theme/palette";

export default function CheckProfileRoute() {
  const palette = usePalette();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Deine Prüfung",
          headerShown: true,
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
        }}
      />
      <CheckProfileScreen />
    </>
  );
}
