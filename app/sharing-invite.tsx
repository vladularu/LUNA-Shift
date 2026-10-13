import { Stack, useLocalSearchParams } from "expo-router";
import {
  SharingInviteScreen,
  parseSharingInviteToken,
} from "@/features/sharing/sharing-invite-screen";
import { SharingUnavailableScreen } from "@/features/sharing/sharing-ui-elements";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
export default function SharingInviteRoute() {
  const palette = usePalette();
  const controller = useSharingUiController();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Einladung",
          headerShown: true,
          headerStyle: { backgroundColor: palette.groupedBackground },
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text, ...TYPOGRAPHY.screenTitle },
          contentStyle: { backgroundColor: palette.groupedBackground },
        }}
      />
      {controller ? (
        <SharingInviteScreen
          key={parseSharingInviteToken(params.token) ?? "invalid"}
          controller={controller}
          token={params.token}
        />
      ) : (
        <SharingUnavailableScreen />
      )}
    </>
  );
}
