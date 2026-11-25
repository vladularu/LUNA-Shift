import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";

import {
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { netPayForecastRoute } from "@/navigation/routes";
import { employmentProfileAt } from "@/domain/employment-history";
import { DEV_TOOLS_AVAILABLE } from "@/infrastructure/dev-tools-policy";
import {
  loadNetPayGuideSkipped,
  saveNetPayGuideSkipped,
} from "@/infrastructure/database/preferences-repository";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { LoadingView, LoadFailureView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { pageBackButtonOptions } from "@/ui/native-page-header";
import { NetPaySetupForm } from "./net-pay-setup-form";
import { useNetPayProfile } from "./use-net-pay-profile";

async function discardPreviewChanges() {}

export function NetPaySettingsScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ month?: RouteParam; preview?: RouteParam }>();
  const preview = DEV_TOOLS_AVAILABLE && params.preview === "1";
  const parsed = parseMonthRouteParam(params.month);
  const month = parsed.status === "valid" ? parsed.value : "2000-01";
  const { profile } = usePflegeShiftProfile();
  const work = !preview && profile ? employmentProfileAt(profile, `${month}-01`) : null;
  const { ready, error, reload } = usePflegeShiftStatus();
  const { testMonths } = usePflegeShiftTestData();
  const blocked = !preview && testMonths.includes(month);
  const data = useNetPayProfile(
    month,
    !preview &&
      parsed.status === "valid" &&
      ready &&
      error === null &&
      profile !== null &&
      !blocked,
    { preserveDraft: true },
  );
  const scrollRef = useRef<ScrollView>(null);
  const firstSetup = preview || data.timeline.length === 0;
  const readGuidePreference = !preview && data.status === "ready" && firstSetup;
  const [showGuide, setShowGuide] = useState<boolean | null>(null);
  useEffect(() => {
    if (!readGuidePreference) return;
    let active = true;
    void loadNetPayGuideSkipped(db).then(
      (skipped) => {
        if (active) setShowGuide(!skipped);
      },
      () => {
        if (active) setShowGuide(false);
      },
    );
    return () => {
      active = false;
    };
  }, [db, readGuidePreference]);

  function backToForecast() {
    if (router.canGoBack()) router.back();
    else router.replace(netPayForecastRoute(month));
  }

  if (parsed.status !== "valid") {
    return (
      <LoadFailureView
        title="Netto-Einstellungen können nicht geöffnet werden"
        message="Der Link enthält keinen gültigen Monat."
        actionLabel="Zurück zur Netto-Prognose"
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
        actionLabel="Zurück zur Netto-Prognose"
        onRetry={backToForecast}
      />
    );
  }
  if (!preview) {
    if (!ready || profile === null || data.status === "loading") return <LoadingView />;
    if (data.status === "error") {
      return <LoadFailureView message={data.error!} onRetry={data.reload} />;
    }
    if (firstSetup && showGuide === null) return <LoadingView />;
  }
  return (
    <NetPaySetupForm
      key={`${month}:${preview}`}
      month={month}
      initial={preview ? null : (data.saved?.settings ?? null)}
      firstSetup={firstSetup}
      worksInSaxony={work?.federalState === "SN"}
      churchTaxDefaultPercent={work?.federalState === "BY" || work?.federalState === "BW" ? 8 : 9}
      busy={!preview && data.busy}
      onSave={preview ? discardPreviewChanges : data.save}
      onSaved={backToForecast}
      onSkipGuide={
        preview
          ? discardPreviewChanges
          : firstSetup && showGuide
            ? async () => {
                await saveNetPayGuideSkipped(db);
                setShowGuide(false);
              }
            : undefined
      }
      onValidationFailure={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
      renderLayout={({ content, headerAction, guideStep, onGuideBack }) => (
        <>
          <Stack.Screen
            options={{
              title: preview ? "Netto-Fragen testen" : "Netto-Einstellungen",
              gestureEnabled: !onGuideBack,
              ...pageBackButtonOptions(
                onGuideBack ?? backToForecast,
                onGuideBack
                  ? "Zum vorherigen Schritt"
                  : preview
                    ? "Zurück"
                    : "Zurück zur Netto-Prognose",
                true,
              ),
            }}
          />
          {headerAction ? (
            <Stack.Toolbar placement="right">
              <Stack.Toolbar.View hidesSharedBackground>{headerAction}</Stack.Toolbar.View>
            </Stack.Toolbar>
          ) : null}
          <NetPaySettingsLayout key={guideStep ?? "settings"} scrollRef={scrollRef}>
            {content}
          </NetPaySettingsLayout>
        </>
      )}
    />
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
