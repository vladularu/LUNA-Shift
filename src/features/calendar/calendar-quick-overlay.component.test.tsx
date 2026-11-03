import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import { Animated, Pressable, Text } from "react-native";
import { STARTUP_SPLASH_FADE_MS, startupPresentation } from "@/infrastructure/startup-presentation";
import { CalendarQuickOverlay } from "./calendar-quick-overlay";

beforeEach(() => {
  startupPresentation.complete();
});
afterEach(() => {
  startupPresentation.complete();
  jest.restoreAllMocks();
});

function overlay() {
  return (
    <CalendarQuickOverlay modal={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dienstplan bearbeiten">
        <Text>+</Text>
      </Pressable>
    </CalendarQuickOverlay>
  );
}

it("keeps the window overlay invisible and inaccessible until the initial calendar is ready", async () => {
  const fade = jest.spyOn(Animated, "timing");
  startupPresentation.begin();
  const screen = await render(overlay());
  const container = screen.getByTestId("calendar-quick-overlay", { includeHiddenElements: true });
  expect(container).toHaveStyle({ opacity: 0 });
  expect(container.props.pointerEvents).toBe("none");
  expect(screen.queryByRole("button", { name: "Dienstplan bearbeiten" })).toBeNull();
  await act(async () => startupPresentation.complete());
  expect(screen.getByRole("button", { name: "Dienstplan bearbeiten" })).toBeTruthy();
  expect(screen.getByTestId("calendar-quick-overlay").props.pointerEvents).toBe("box-none");
  // Jest's native-driver mock does not advance Animated.Value on the UI thread.
  expect(fade).toHaveBeenCalledWith(
    expect.any(Animated.Value),
    expect.objectContaining({
      toValue: 1,
      duration: STARTUP_SPLASH_FADE_MS,
      useNativeDriver: true,
    }),
  );
});

it("shows the controls immediately on later calendar navigation", async () => {
  const screen = await render(overlay());
  expect(screen.getByTestId("calendar-quick-overlay")).toHaveStyle({ opacity: 1 });
  expect(screen.getByRole("button", { name: "Dienstplan bearbeiten" })).toBeTruthy();
});
