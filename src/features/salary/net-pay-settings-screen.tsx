import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, type PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";

import {
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { salaryRoute } from "@/navigation/routes";
import { employmentProfileAt } from "@/domain/employment-history";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { LoadingView, LoadFailureView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { pageBackButtonOptions } from "@/ui/native-page-header";
import { NetPaySetupForm } from "./net-pay-setup-form";
import { useNetPayProfile } from "./use-net-pay-profile";

export function NetPaySettingsScreen() {
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const month = parsed.status === "valid" ? parsed.value : "2000-01";
  const { profile } = usePflegeShiftProfile();
  const work = profile ? employmentProfileAt(profile, `${month}-01`) : null;
  const { ready, error, reload } = usePflegeShiftStatus();
  const { testMonths } = usePflegeShiftTestData();
  const blocked = testMonths.includes(month);
  const data = useNetPayProfile(
    month,
    parsed.status === "valid" && ready && error === null && profile !== null && !blocked,
  );
  const scrollRef = useRef<ScrollView>(null);
  function backToSalary() {
    if (router.canGoBack()) router.back();
    else router.replace(salaryRoute(month));
  }

  if (parsed.status !== "valid") {
    return (
      <LoadFailureView
        title="Netto-Einstellungen können nicht geöffnet werden"
        message="Der Link enthält keinen gültigen Monat."
        actionLabel="Zurück zum Gehalt"
        onRetry={() => router.back()}
      />
    );
  }
  if (ready && error) return <LoadFailureView message={error} onRetry={() => void reload()} />;
  if (blocked) {
    return (
      <LoadFailureView
        title="Netto-Einstellungen nicht verfügbar"
        message="Für Testdaten gibt es keine Netto-Prognose."
        actionLabel="Zurück zum Gehalt"
        onRetry={backToSalary}
      />
    );
  }
  if (!ready || profile === null || data.status === "loading") return <LoadingView />;
  if (data.status === "error") {
    return <LoadFailureView message={data.error!} onRetry={data.reload} />;
  }
  return (
    <>
      <Stack.Screen
        options={{
          title: "Netto-Einstellungen",
          ...pageBackButtonOptions(backToSalary, "Zurück zum Gehalt", true),
        }}
      />
      <NetPaySetupForm
        key={month}
        month={month}
        initial={data.saved?.settings ?? null}
        firstSetup={data.timeline.length === 0}
        worksInSaxony={work?.federalState === "SN"}
        churchTaxDefaultPercent={work?.federalState === "BY" || work?.federalState === "BW" ? 8 : 9}
        busy={data.busy}
        onSave={data.save}
        onSaved={backToSalary}
        onValidationFailure={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
        renderLayout={({ content, headerAction }) => (
          <>
            <Stack.Toolbar placement="right">
              <Stack.Toolbar.View hidesSharedBackground>{headerAction}</Stack.Toolbar.View>
            </Stack.Toolbar>
            <NetPaySettingsLayout scrollRef={scrollRef}>{content}</NetPaySettingsLayout>
          </>
        )}
      />
    </>
  );
}

function NetPaySettingsLayout({
  children,
  scrollRef,
}: PropsWithChildren<{
  readonly scrollRef: React.RefObject<ScrollView | null>;
}>) {
  const palette = usePalette();
  const headerHeight = useHeaderHeight();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScreenScrollView
        testID="net-pay-settings-screen"
        scrollRef={scrollRef}
        style={{ flex: 1 }}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        bottomPadding={SPACING.xl}
      >
        {children}
      </ScreenScrollView>
    </KeyboardAvoidingView>
  );
}
