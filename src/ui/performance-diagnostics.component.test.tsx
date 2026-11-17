import { act, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { AppState, Platform } from "react-native";
import { calendarPerformance } from "@/application/calendar-performance";
import { navigationPerformance } from "@/application/navigation-performance";
import { PerformanceDiagnostics } from "./performance-diagnostics";
let mockSegments = ["(tabs)", "(calendar)", "index"];
let mockAvailable = true;
let mockCallback: (frame: {
  timestamp: number;
  timeSincePreviousFrame: number | null;
  timeSinceFirstFrame: number;
}) => void;
const mockControl = { setActive: jest.fn(), isActive: false, callbackId: 1 };
jest.mock("expo-router", () => ({ useSegments: () => mockSegments }));
jest.mock("@/infrastructure/dev-tools-policy", () => ({
  get DEV_TOOLS_AVAILABLE() {
    return mockAvailable;
  },
}));
jest.mock("react-native-screens", () => ({
  FullWindowOverlay: ({ children }: { children: import("react").ReactNode }) => children,
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 48 }) }));
jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual<typeof import("react-native-reanimated")>("react-native-reanimated"),
  useFrameCallback: (fn: typeof mockCallback) => {
    mockCallback = fn;
    return mockControl;
  },
  runOnJS: (fn: unknown) => fn,
}));
const tick = (timestamp: number, gap: number | null) =>
  mockCallback({ timestamp, timeSincePreviousFrame: gap, timeSinceFirstFrame: timestamp - 100 });
describe("app-wide performance diagnosis", () => {
  afterEach(() => {
    calendarPerformance.clear();
    navigationPerformance.clear();
    navigationPerformance.setVisible(true);
    mockAvailable = true;
    mockSegments = ["(tabs)", "(calendar)", "index"];
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it("keeps frame windows across tabs and a hidden overlay; fences callbacks after stop", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const lifecycle = jest.spyOn(AppState, "addEventListener");
    const screen = await render(<PerformanceDiagnostics />);
    expect(mockControl.setActive).toHaveBeenLastCalledWith(false);
    await act(async () => calendarPerformance.start(true));
    await act(async () => lifecycle.mock.calls.at(-1)![1]("active"));
    expect(screen.getByTestId("performance-overlay")).toBeTruthy();
    await act(async () => {
      tick(100, null);
      tick(300, 200);
    });
    const activations = mockControl.setActive.mock.calls.length;
    mockSegments = ["(tabs)", "(analysis)", "analysis"];
    await screen.rerender(<PerformanceDiagnostics />);
    expect(mockControl.setActive.mock.calls.length).toBe(activations);
    await act(async () => tick(600, 300));
    expect(navigationPerformance.report().windows[0]).toMatchObject({
      duration: 500,
      count: 2,
      maximum: 300,
      screen: 2,
    });
    expect(navigationPerformance.report().changes.map((c) => c.to)).toEqual([1, 2]);
    await fireEvent.press(screen.getByLabelText("Diagnoseanzeige ausblenden"));
    expect(screen.queryByTestId("performance-overlay")).toBeNull();
    await act(async () => tick(1100, 500));
    expect(navigationPerformance.report().windows).toHaveLength(2);
    await act(async () => calendarPerformance.stop());
    await act(async () => tick(1600, 500));
    expect(navigationPerformance.report().windows).toHaveLength(2);
    await screen.unmount();
  });
  it("excludes background gaps and expires away from the settings screen", async () => {
    jest.useFakeTimers();
    const expiry = jest.spyOn(global, "setTimeout");
    jest.replaceProperty(Platform, "OS", "ios");
    const lifecycle = jest.spyOn(AppState, "addEventListener");
    const screen = await render(<PerformanceDiagnostics />);
    await act(async () => calendarPerformance.start(true));
    await act(async () => lifecycle.mock.calls.at(-1)![1]("active"));
    await act(async () => {
      tick(100, null);
      tick(600, 500);
    });
    await act(async () => lifecycle.mock.calls.at(-1)![1]("background"));
    expect(mockControl.setActive).toHaveBeenLastCalledWith(false);
    await act(async () => tick(5600, 5000));
    expect(navigationPerformance.report().windows).toHaveLength(1);
    await act(async () => lifecycle.mock.calls.at(-1)![1]("active"));
    await act(async () => {
      tick(6000, null);
      tick(6500, 500);
    });
    expect(navigationPerformance.report().windows[1].duration).toBe(500);
    const stop = expiry.mock.calls.find(([, delay]) => delay === 600_000)?.[0];
    expect(typeof stop).toBe("function");
    await act(async () => {
      if (typeof stop === "function") stop();
    });
    expect(calendarPerformance.getSnapshot()).toBe(0);
    expect(mockControl.setActive).toHaveBeenLastCalledWith(false);
    await screen.unmount();
  });
  it("does not mount a sampler in production", async () => {
    mockAvailable = false;
    mockControl.setActive.mockClear();
    const screen = await render(<PerformanceDiagnostics />);
    expect(mockControl.setActive).not.toHaveBeenCalled();
    expect(screen.queryByTestId("performance-overlay")).toBeNull();
    await screen.unmount();
  });
  it("measures a 60-Hz window starting at timestamp zero and records JS stalls", async () => {
    jest.useFakeTimers();
    jest.replaceProperty(Platform, "OS", "ios");
    const lifecycle = jest.spyOn(AppState, "addEventListener");
    const screen = await render(<PerformanceDiagnostics />);
    await act(async () => calendarPerformance.start(true));
    await act(async () => lifecycle.mock.calls.at(-1)![1]("active"));
    await act(async () => {
      tick(0, null);
      for (let i = 1; i <= 30; i++) tick(i * (1000 / 60), 1000 / 60);
    });
    expect(navigationPerformance.getSnapshot().fps).toBeCloseTo(60);
    expect(navigationPerformance.report().windows[0].missed60).toBe(0);
    jest.spyOn(performance, "now").mockReturnValue(performance.now() + 1000);
    await act(async () => jest.advanceTimersByTime(100));
    expect(navigationPerformance.getSnapshot().jsLag).toBeGreaterThan(800);
    await screen.unmount();
  });
});
