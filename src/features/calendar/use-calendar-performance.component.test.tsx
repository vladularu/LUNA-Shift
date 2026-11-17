import { act, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { AppState } from "react-native";
import { calendarPerformance } from "@/application/calendar-performance";
import { useCalendarPerformance } from "./use-calendar-performance";
let mockCallback: (frame: {
  timestamp: number;
  timeSincePreviousFrame: number | null;
  timeSinceFirstFrame: number;
}) => void;
const mockControl = { setActive: jest.fn(), isActive: false, callbackId: 1 };
jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual<typeof import("react-native-reanimated")>("react-native-reanimated"),
  useFrameCallback: (fn: typeof mockCallback) => {
    mockCallback = fn;
    return mockControl;
  },
  runOnJS: (fn: unknown) => fn,
}));

describe("calendar UI cadence probe", () => {
  afterEach(() => {
    calendarPerformance.clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it("retains frame windows through rerenders and stops JS probes in the background", async () => {
    jest.useFakeTimers();
    const intervals = jest.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval");
    const lifecycle = jest.spyOn(AppState, "addEventListener");
    let clock = 0;
    jest.spyOn(performance, "now").mockImplementation(() => clock);
    function Probe({ month }: { month: string }) {
      useCalendarPerformance(true, month, "MONTH");
      return null;
    }
    const screen = await render(<Probe month="2026-01" />);
    await act(async () => calendarPerformance.start(true));
    await act(async () => lifecycle.mock.calls.at(-1)![1]("active"));
    await act(async () => {
      mockCallback({ timestamp: 100, timeSincePreviousFrame: null, timeSinceFirstFrame: 0 });
      for (let i = 1; i <= 30; i++)
        mockCallback({
          timestamp: 100 + i * 20,
          timeSincePreviousFrame: 20,
          timeSinceFirstFrame: i * 20,
        });
    });
    const activations = mockControl.setActive.mock.calls.length;
    await screen.rerender(<Probe month="2026-02" />);
    expect(mockControl.setActive.mock.calls).toHaveLength(activations);
    await act(async () => {
      for (let i = 31; i <= 50; i++)
        mockCallback({
          timestamp: 100 + i * 20,
          timeSincePreviousFrame: 20,
          timeSinceFirstFrame: i * 20,
        });
      clock = 180;
      jest.advanceTimersByTime(100);
    });
    const events = calendarPerformance.report().events;
    expect(events.filter((event) => event.kind === "ui-frames")).toHaveLength(1);
    expect(
      events.filter((event) => event.kind === "ui-sampling" && event.values.phase === 2),
    ).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "calendar-lag", values: { duration: 80 } }),
    );
    await act(async () => lifecycle.mock.calls.at(-1)![1]("background"));
    const before = calendarPerformance.report().events.length;
    await act(async () => {
      clock = 1000;
      jest.advanceTimersByTime(1000);
    });
    expect(calendarPerformance.report().events).toHaveLength(before);
    await act(async () => lifecycle.mock.calls.at(-1)![1]("active"));
    const ownedTimer = intervals.mock.results.at(-1)!.value;
    await screen.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(ownedTimer);
  });
  it("samples only opted-in foreground calendar frames and batches events", async () => {
    const control = mockControl;
    const lifecycle = jest.spyOn(AppState, "addEventListener");
    function Probe() {
      useCalendarPerformance(true, "2026-01", "MONTH");
      return null;
    }
    const screen = await render(<Probe />);
    expect(control.setActive).toHaveBeenLastCalledWith(false);
    await act(async () => calendarPerformance.start(true));
    await act(async () => {
      lifecycle.mock.calls.at(-1)![1]("active");
    });
    expect(control.setActive).toHaveBeenLastCalledWith(true);
    await act(async () => {
      mockCallback({ timestamp: 100, timeSincePreviousFrame: null, timeSinceFirstFrame: 0 });
      for (let i = 1; i <= 60; i++)
        mockCallback({
          timestamp: 100 + i * 20,
          timeSincePreviousFrame: 20,
          timeSinceFirstFrame: i * 20,
        });
    });
    const frames = calendarPerformance
      .report()
      .events.filter((event) => event.kind === "ui-frames");
    expect(frames).toHaveLength(1);
    expect(frames[0].values).toMatchObject({
      count: 50,
      maximum: 20,
      over17: 50,
      over34: 0,
      over50: 0,
    });
    await act(async () => {
      lifecycle.mock.calls.at(-1)![1]("background");
    });
    expect(control.setActive).toHaveBeenLastCalledWith(false);
    await act(async () => calendarPerformance.stop());
    expect(control.setActive).toHaveBeenLastCalledWith(false);
    await screen.unmount();
  });
});
