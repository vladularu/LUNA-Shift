import { useState } from "react";
import { act, fireEvent, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router, Stack } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { AccessibilityInfo, Dimensions, Platform, Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { horizontalBackGestureOptions } from "@/navigation/horizontal-back-gesture";
import { MINIMUM_TOUCH_TARGET, SCREEN_LAYOUT, SPACING } from "@/theme/tokens";

import { pageBackButtonOptions } from "./native-page-header";
import {
  pageStackHeaderOptions,
  PageStackScrollEdges,
  pageStackScrollLayout,
} from "./page-stack-header";
import { ScreenScrollView } from "./screen-layout";

const mockProvider = ({ children }: React.PropsWithChildren) => children;
const mockUseRef = () => undefined;
let mockSoftEdge = false;
jest.mock("@/ui/native-scroll-edge", () => ({
  get nativeScrollEdge() {
    return mockSoftEdge
      ? {
          ScrollEdgeEffectProvider: mockProvider,
          ScrollEdgeEffect: jest.requireActual<typeof import("react-native")>("react-native").View,
          useScrollEdgeEffectRef: mockUseRef,
        }
      : null;
  },
}));

jest.mock("expo-glass-effect", () => ({
  GlassView: (props: Record<string, unknown>) =>
    jest
      .requireActual<typeof import("react")>("react")
      .createElement(jest.requireActual<typeof import("react-native")>("react-native").View, {
        ...props,
        testID: "native-header-glass",
      }),
  isGlassEffectAPIAvailable: () => true,
  isLiquidGlassAvailable: () => true,
}));

const mockSave = jest.fn();

function Layout() {
  return (
    <SafeAreaInsetsContext.Provider value={{ top: 62, bottom: 34, left: 0, right: 0 }}>
      <Stack
        layout={({ children }) => <PageStackScrollEdges>{children}</PageStackScrollEdges>}
        screenLayout={pageStackScrollLayout}
        screenOptions={({ route }) => ({
          ...horizontalBackGestureOptions(route.name),
          ...pageBackButtonOptions(),
          ...pageStackHeaderOptions(route.name),
        })}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaInsetsContext.Provider>
  );
}

function Home({
  href = "/calendar-design",
}: {
  readonly href?: "/calendar-design" | "/settings-editor";
} = {}) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(href)}>
      <Text>Seite öffnen</Text>
    </Pressable>
  );
}

function Editor({
  toolbar,
  scroll = false,
}: {
  readonly toolbar: boolean;
  readonly scroll?: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  const save = (
    <Pressable accessibilityRole="button" disabled={!dirty} onPress={mockSave}>
      <Text>Speichern</Text>
    </Pressable>
  );
  const field = (
    <Pressable accessibilityRole="button" onPress={() => setDirty(true)}>
      <Text>Eingabe ändern</Text>
    </Pressable>
  );
  return (
    <>
      <Stack.Screen
        options={{
          title: "Kalender gestalten",
          headerTitleStyle: { fontSize: 17 },
          headerRight: toolbar ? undefined : () => save,
        }}
      />
      {toolbar ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.View hidesSharedBackground>{save}</Stack.Toolbar.View>
        </Stack.Toolbar>
      ) : null}
      {scroll ? <ScreenScrollView testID="stack-page-scroll">{field}</ScreenScrollView> : field}
    </>
  );
}

describe("page header inside the native screen", () => {
  beforeEach(() => {
    jest.mocked(AccessibilityInfo.isReduceTransparencyEnabled).mockResolvedValue(false);
  });

  it.each([false, true])(
    "keeps native glass, dynamic save and back navigation with toolbar=%s",
    async (toolbar) => {
      const screen = await renderRouter({
        _layout: Layout,
        index: Home,
        "calendar-design": () => <Editor toolbar={toolbar} />,
      });
      await fireEvent.press(screen.getByRole("button", { name: "Seite öffnen" }));
      await waitFor(() => expect(screen.getByTestId("page-stack-header")).toBeTruthy());
      const header = within(screen.getByTestId("page-stack-header"));
      expect(header.getByText("Kalender gestalten")).toBeTruthy();
      expect(header.getByTestId("native-header-glass").props.glassEffectStyle).toBe("regular");
      expect(header.getByRole("button", { name: "Zurück" })).toHaveStyle({ width: 44, height: 44 });
      expect(header.getByRole("button", { name: "Speichern" })).toBeDisabled();

      await fireEvent.press(screen.getByRole("button", { name: "Eingabe ändern" }));
      await waitFor(() => expect(header.getByRole("button", { name: "Speichern" })).toBeEnabled());
      await fireEvent.press(header.getByRole("button", { name: "Speichern" }));
      expect(mockSave).toHaveBeenCalledTimes(1);
      await fireEvent.press(header.getByRole("button", { name: "Zurück" }));
      await act(async () => {});
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Seite öffnen" })).toBeTruthy(),
      );
    },
  );

  it.each(["calendar-design", "settings-editor"] as const)(
    "keeps the header actions accessible with the native soft edge in %s",
    async (route) => {
      const originalWindow = Dimensions.get("window");
      mockSoftEdge = true;
      try {
        await act(() => Dimensions.set({ window: { ...originalWindow, fontScale: 1 } }));
        const isCalendar = route === "calendar-design";
        expect(pageStackHeaderOptions(route)?.headerTransparent).toBe(true);
        const screen = await renderRouter({
          _layout: Layout,
          index: () => <Home href={`/${route}`} />,
          [route]: () => <Editor toolbar={!isCalendar} scroll />,
        });
        await fireEvent.press(screen.getByRole("button", { name: "Seite öffnen" }));
        const edge = await screen.findByTestId(
          isCalendar ? "report-scroll-edge" : "soft-scroll-edge",
        );
        const headerView = screen.getByTestId("page-stack-header");
        const header = within(headerView);
        expect(edge).toHaveProp("effect", "soft");
        if (isCalendar) {
          const overlay = screen.getByTestId("report-scroll-header-content");
          expect(within(overlay).getByTestId("page-stack-header")).toBe(headerView);
          expect(within(overlay).queryByTestId("stack-page-scroll")).toBeNull();
          expect(headerView).toHaveStyle({
            height: 62 + MINIMUM_TOUCH_TARGET + SPACING.md + SCREEN_LAYOUT.contentTopPadding,
            paddingTop: 62,
          });
          expect(header.getByTestId("report-scroll-edge")).toBe(edge);
          expect(within(edge).getByText("Kalender gestalten")).toBeTruthy();
          expect(within(edge).getByRole("button", { name: "Zurück" })).toBeEnabled();
          expect(within(edge).getByTestId("calendar-design-header-gap")).toHaveStyle({
            height: SCREEN_LAYOUT.contentTopPadding + SPACING.xxl,
          });
        } else {
          expect(within(edge).getByTestId("page-stack-header")).toBe(headerView);
        }
        expect(header.getByRole("button", { name: "Zurück" })).toBeEnabled();
        await waitFor(() =>
          expect(header.getByRole("button", { name: "Speichern" })).toBeDisabled(),
        );
        await fireEvent.press(screen.getByRole("button", { name: "Eingabe ändern" }));
        await waitFor(() =>
          expect(header.getByRole("button", { name: "Speichern" })).toBeEnabled(),
        );
        await fireEvent.press(header.getByRole("button", { name: "Zurück" }));
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "Seite öffnen" })).toBeTruthy(),
        );
      } finally {
        mockSoftEdge = false;
        await act(() => Dimensions.set({ window: originalWindow }));
      }
    },
  );

  it("leaves native sheet and vertical-editor headers alone", () => {
    for (const route of ["day-details", "info-details", "check-issue", "day-editor", "quick-add"])
      expect(pageStackHeaderOptions(route)).toBeUndefined();
  });

  it("contains complete glass controls below a Dynamic Island safe area and grows with text", async () => {
    const originalWindow = Dimensions.get("window");
    try {
      await act(() => Dimensions.set({ window: { ...originalWindow, fontScale: 1 } }));
      const screen = await renderRouter({
        _layout: Layout,
        index: Home,
        "calendar-design": () => <Editor toolbar={false} />,
      });
      await fireEvent.press(screen.getByRole("button", { name: "Seite öffnen" }));
      const height = () =>
        StyleSheet.flatten(screen.getByTestId("page-stack-header").props.style).height as number;
      const regularHeight = height();
      expect(regularHeight - 62).toBeGreaterThanOrEqual(44 + 12);
      await act(() => Dimensions.set({ window: { ...originalWindow, fontScale: 3 } }));
      await waitFor(() => expect(height()).toBeGreaterThan(regularHeight));
      expect(height() - 62).toBeGreaterThanOrEqual(17 * 3);
    } finally {
      await act(() => Dimensions.set({ window: originalWindow }));
    }
  });

  it("keeps Android on its existing native header", () => {
    const platform = jest.replaceProperty(Platform, "OS", "android");
    try {
      expect(pageStackHeaderOptions("calendar-design")).toBeUndefined();
    } finally {
      platform.restore();
    }
  });
});
