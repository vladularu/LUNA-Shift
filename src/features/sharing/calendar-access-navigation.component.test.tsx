import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent } from "@testing-library/react-native";
import { router, Stack } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Alert } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import CalendarAccessRoute from "../../../app/calendar-access";
import { horizontalBackGestureOptions } from "@/navigation/horizontal-back-gesture";
import { controller, own, foreign } from "@/testing/sharing-fixtures";
import { CalendarSharingScreen } from "./calendar-sharing-screen";
import { SharingUiProvider } from "./sharing-ui-provider";

Object.assign(jest.requireMock<Record<string, unknown>>("react-native-reanimated"), {
  useReducedMotion: () => false,
});

let current = controller({ calendars: [own] });
function Layout() {
  return (
    <SafeAreaInsetsContext.Provider value={{ top: 0, bottom: 0, left: 0, right: 0 }}>
      <SharingUiProvider controller={current}>
        <Stack
          screenOptions={({ route }) => ({
            ...horizontalBackGestureOptions(route.name),
            headerBackButtonDisplayMode: "minimal",
          })}
        />
      </SharingUiProvider>
    </SafeAreaInsetsContext.Provider>
  );
}
function Overview() {
  return <CalendarSharingScreen controller={current} />;
}
const routes = {
  _layout: Layout,
  index: Overview,
  more: Overview,
  "calendar-sharing": Overview,
  "calendar-access": CalendarAccessRoute,
};
beforeEach(() => {
  current = controller({ calendars: [own, foreign] });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("calendar access with real Expo Router navigation", () => {
  it.each(["/", "/more"])(
    "pushes a member page from %s and returns with the shared back footer",
    async (initialUrl) => {
      const screen = await renderRouter(routes, { initialUrl });
      const couldGoBack = router.canGoBack();
      await fireEvent.press(screen.getByRole("button", { name: "Kalenderzugriff für Kim" }));
      await screen.findByTestId("calendar-access-screen");
      expect(router.canGoBack()).toBe(true);
      expect(screen.getByTestId("back-footer-surface")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Zurück zur Übersicht" })).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Zurück zur Übersicht" }));
      expect(screen.queryByTestId("calendar-access-screen")).toBeNull();
      expect(screen.getByRole("button", { name: "Kalenderzugriff für Kim" })).toBeTruthy();
      expect(router.canGoBack()).toBe(couldGoBack);
      expect(current.setMember).not.toHaveBeenCalled();
      expect(current.setMemberRights).toBeUndefined();
    },
  );
  it("supports stack back from member access without changing permissions", async () => {
    const screen = await renderRouter(routes);
    await fireEvent.press(screen.getByRole("button", { name: "Kalenderzugriff für Kim" }));
    await screen.findByTestId("calendar-access-screen");
    await act(async () => router.back());
    expect(screen.queryByTestId("calendar-access-screen")).toBeNull();
    expect(screen.getByRole("button", { name: "Neue Einladung" })).toBeTruthy();
    expect(current.setMember).not.toHaveBeenCalled();
  });
  it.each([
    "/calendar-access?calendarId=foreign&memberId=active",
    "/calendar-access?calendarId=own&calendarId=foreign&memberId=active",
  ])(
    "keeps unavailable or invalid access routes read-only and provides a return: %s",
    async (initialUrl) => {
      const screen = await renderRouter(routes, { initialUrl });
      expect(screen.getByText("Diese Freigabe ist nicht mehr verfügbar.")).toBeTruthy();
      expect(screen.queryByRole("switch", { name: "Profilbild teilen" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Zugriff entfernen" })).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Zurück zur Übersicht" }));
      expect(screen.queryByTestId("calendar-access-screen")).toBeNull();
      expect(current.setMember).not.toHaveBeenCalled();
    },
  );
});

it.each(["signedOut", "unavailable"] as const)(
  "does not expose cached member controls when sharing is %s",
  async (status) => {
    current = controller({ status, calendars: [own] });
    const screen = await renderRouter(routes, {
      initialUrl: "/calendar-access?calendarId=own&memberId=active",
    });
    expect(screen.getByText("Diese Freigabe ist nicht mehr verfügbar.")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Profilbild teilen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zugriff entfernen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zurück zur Übersicht" })).toBeTruthy();
    expect(current.setMember).not.toHaveBeenCalled();
  },
);

it("shows save progress in the native header while keeping the member controls and back footer mounted", async () => {
  current = controller({ busy: true, calendars: [own] });
  const screen = await renderRouter(routes, {
    initialUrl: "/calendar-access?calendarId=own&memberId=active",
  });
  expect(screen.getByLabelText("Zugriff wird gespeichert")).toBeTruthy();
  expect(screen.queryByLabelText("Wird bearbeitet")).toBeNull();
  expect(screen.getByRole("switch", { name: "Profilbild teilen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Zurück zur Übersicht" })).toBeEnabled();
});
