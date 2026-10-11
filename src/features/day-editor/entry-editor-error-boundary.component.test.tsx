import { fireEvent, waitFor } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router, Stack } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { useLayoutEffect } from "react";
import { Pressable, Text } from "react-native";

import { EntryEditorErrorBoundary } from "@/features/day-editor/entry-editor-error-boundary";

Object.assign(jest.requireMock<Record<string, unknown>>("react-native-reanimated"), {
  useReducedMotion: () => false,
});

let mockEditorError = true;
let mockErrorPhase: "render" | "mount" = "render";
const errorMessage = "[Worklets] Cannot copy value of type `SlideInDown`.";

function Home() {
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => router.push("/shift-editor")}>
        <Text>Dienst öffnen</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push("/appointment-editor")}>
        <Text>Termin öffnen</Text>
      </Pressable>
    </>
  );
}

function Editor() {
  useLayoutEffect(() => {
    if (mockEditorError && mockErrorPhase === "mount") throw new Error(errorMessage);
  }, []);
  if (mockEditorError && mockErrorPhase === "render") throw new Error(errorMessage);
  return <Text>Editor geöffnet</Text>;
}

function renderEditorRoutes() {
  return renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      index: Home,
      "shift-editor": { default: Editor, ErrorBoundary: EntryEditorErrorBoundary },
      "appointment-editor": { default: Editor, ErrorBoundary: EntryEditorErrorBoundary },
    },
    { initialUrl: "/" },
  );
}

describe.each(["render", "mount"] as const)("entry editor route %s error recovery", (phase) => {
  beforeEach(() => {
    mockEditorError = true;
    mockErrorPhase = phase;
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(["Dienst", "Termin"])(
    "shows an opening error and closes the %s route safely",
    async (kind) => {
      const screen = await renderEditorRoutes();
      await fireEvent.press(screen.getByRole("button", { name: `${kind} öffnen` }));
      expect(await screen.findByText("Editor konnte nicht geöffnet werden")).toBeTruthy();
      expect(screen.getByText(errorMessage)).toHaveProp("selectable", true);
      await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: `${kind} öffnen` })).toBeTruthy(),
      );
      expect(screen.queryByText(errorMessage)).toBeNull();
    },
  );

  it.each(["Dienst", "Termin"])(
    "retries the failed %s route after the error is resolved",
    async (kind) => {
      const screen = await renderEditorRoutes();
      await fireEvent.press(screen.getByRole("button", { name: `${kind} öffnen` }));
      expect(await screen.findByText(errorMessage)).toBeTruthy();
      mockEditorError = false;
      await fireEvent.press(screen.getByRole("button", { name: "Erneut versuchen" }));
      expect(await screen.findByText("Editor geöffnet")).toBeTruthy();
      expect(screen.queryByText(errorMessage)).toBeNull();
    },
  );
});
