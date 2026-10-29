import { act, fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useState } from "react";
import { AccessibilityInfo } from "react-native";
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { State, type PanGesture } from "react-native-gesture-handler";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { getAnimatedStyle } from "react-native-reanimated";
import { CalendarImageOpacityControl } from "./calendar-image-opacity-control";

const preview = jest.fn<(value: number | null) => void>();
const commit = jest.fn<(value: number) => void>();
const mockFeedback = jest.fn();
jest.mock("@/ui/haptics", () => ({ selectionFeedback: () => mockFeedback() }));

function Harness({ initial = 50, disabled = false }: { initial?: number; disabled?: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<number | null>(null);
  return (
    <CalendarImageOpacityControl
      value={draft ?? saved}
      disabled={disabled}
      onPreview={(next) => {
        preview(next);
        setDraft(next);
      }}
      onCommit={(next) => {
        commit(next);
        setSaved(next);
        setDraft(null);
      }}
    />
  );
}
const gesture = () => getByGestureTestId("calendar-image-opacity-pan") as PanGesture;
async function open(initial = 50, disabled = false) {
  const screen = await render(<Harness initial={initial} disabled={disabled} />);
  await fireEvent(screen.getByRole("adjustable"), "layout", {
    nativeEvent: { layout: { width: 140, height: 44 } },
  });
  return screen;
}
async function start() {
  await act(async () => gesture().handlers.onStart?.({ translationX: 0 } as never));
}
async function move(translationX: number) {
  await act(async () => gesture().handlers.onUpdate?.({ translationX } as never));
}
async function finish(success = true) {
  await act(async () => {
    gesture().handlers.onEnd?.({} as never, success);
    gesture().handlers.onFinalize?.({} as never, success);
  });
}

describe("direct-touch calendar-photo opacity", () => {
  beforeEach(() => {
    preview.mockReset();
    commit.mockReset();
    mockFeedback.mockReset();
    jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(false);
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
    jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(false);
  });
  it("activates immediately on the thumb and lets touches elsewhere scroll without changing the value", async () => {
    const screen = await open();
    expect(gesture().config.activateAfterLongPress).toBeUndefined();
    expect(gesture().config.runOnJS).not.toBe(true);
    const manager = { activate: jest.fn(), fail: jest.fn() };
    await act(async () => {
      gesture().handlers.onTouchesDown?.(
        { changedTouches: [{ x: 70, y: 22 }], numberOfTouches: 1 } as never,
        manager as never,
      );
    });
    expect(manager.activate).toHaveBeenCalledTimes(1);
    await act(async () => {
      gesture().handlers.onTouchesDown?.(
        { changedTouches: [{ x: 25, y: 22 }], numberOfTouches: 1 } as never,
        manager as never,
      );
    });
    expect(manager.fail).toHaveBeenCalledTimes(1);
    await move(40);
    await act(async () => {
      gesture().handlers.onFinalize?.({ state: State.FAILED, translationY: 80 } as never, false);
    });
    expect(preview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole("adjustable").props.accessibilityValue.now).toBe(50);
  });
  it("does not jump or save when a tap ends without movement", async () => {
    await open(47);
    await start();
    await move(0);
    await move(2);
    expect(preview).not.toHaveBeenCalled();
    await finish();
    expect(commit).not.toHaveBeenCalled();
  });
  it("snaps previews to ten-percent steps without repeat feedback and commits only on release", async () => {
    const screen = await open();
    await start();
    await move(4);
    expect(preview).not.toHaveBeenCalled();
    await move(6);
    await move(13);
    await move(18);
    expect(preview.mock.calls.map(([value]) => value)).toEqual([60, 70]);
    expect(mockFeedback).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole("adjustable").props.accessibilityValue.now).toBe(70);
    await finish();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(70);
  });
  it("moves the thumb between steps while the value remains snapped", async () => {
    jest.useFakeTimers();
    try {
      const screen = await open();
      await start();
      await move(13);
      await act(async () => jest.advanceTimersByTime(32));
      expect(getAnimatedStyle(screen.getByTestId("calendar-image-opacity-thumb"))).toEqual(
        expect.objectContaining({ left: "63%" }),
      );
      expect(getAnimatedStyle(screen.getByTestId("calendar-image-opacity-fill"))).toEqual(
        expect.objectContaining({ width: "63%" }),
      );
      expect(screen.getByRole("adjustable").props.accessibilityValue.now).toBe(60);
      await finish();
      await act(async () => jest.advanceTimersByTime(2000));
      expect(commit).toHaveBeenCalledWith(60);
      expect(getAnimatedStyle(screen.getByTestId("calendar-image-opacity-thumb"))).toEqual(
        expect.objectContaining({ left: "60%" }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
  it("clamps the direct gesture to both endpoints", async () => {
    const screen = await open();
    await start();
    await move(-500);
    expect(screen.getByRole("adjustable").props.accessibilityValue.now).toBe(0);
    await move(500);
    expect(screen.getByRole("adjustable").props.accessibilityValue.now).toBe(100);
    await finish();
    expect(commit).toHaveBeenCalledWith(100);
  });
  it("cancels the draft on interruption and unmount instead of committing it", async () => {
    const screen = await open();
    await start();
    await move(20);
    await finish(false);
    expect(screen.getByRole("adjustable").props.accessibilityValue.now).toBe(50);
    expect(commit).not.toHaveBeenCalled();
    await start();
    await move(-20);
    preview.mockClear();
    await screen.unmount();
    expect(preview).toHaveBeenCalledWith(null);
    expect(commit).not.toHaveBeenCalled();
  });
  it.each([
    { action: "increment", expected: 50 },
    { action: "decrement", expected: 40 },
  ])(
    "moves an old intermediate value to the next ten-percent step with $action",
    async ({ action, expected }) => {
      const screen = await open(47);
      expect(preview).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      await fireEvent(screen.getByRole("adjustable"), "accessibilityAction", {
        nativeEvent: { actionName: action },
      });
      expect(commit).toHaveBeenCalledWith(expected);
    },
  );
  it("shows exactly one centered value without endpoint labels and keeps a 44-point target", async () => {
    const screen = await open();
    expect(screen.getAllByText(/\d+ %/, { includeHiddenElements: true })).toHaveLength(1);
    expect(
      screen.getByTestId("calendar-image-opacity-value", { includeHiddenElements: true }),
    ).toHaveStyle({ textAlign: "center" });
    expect(screen.getByRole("adjustable")).toHaveStyle({ minHeight: 44 });
  });
  it("uses an animated native-glass capsule immediately on touch when available", async () => {
    jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(true);
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(true);
    const screen = await open();
    expect(
      screen.getByTestId("calendar-image-opacity-thumb-surface").props.glassEffectStyle.style,
    ).toBe("none");
    await start();
    expect(screen.getByTestId("calendar-image-opacity-thumb-surface")).toHaveProp(
      "glassEffectStyle",
      expect.objectContaining({ style: "regular", animate: true }),
    );
    await finish();
    expect(
      screen.getByTestId("calendar-image-opacity-thumb-surface").props.glassEffectStyle.style,
    ).toBe("none");
  });
  it("keeps a solid capsule when system transparency reduction is enabled", async () => {
    jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(true);
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(true);
    jest.mocked(AccessibilityInfo.isReduceTransparencyEnabled).mockResolvedValue(true);
    const screen = await open();
    await start();
    expect(
      screen.getByTestId("calendar-image-opacity-thumb-surface").props.glassEffectStyle,
    ).toBeUndefined();
    await finish();
  });
  it("blocks both touch and accessibility changes while disabled", async () => {
    const screen = await open(50, true);
    expect(gesture().config.enabled).toBe(false);
    await start();
    await move(20);
    await finish();
    await fireEvent(screen.getByRole("adjustable"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(preview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
