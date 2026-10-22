import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import { StartupRoutePresentation } from "./startup-route-presentation";

let mockSegments: readonly string[] = [];
jest.mock("expo-router", () => ({ useSegments: () => mockSegments }));
beforeEach(() => {
  startupPresentation.begin();
  jest.spyOn(global, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});
afterEach(() => {
  startupPresentation.complete();
  jest.restoreAllMocks();
});
it.each([[], ["(tabs)"], ["(tabs)", "(calendar)", "index"]])(
  "leaves the first calendar presentation to its positioned page: %j",
  async (...segments) => {
    mockSegments = segments;
    const screen = await render(<StartupRoutePresentation />);
    expect(startupPresentation.isReady()).toBe(false);
    await screen.unmount();
  },
);
it.each([["onboarding"], ["sharing-invite"], ["widget-day"], ["(tabs)", "(analysis)"]])(
  "releases other cold-start entry routes: %j",
  async (...segments) => {
    mockSegments = segments;
    const screen = await render(<StartupRoutePresentation />);
    expect(startupPresentation.isReady()).toBe(true);
    await screen.unmount();
  },
);
