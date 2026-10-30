import { render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { useRef } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import * as Reanimated from "react-native-reanimated";
import { PrototypeDates, PrototypeMonthContent } from "./calendar-prototype-canvas";
import { calendarPrototypeLayout } from "./calendar-prototype-layout";

jest.mock("react-native-reanimated", () => {
  const actual =
    jest.requireActual<typeof import("react-native-reanimated")>("react-native-reanimated");
  return { ...actual, __esModule: true, useAnimatedStyle: jest.fn(actual.useAnimatedStyle) };
});

function Month({
  width = 430,
  height,
  topInset = 0,
  position = 1,
}: {
  width?: number;
  height: number;
  topInset?: number;
  position?: number;
}) {
  const progress = Reanimated.useSharedValue(position);
  const layout = calendarPrototypeLayout("2026-10", width, height, topInset);
  return (
    <>
      <PrototypeMonthContent
        layout={layout}
        progress={progress}
        entriesByDate={new Map()}
        holidays={new Map()}
        visible
        display={{ labelMode: "FULL", showShiftTimes: false, showShiftDuration: false }}
        timeZone="Europe/Berlin"
      />
      <PrototypeDates layout={layout} progress={progress} currentDate="2026-10-30" />
    </>
  );
}

function translation(style: ViewStyle, axis: "translateX" | "translateY") {
  const transform = style.transform;
  if (!Array.isArray(transform)) return 0;
  return transform.reduce((sum, item) => sum + (axis in item ? Number(item[axis]) : 0), 0);
}

afterEach(() => {
  jest
    .mocked(Reanimated.useAnimatedStyle)
    .mockImplementation(
      jest.requireActual<typeof import("react-native-reanimated")>("react-native-reanimated")
        .useAnimatedStyle,
    );
});

describe("settled calendar geometry", () => {
  it("keeps every date aligned with its entry cell when a native animation frame survives a resize", async () => {
    // Retain the first UI-thread transform, as can happen while native layout catches up.
    const useNativeAnimatedStyle =
      jest.requireActual<typeof import("react-native-reanimated")>(
        "react-native-reanimated",
      ).useAnimatedStyle;
    jest.mocked(Reanimated.useAnimatedStyle).mockImplementation(function useRetainedFrame(updater) {
      const initialUpdater = useRef(updater).current;
      return useNativeAnimatedStyle(initialUpdater, []);
    });
    const screen = await render(<Month height={640} />);
    for (const size of [
      { width: 430, height: 640, topInset: 0 },
      { width: 393, height: 780, topInset: 96 },
      { width: 430, height: 580, topInset: 140 },
    ]) {
      await screen.rerender(<Month {...size} />);
      const layout = calendarPrototypeLayout("2026-10", size.width, size.height, size.topInset);
      for (const day of layout.days) {
        const node = screen.getByTestId("calendar-date-marker-" + day.date, {
          includeHiddenElements: true,
        });
        const marker = {
          ...StyleSheet.flatten(node.props.style),
          ...Reanimated.getAnimatedStyle(node),
        };
        const cell = StyleSheet.flatten(
          screen.getByTestId("calendar-combined-day-" + day.date).props.style,
        );
        expect((marker.left ?? 0) + translation(marker, "translateX") + 15).toBeCloseTo(
          cell.left + cell.width / 2,
        );
        expect((marker.top ?? 0) + translation(marker, "translateY")).toBeCloseTo(cell.top);
      }
    }
  });

  it.each([0, 0.35, 1])("preserves the year-to-month path at progress %s", async (position) => {
    const screen = await render(<Month height={700} topInset={96} position={position} />);
    const layout = calendarPrototypeLayout("2026-10", 430, 700, 96);
    for (const day of layout.days) {
      const node = screen.getByTestId("calendar-date-marker-" + day.date, {
        includeHiddenElements: true,
      });
      const marker = {
        ...StyleSheet.flatten(node.props.style),
        ...Reanimated.getAnimatedStyle(node),
      };
      expect((marker.left ?? 0) + translation(marker, "translateX")).toBeCloseTo(
        day.fromX + (day.toX - day.fromX) * position - 15,
      );
      expect((marker.top ?? 0) + translation(marker, "translateY")).toBeCloseTo(
        day.fromY + (day.toY - day.fromY) * position - 15 - 5 * position,
      );
    }
  });
});
