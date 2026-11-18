import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ScrollView } from "react-native";
import { parseIdentifierRouteParam, type RouteParam } from "@/navigation/route-params";
import {
  isCheckIssueSessionInvalidated,
  readCheckIssueSession,
  releaseCheckIssueSession,
  subscribeCheckIssueSession,
} from "@/navigation/check-issue-session";
import { usePalette } from "@/theme/palette";
import { CHECK_REFERENCE_TYPOGRAPHY } from "@/theme/typography";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import { pageBackButtonOptions } from "@/ui/native-page-header";
import { nativeSheetScrollEdgeOptions } from "@/ui/native-sheet-scroll-edge";
import { Text } from "@/ui/text";
import {
  CHECK_DETAIL_REFERENCE,
  CheckDetailCard,
  CheckReferenceDetailContext,
  checkReferenceColors,
} from "./check-detail-layout";
import { ComplianceIssueDetails } from "./compliance-issue-content";

export function CheckIssueScreen() {
  const palette = usePalette();
  const colors = checkReferenceColors(palette);
  const params = useLocalSearchParams<{ session?: RouteParam }>();
  const parsed = parseIdentifierRouteParam(params.session);
  const id = parsed.status === "valid" ? parsed.value : null;
  const request = useSyncExternalStore(
    subscribeCheckIssueSession,
    () => readCheckIssueSession(id),
    () => null,
  );
  useEffect(() => {
    if (!id) return;
    return () => releaseCheckIssueSession(id);
  }, [id]);
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/analysis");
  }, []);
  const invalidated = isCheckIssueSessionInvalidated(id);
  useEffect(() => {
    if (invalidated) close();
  }, [close, invalidated]);
  const scrollEdge = nativeSheetScrollEdgeOptions();

  return (
    <CheckReferenceDetailContext.Provider value={colors}>
      <Stack.Screen
        options={{
          ...pageBackButtonOptions(close, "Hinweis schließen", true),
          title: "Hinweis",
          headerStyle: { backgroundColor: colors.background },
          ...scrollEdge,
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text },
          contentStyle: { backgroundColor: colors.background },
          statusBarStyle: palette.dark ? "light" : "dark",
        }}
      />
      <BackFooterLayout onPress={close} nativeSheet footerTestID="check-detail-back-footer">
        {(bottomPadding) => (
          <ScrollView
            testID="check-issue-scroll"
            contentInsetAdjustmentBehavior="automatic"
            style={{ flex: 1, backgroundColor: colors.background }}
            contentContainerStyle={{
              paddingHorizontal: CHECK_DETAIL_REFERENCE.pageInset,
              paddingTop: 15,
              paddingBottom: bottomPadding,
            }}
          >
            {request ? (
              <ComplianceIssueDetails {...request} />
            ) : (
              <CheckDetailCard title="Prüfungsdetails nicht verfügbar">
                <Text style={{ ...CHECK_REFERENCE_TYPOGRAPHY.body, color: colors.secondary }}>
                  Öffne den Prüfpunkt bitte erneut im Dienstplan-Check.
                </Text>
              </CheckDetailCard>
            )}
          </ScrollView>
        )}
      </BackFooterLayout>
    </CheckReferenceDetailContext.Provider>
  );
}
