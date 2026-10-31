import { router, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { CalendarAccessScreen } from "@/features/sharing/calendar-access-screen";
import { SharingUnavailableScreen } from "@/features/sharing/sharing-ui-elements";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";
import { parseIdentifierRouteParam, type RouteParam } from "@/navigation/route-params";
import { usePalette } from "@/theme/palette";
import { BackFooterLayout } from "@/ui/back-footer-layout";

export default function CalendarAccessRoute() {
  const controller = useSharingUiController();
  const palette = usePalette();
  const params = useLocalSearchParams<{ calendarId?: RouteParam; memberId?: RouteParam }>();
  const calendar = parseIdentifierRouteParam(params.calendarId);
  const member = parseIdentifierRouteParam(params.memberId);
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/calendar-sharing");
  };
  return (
    <>
      <Stack.Screen
        options={{
          title: "Kalenderzugriff",
          headerRight: () => (
            <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
              {controller?.busy ? (
                <ActivityIndicator
                  accessibilityLabel="Zugriff wird gespeichert"
                  color={palette.textMuted}
                  size="small"
                />
              ) : null}
            </View>
          ),
          headerStyle: { backgroundColor: palette.groupedBackground },
          contentStyle: { backgroundColor: palette.groupedBackground },
        }}
      />
      {controller ? (
        <CalendarAccessScreen
          controller={controller}
          calendarId={calendar.status === "valid" ? calendar.value : ""}
          memberId={member.status === "valid" ? member.value : ""}
          onBack={back}
        />
      ) : (
        <BackFooterLayout label="Zurück zur Übersicht" onPress={back}>
          {() => <SharingUnavailableScreen />}
        </BackFooterLayout>
      )}
    </>
  );
}
