import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { parseIdentifierRouteParam, type RouteParam } from "@/navigation/route-params";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import { pageBackButtonOptions } from "@/ui/native-page-header";
import { SurfaceCard } from "@/ui/design-system";
import { ReportScrollView } from "@/ui/report-layout";
import { Text } from "@/ui/text";
import { CHECK_TITLE } from "./check-copy";
import { ComplianceIssueDetails } from "./compliance-issue-content";
import {
  readCheckIssueSession,
  isCheckIssueSessionInvalidated,
  releaseCheckIssueSession,
  subscribeCheckIssueSession,
} from "@/navigation/check-issue-session";

export function CheckIssueScreen() {
  const palette = usePalette();
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
  return (
    <>
      <Stack.Screen
        options={{
          ...pageBackButtonOptions(close, "Zurück", true),
          title: CHECK_TITLE,
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text },
          statusBarStyle: palette.dark ? "light" : "dark",
        }}
      />
      <BackFooterLayout onPress={close} showFooter={false} footerTestID="check-detail-back-footer">
        {(bottomPadding) => (
          <ReportScrollView bottomPadding={bottomPadding}>
            {request ? (
              <ComplianceIssueDetails {...request} />
            ) : (
              <SurfaceCard style={{ padding: SPACING.xl, gap: SPACING.md }}>
                <Text
                  accessibilityRole="header"
                  style={{ ...TYPOGRAPHY.bodyStrong, color: palette.text }}
                >
                  Prüfungsdetails nicht verfügbar
                </Text>
                <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>
                  Öffne den Prüfpunkt bitte erneut im Dienstplan-Check.
                </Text>
              </SurfaceCard>
            )}
          </ReportScrollView>
        )}
      </BackFooterLayout>
    </>
  );
}
