import { router, Stack, useLocalSearchParams } from "expo-router";
import { HeaderBackButton, useHeaderHeight } from "expo-router/react-navigation";
import { useRef, type PropsWithChildren, type ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { salaryRoute } from "@/navigation/routes";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { LoadingView, LoadFailureView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { NetPaySetupForm } from "./net-pay-setup-form";
import { useNetPayProfile } from "./use-net-pay-profile";

export function NetPaySettingsScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const month = parsed.status === "valid" ? parsed.value : "2000-01";
  const { profile } = usePflegeShiftProfile();
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
          headerLeft: () => (
            <HeaderBackButton
              accessibilityLabel="Zurück zum Gehalt"
              tintColor={palette.text}
              onPress={backToSalary}
            />
          ),
        }}
      />
      <NetPaySetupForm
        key={month}
        month={month}
        initial={data.saved?.settings ?? null}
        firstSetup={data.timeline.length === 0}
        worksInSaxony={profile.federalState === "SN"}
        churchTaxDefaultPercent={
          profile.federalState === "BY" || profile.federalState === "BW" ? 8 : 9
        }
        busy={data.busy}
        onSave={data.save}
        onSaved={backToSalary}
        onValidationFailure={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
        renderLayout={({ content, footer }) => (
          <NetPaySettingsLayout footer={footer} scrollRef={scrollRef}>
            {content}
          </NetPaySettingsLayout>
        )}
      />
    </>
  );
}

function NetPaySettingsLayout({
  children,
  footer,
  scrollRef,
}: PropsWithChildren<{
  readonly footer: ReactNode;
  readonly scrollRef: React.RefObject<ScrollView | null>;
}>) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.background }}
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScreenScrollView
        testID="net-pay-settings-screen"
        scrollRef={scrollRef}
        style={{ flex: 1 }}
        keyboardDismissMode={process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        bottomPadding={SPACING.xl}
      >
        {children}
      </ScreenScrollView>
      <View
        testID="net-pay-settings-footer"
        style={{
          borderTopWidth: 1,
          borderTopColor: palette.separator,
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.md,
          paddingBottom: Math.max(insets.bottom, SPACING.md),
        }}
      >
        {footer}
      </View>
    </KeyboardAvoidingView>
  );
}
