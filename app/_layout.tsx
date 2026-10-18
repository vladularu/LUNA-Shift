import { ProfileSelectionProvider } from "@/features/settings/profile-selection";
import { PrivateCloudProvider } from "@/composition/private-cloud-provider";
import { AnalysisViewProvider } from "@/features/analysis/analysis-view-preferences";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Platform, StatusBar, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { PflegeShiftRuntimeProvider } from "@/composition/pflegeshift-runtime-provider";
import { CalendarPreferencesProvider } from "@/features/calendar/calendar-preferences";
import { CheckPreferencesProvider } from "@/features/settings/check-preferences";
import { NotificationFeedbackBridge } from "@/features/notifications/notification-feedback-bridge";
import { SecureDatabaseProvider } from "@/infrastructure/database/secure-database-provider";
import { DEV_TOOLS_AVAILABLE } from "@/infrastructure/dev-tools-policy";
import { ActiveMonthProvider } from "@/navigation/active-month";
import { MOTION } from "@/theme/motion";
import { usePalette } from "@/theme/palette";
import { AppErrorBoundary } from "@/ui/app-error-boundary";
import { FeedbackProvider } from "@/ui/feedback";
import {
  AppearancePreferencesProvider,
  useAppearancePreferences,
} from "@/features/settings/appearance-preferences";
import { LoadingView } from "@/ui/loading-view";
import { CalendarBackgroundProvider } from "@/features/settings/calendar-background-preferences";
import { INTER_FONTS } from "@/theme/shadcn";
import { TYPOGRAPHY } from "@/theme/typography";
import { entryEditorScreenOptions } from "@/features/day-editor/entry-edit-presentation";

SplashScreen.setOptions({ duration: 300, fade: true });

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [INTER_FONTS.regular]: require("../assets/fonts/inter/Inter-Regular.ttf"),
    [INTER_FONTS.medium]: require("../assets/fonts/inter/Inter-Medium.ttf"),
    [INTER_FONTS.semibold]: require("../assets/fonts/inter/Inter-SemiBold.ttf"),
    [INTER_FONTS.bold]: require("../assets/fonts/inter/Inter-Bold.ttf"),
    [INTER_FONTS.extraBold]: require("../assets/fonts/inter/Inter-ExtraBold.ttf"),
    [INTER_FONTS.italic]: require("../assets/fonts/inter/Inter-Italic.ttf"),
  });
  if (fontError) throw fontError;
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <SecureDatabaseProvider>
        <AppearancePreferencesProvider>
          <CalendarBackgroundProvider>
            <ThemedApp />
          </CalendarBackgroundProvider>
        </AppearancePreferencesProvider>
      </SecureDatabaseProvider>
    </GestureHandlerRootView>
  );
}

function ThemedApp() {
  const palette = usePalette();
  const dark = palette.dark;
  const appearance = useAppearancePreferences();
  if (!appearance.ready) return <LoadingView />;
  const navigationTheme = dark ? DarkTheme : DefaultTheme;

  return (
    <AppErrorBoundary>
      <ActiveMonthProvider>
        <CalendarPreferencesProvider>
          <PflegeShiftRuntimeProvider>
            <CheckPreferencesProvider>
              <AnalysisViewProvider>
                <AppErrorBoundary title="Ansicht konnte nicht angezeigt werden">
                  <ThemeProvider
                    value={{
                      ...navigationTheme,
                      fonts: {
                        regular: { fontFamily: INTER_FONTS.regular, fontWeight: "400" },
                        medium: { fontFamily: INTER_FONTS.medium, fontWeight: "500" },
                        bold: { fontFamily: INTER_FONTS.bold, fontWeight: "700" },
                        heavy: { fontFamily: INTER_FONTS.extraBold, fontWeight: "800" },
                      },
                      colors: {
                        ...navigationTheme.colors,
                        primary: palette.accent,
                        background: palette.background,
                        card: palette.surface,
                        text: palette.text,
                        border: palette.separator,
                        notification: palette.danger,
                      },
                    }}
                  >
                    <FeedbackProvider>
                      <NotificationFeedbackBridge />
                      <PrivateCloudProvider>
                        <ProfileSelectionProvider>
                          <Stack
                            screenOptions={{
                              headerBackButtonDisplayMode: "minimal",
                              headerShadowVisible: false,
                              headerStyle: { backgroundColor: palette.background },
                              headerTintColor: palette.text,
                              headerTitleStyle: {
                                ...TYPOGRAPHY.sectionTitle,
                                fontFamily: INTER_FONTS.semibold,
                                color: palette.text,
                              },
                              statusBarStyle: dark ? "light" : "dark",
                              headerTransparent: false,
                            }}
                          >
                            <Stack.Screen
                              name="(tabs)"
                              options={{
                                headerShown: false,
                                statusBarStyle: dark ? "light" : "dark",
                              }}
                            />
                            <Stack.Screen
                              name="onboarding"
                              options={{
                                headerShown: false,
                                presentation: "fullScreenModal",
                              }}
                            />
                            <Stack.Screen
                              name="account"
                              options={{ title: "Konto", presentation: "card" }}
                            />
                            <Stack.Screen
                              name="account-name"
                              options={{ title: "Name ändern", presentation: "card" }}
                            />
                            <Stack.Screen
                              name="calendar-sharing"
                              options={{ headerShown: false, presentation: "card" }}
                            />
                            <Stack.Screen
                              name="sharing-invite"
                              options={{ headerShown: false, presentation: "card" }}
                            />
                            <Stack.Screen
                              name="auth/callback"
                              options={{ headerShown: false, presentation: "card" }}
                            />
                            <Stack.Screen
                              name="calendar-design"
                              options={{ presentation: "card", title: "Kalender gestalten" }}
                            />
                            <Stack.Screen name="appearance" options={{ presentation: "card" }} />
                            <Stack.Screen name="work-profile" options={{ presentation: "card" }} />
                            <Stack.Screen
                              name="day-editor"
                              options={entryEditorScreenOptions(
                                Platform.OS,
                                palette.groupedBackground,
                              )}
                            />
                            <Stack.Screen
                              name="shift-editor"
                              options={entryEditorScreenOptions(
                                Platform.OS,
                                palette.groupedBackground,
                              )}
                            />
                            <Stack.Screen
                              name="appointment-editor"
                              options={entryEditorScreenOptions(
                                Platform.OS,
                                palette.groupedBackground,
                              )}
                            />
                            <Stack.Screen
                              name="day-details"
                              options={{
                                title: "Tagesdetails",
                                presentation: "formSheet",
                                contentStyle: { backgroundColor: "transparent" },
                                sheetAllowedDetents: [1],
                                sheetGrabberVisible: true,
                              }}
                            />
                            <Stack.Screen
                              name="quick-add"
                              options={{
                                headerShown: false,
                                presentation: "card",
                                animation: "slide_from_bottom",
                                animationDuration: MOTION.duration.scene,
                                contentStyle: { backgroundColor: palette.background },
                              }}
                            />
                            <Stack.Screen
                              name="calendar-view"
                              options={{
                                title: "Kalender gestalten",
                                presentation: "card",
                                contentStyle: { backgroundColor: palette.background },
                              }}
                            />
                            <Stack.Screen
                              name="info-details"
                              options={{
                                title: "Information",
                                presentation: "formSheet",
                                contentStyle: { backgroundColor: "transparent" },
                                sheetAllowedDetents: [1],
                                sheetGrabberVisible: true,
                              }}
                            />
                            <Stack.Screen
                              name="data-backup"
                              options={{
                                title: "Datensicherung",
                                presentation: "card",
                                contentStyle: { backgroundColor: palette.groupedBackground },
                              }}
                            />
                            <Stack.Screen
                              name="premium-details"
                              options={{
                                title: "Zeitzuschläge",
                                presentation: "card",
                                contentStyle: { backgroundColor: palette.groupedBackground },
                              }}
                            />
                            <Stack.Screen
                              name="compliance-details"
                              options={{
                                title: "Prüfung",
                                presentation: "card",
                                contentStyle: { backgroundColor: palette.groupedBackground },
                              }}
                            />
                            <Stack.Screen
                              name="tariff-assessment"
                              options={{
                                title: "Schichtzulage",
                                presentation: "formSheet",
                                contentStyle: { backgroundColor: "transparent" },
                                sheetAllowedDetents: [1],
                                sheetGrabberVisible: true,
                              }}
                            />
                            <Stack.Screen
                              name="profile-selection"
                              options={{ title: "Auswahl", presentation: "card" }}
                            />
                            <Stack.Screen
                              name="settings-editor"
                              options={{
                                title: "Arbeitsprofil",
                                presentation: "card",
                              }}
                            />
                            <Stack.Screen
                              name="shift-selection"
                              options={{
                                headerShown: false,
                                presentation: "formSheet",
                                sheetAllowedDetents: [1],
                                sheetGrabberVisible: true,
                                contentStyle: { backgroundColor: palette.background },
                              }}
                            />
                            <Stack.Screen
                              name="template-editor"
                              options={{
                                title: "Dienstvorlage",
                                presentation: "card",
                                contentStyle: { backgroundColor: palette.background },
                              }}
                            />
                            <Stack.Screen
                              name="location-picker"
                              options={{
                                headerShown: false,
                                presentation: "formSheet",
                                contentStyle: { backgroundColor: palette.surface },
                                sheetAllowedDetents: [1],
                                sheetCornerRadius: 28,
                                sheetExpandsWhenScrolledToEdge: false,
                                sheetGrabberVisible: false,
                                sheetInitialDetentIndex: 0,
                              }}
                            />
                            <Stack.Screen
                              name="salary"
                              options={{
                                title: "Gehalt",
                                presentation: "card",
                                headerShown: false,
                              }}
                            />
                            <Stack.Screen
                              name="salary-details"
                              options={{ presentation: "card", headerShown: false }}
                            />
                            <Stack.Screen
                              name="net-pay"
                              options={{ title: "Brutto-Netto", presentation: "card" }}
                            />
                            <Stack.Screen
                              name="worktime-details"
                              options={{ title: "Stunden", presentation: "card" }}
                            />
                            <Stack.Screen
                              name="annual-details"
                              options={{ title: "Jahresdetails", presentation: "card" }}
                            />
                            {DEV_TOOLS_AVAILABLE ? (
                              <Stack.Screen
                                name="dev-tools"
                                options={{ title: "Testlabor", presentation: "fullScreenModal" }}
                              />
                            ) : null}
                          </Stack>
                        </ProfileSelectionProvider>
                      </PrivateCloudProvider>
                    </FeedbackProvider>
                    <StatusBar
                      animated
                      barStyle={dark ? "light-content" : "dark-content"}
                      key={dark ? "dark-status" : "light-status"}
                    />
                  </ThemeProvider>
                </AppErrorBoundary>
              </AnalysisViewProvider>
            </CheckPreferencesProvider>
          </PflegeShiftRuntimeProvider>
        </CalendarPreferencesProvider>
      </ActiveMonthProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
