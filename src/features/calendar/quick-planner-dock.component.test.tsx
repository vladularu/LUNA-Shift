import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AnimationCallback, WithTimingConfig } from "react-native-reanimated";

import type { ShiftTemplate } from "@/domain/types";
import { buildQuickEntryActions } from "@/features/calendar/quick-entry-actions";
import { QUICK_PLANNER_METRICS } from "@/features/calendar/quick-planner-appearance";
import {
  QuickPlannerDock,
  quickPlannerTransitionDuration,
} from "@/features/calendar/quick-planner-dock";
import {
  quickPlannerControlMotion,
  quickPlannerDockMotion,
} from "@/features/calendar/quick-planner-control-motion";
import { MOTION } from "@/theme/motion";
import { CALENDAR_METRICS } from "@/theme/tokens";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import {
  colorContrastRatio,
  MINIMUM_TEXT_CONTRAST,
  MINIMUM_UI_CONTRAST,
} from "@/theme/color-contrast";

let mockReducedMotion = false;
let mockTimingValue: number | undefined;
let mockCloseCompletion: AnimationCallback | undefined;
const mockCancel = jest.fn();
const mockTiming = jest.fn(
  (target: number, _config?: WithTimingConfig, complete?: AnimationCallback) => {
    if (complete) mockCloseCompletion = complete;
    return mockTimingValue ?? target;
  },
);
// Controlled UI runtime: timing calls are recorded, closing completes only when the test says so.
jest.mock("react-native-reanimated", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    ...jest.requireActual<typeof import("react-native-reanimated")>("react-native-reanimated"),
    useSharedValue: (initial: number) =>
      React.useRef({
        value: initial,
        get() {
          return this.value;
        },
        set(next: number) {
          this.value = next;
        },
      }).current,
    useAnimatedStyle: (compute: () => object) => compute(),
    useReducedMotion: () => mockReducedMotion,
    withTiming: (target: number, config?: WithTimingConfig, complete?: AnimationCallback) =>
      mockTiming(target, config, complete),
    cancelAnimation: (value: unknown) => mockCancel(value),
    runOnJS: (callback: () => void) => callback,
  };
});

jest.mock("@/ui/icon", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return function Icon({ name }: { name: string }) {
    return <Text>{name}</Text>;
  };
});

const TEMPLATE: ShiftTemplate = {
  id: "early",
  name: "Früh",
  type: "EARLY",
  startTime: "06:00",
  endTime: "14:12",
  breakMinutes: 30,
  color: "#62B94C",
  symbol: "F",
  sortOrder: 10,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revision: 1,
};

async function renderDock({
  onClose = jest.fn(),
  onOpen = jest.fn(),
  open = true,
  busy = false,
  activeKey = "template:early",
  bottomInset = 34,
  template = TEMPLATE,
}: {
  onClose?: jest.Mock;
  onOpen?: jest.Mock;
  open?: boolean;
  busy?: boolean;
  activeKey?: string | null;
  bottomInset?: number;
  template?: ShiftTemplate;
} = {}) {
  const tree = (nextOpen: boolean, active = true) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 932, width: 430, x: 0, y: 0 },
        insets: { bottom: bottomInset, left: 0, right: 0, top: 59 },
      }}
    >
      <QuickPlannerDock
        active={active}
        actions={buildQuickEntryActions([template]).slice(0, 1)}
        activeKey={activeKey}
        busy={busy}
        onOpen={onOpen}
        onClose={onClose}
        onSelectAction={jest.fn()}
        open={nextOpen}
      />
    </SafeAreaProvider>
  );
  const screen = await render(tree(open));
  return {
    ...screen,
    setOpen: (nextOpen: boolean) => screen.rerender(tree(nextOpen)),
    setActive: (active: boolean) => screen.rerender(tree(open, active)),
  };
}

describe("QuickPlannerDock", () => {
  it("shows the actual start and end only for the active template", async () => {
    const screen = await renderDock();
    expect(screen.getByText("06:00")).toBeTruthy();
    expect(screen.getByText("14:12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Früh auswählen" })).toHaveProp(
      "accessibilityValue",
      { text: "06:00 bis 14:12" },
    );
    await screen.unmount();
    const inactive = await renderDock({ activeKey: null });
    expect(inactive.queryByText("06:00")).toBeNull();
    expect(inactive.queryByText("14:12")).toBeNull();
  });

  it.each([
    [{ ...TEMPLATE, allDay: true, startTime: null, endTime: null }, "Ganztägig"],
    [{ ...TEMPLATE, allDay: false, startTime: null, endTime: null }, "Ohne Zeit"],
  ])("does not invent times for a template without a time range", async (template, label) => {
    const screen = await renderDock({ template });
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText("06:00")).toBeNull();
  });

  it("keeps the saved end time when a night shift crosses midnight", async () => {
    const screen = await renderDock({
      template: { ...TEMPLATE, startTime: "21:00", endTime: "06:00" },
    });
    expect(screen.getByText("21:00")).toBeTruthy();
    expect(screen.getByText("06:00")).toBeTruthy();
  });

  it.each([false, true])(
    "covers navigation only while planning is open (open=%s)",
    async (open) => {
      const screen = await renderDock({ open });
      const cover = screen.getByTestId("quick-planner-navigation-cover", {
        includeHiddenElements: true,
      });
      expect(cover).toHaveStyle({
        opacity: open ? 1 : 0,
        backgroundColor: LIGHT_PALETTE.background,
      });
      expect(cover).toHaveProp("pointerEvents", open ? "auto" : "none");
    },
  );

  it("keeps Plus mounted beneath the editor and reveals it immediately without another enter animation", async () => {
    const screen = await renderDock({ open: false });
    const reveal = screen.getByTestId("quick-planner-mount-reveal");
    expect(reveal.props.entering).toBeUndefined();
    mockTiming.mockClear();
    await screen.setActive(false);
    expect(screen.getByTestId("quick-planner-mount-reveal", { includeHiddenElements: true })).toBe(
      reveal,
    );
    expect(reveal).toHaveStyle({ opacity: 0 });
    expect(reveal).toHaveProp("pointerEvents", "none");
    expect(screen.queryByRole("button", { name: "Dienstplan bearbeiten" })).toBeNull();
    await screen.setActive(true);
    expect(screen.getByTestId("quick-planner-mount-reveal")).toBe(reveal);
    expect(reveal).toHaveStyle({ opacity: 1 });
    expect(screen.getByRole("button", { name: "Dienstplan bearbeiten" })).toBeTruthy();
    expect(mockTiming).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    mockReducedMotion = false;
    mockTimingValue = undefined;
    mockCloseCompletion = undefined;
    mockTiming.mockClear();
    mockCancel.mockClear();
    jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue("light");
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    "inverts open controls and inactive text against the calendar (dark=%s)",
    async (dark) => {
      jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(dark ? "dark" : "light");
      const inverse = dark ? LIGHT_PALETTE : DARK_PALETTE;
      const screen = await renderDock({ activeKey: null });
      expect(screen.getByTestId("quick-planner-dock", { includeHiddenElements: true })).toHaveStyle(
        {
          backgroundColor: inverse.surface,
        },
      );
      expect(
        screen.getByTestId("quick-planner-close-visual", { includeHiddenElements: true }),
      ).toHaveStyle({
        backgroundColor: inverse.surface,
      });
      expect(screen.getByText("Früh")).toHaveStyle({ color: inverse.text });
    },
  );
  it("keeps the pencil, dock and close action in one persistent synchronized control", async () => {
    const screen = await renderDock();
    const mountReveal = screen.getByTestId("quick-planner-mount-reveal", {
      includeHiddenElements: true,
    });
    const stack = screen.getByTestId("quick-planner-stack", { includeHiddenElements: true });
    const closeRow = screen.getByTestId("quick-planner-close-row", { includeHiddenElements: true });
    const closeTarget = screen.getByTestId("quick-planner-close-hit-target", {
      includeHiddenElements: true,
    });
    const closeVisual = screen.getByTestId("quick-planner-close-visual", {
      includeHiddenElements: true,
    });
    const dock = screen.getByTestId("quick-planner-dock", { includeHiddenElements: true });
    const pencil = screen.getByTestId("quick-planner-pencil-anchor", {
      includeHiddenElements: true,
    });
    const stackStyle = StyleSheet.flatten(stack.props.style);
    const closeRowStyle = StyleSheet.flatten(closeRow.props.style);
    const closeTargetStyle = StyleSheet.flatten(closeTarget.props.style);
    const closeVisualStyle = StyleSheet.flatten(closeVisual.props.style);
    const dockStyle = StyleSheet.flatten(dock.props.style);

    expect(stackStyle.position).toBe("absolute");
    expect(mountReveal).toContainElement(stack);
    expect(stackStyle.bottom).toBe(-24);
    expect(stackStyle.left).toBe(8);
    expect(stackStyle.right).toBe(8);
    expect(stack).toContainElement(pencil);
    expect(stack).toContainElement(closeRow);
    expect(stack).toContainElement(dock);
    expect(closeRowStyle.position).toBe("absolute");
    const pencilStyle = StyleSheet.flatten(pencil.props.style);
    expect(closeRowStyle.right + closeRowStyle.width / 2).toBe(
      pencilStyle.right + pencilStyle.width / 2,
    );
    expect(closeRowStyle.bottom + closeRowStyle.height / 2).toBe(
      pencilStyle.bottom + pencilStyle.height / 2,
    );
    expect(closeTargetStyle.width).toBe(QUICK_PLANNER_METRICS.closeTargetSize);
    expect(closeTargetStyle.height).toBe(QUICK_PLANNER_METRICS.closeTargetSize);
    expect(closeVisualStyle.width).toBe(QUICK_PLANNER_METRICS.closeVisualSize);
    expect(closeVisualStyle.height).toBe(QUICK_PLANNER_METRICS.closeVisualSize);
    expect(
      closeRowStyle.bottom + (closeTargetStyle.height - closeVisualStyle.height) / 2,
    ).toBeGreaterThanOrEqual(QUICK_PLANNER_METRICS.dockHeight);
    expect(dockStyle.height).toBe(QUICK_PLANNER_METRICS.dockHeight);
    expect(dockStyle.borderRadius).toBe(QUICK_PLANNER_METRICS.dockHeight / 2);
    expect(dockStyle.backgroundColor).toBe(DARK_PALETTE.surface);
    expect(closeVisualStyle.backgroundColor).toBe(DARK_PALETTE.surface);
    expect(screen.queryByTestId("quick-planner-dock-shell")).toBeNull();
    expect(screen.queryByText("Fertig")).toBeNull();
  });

  it.each([0, 20, 34])(
    "keeps add and close at the same resting center with bottom inset %s",
    async (bottomInset) => {
      const centers: { x: number; y: number }[] = [];
      for (const open of [false, true]) {
        const screen = await renderDock({ open, bottomInset });
        const stack = StyleSheet.flatten(screen.getByTestId("quick-planner-stack").props.style);
        const anchor = StyleSheet.flatten(
          screen.getByTestId(open ? "quick-planner-close-row" : "quick-planner-pencil-anchor").props
            .style,
        );
        centers.push({
          x: stack.right + anchor.right + anchor.width / 2,
          y: stack.bottom + anchor.bottom + anchor.height / 2,
        });
        const visualSize = open
          ? QUICK_PLANNER_METRICS.closeVisualSize
          : CALENDAR_METRICS.floatingActionSize;
        expect(anchor.bottom + anchor.height / 2 - visualSize / 2).toBeGreaterThanOrEqual(
          QUICK_PLANNER_METRICS.dockHeight + QUICK_PLANNER_METRICS.closeVisualGap,
        );
        expect(anchor.transform).toEqual([{ translateY: 0 }]);
        const target = screen.getByRole("button", {
          name: open ? "Planung beenden" : "Dienstplan bearbeiten",
        });
        expect(StyleSheet.flatten(target.props.style).width).toBeGreaterThanOrEqual(44);
        expect(StyleSheet.flatten(target.props.style).height).toBeGreaterThanOrEqual(44);
        await screen.unmount();
      }
      expect(centers[1]).toEqual(centers[0]);
    },
  );

  it.each([false, true])(
    "exposes only the current control to VoiceOver (open=%s)",
    async (open) => {
      const screen = await renderDock({ open });
      expect(screen.queryByRole("button", { name: "Planung beenden" }) !== null).toBe(open);
      expect(screen.queryByRole("button", { name: "Dienstplan bearbeiten" }) !== null).toBe(!open);
      expect(screen.queryByRole("button", { name: "Früh auswählen" }) !== null).toBe(open);
    },
  );

  it.each([false, true])(
    "keeps the active template label and ring readable on the inverse dock (dark=%s)",
    async (dark) => {
      jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(dark ? "dark" : "light");
      const screen = await renderDock();
      const surface = StyleSheet.flatten(screen.getByTestId("quick-planner-dock").props.style);
      const badge = screen.getByTestId("quick-planner-badge-template:early");
      const ring = StyleSheet.flatten(badge.props.style);
      const label = screen.getByText("Früh");
      const text = StyleSheet.flatten(label.props.style);
      expect(colorContrastRatio(text.color, surface.backgroundColor)).toBeGreaterThanOrEqual(
        MINIMUM_TEXT_CONTRAST,
      );
      expect(colorContrastRatio(ring.borderColor, surface.backgroundColor)).toBeGreaterThanOrEqual(
        MINIMUM_UI_CONTRAST,
      );
      expect(ring.borderWidth).toBe(2);
      expect(label).toHaveStyle({ fontWeight: "600" });
      expect(screen.getByRole("button", { name: "Früh auswählen", selected: true })).toBeTruthy();
    },
  );

  it("starts the reverse morph before ending planning mode", async () => {
    const onClose = jest.fn();
    const screen = await renderDock({ onClose });

    await fireEvent.press(screen.getByRole("button", { name: "Planung beenden" }));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByTestId("quick-planner-close-row", { includeHiddenElements: true }).props
          .pointerEvents,
      ).toBe("none");
      expect(
        screen.getByTestId("quick-planner-dock", { includeHiddenElements: true }).props
          .pointerEvents,
      ).toBe("none");
      expect(
        screen.getByTestId("quick-planner-pencil-anchor", { includeHiddenElements: true }).props
          .pointerEvents,
      ).toBe("none");
    });
  });

  it("uses one complete timeline and does not replay when closing finishes", async () => {
    const timing = mockTiming;
    const onClose = jest.fn();
    const screen = await renderDock({ open: false, onClose });
    const legs = (duration: number) =>
      timing.mock.calls.filter(([, config]) => config?.duration === duration);
    expect(timing).not.toHaveBeenCalled();
    timing.mockClear();
    await screen.setOpen(true);
    expect(legs(480).map(([target]) => target)).toEqual([1]);
    const clockCurve = legs(480)[0][1]?.easing as (progress: number) => number;
    expect(clockCurve(0.3)).toBeCloseTo(0.3);
    timing.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Planung beenden" }));
    expect(legs(360).map(([target]) => target)).toEqual([0]);
    expect(onClose).not.toHaveBeenCalled();
    timing.mockClear();
    await act(async () => {
      mockCloseCompletion?.(true);
      await screen.setOpen(false);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(timing).not.toHaveBeenCalled();
  });

  it("reverses an interrupted opening directly without first moving further down", async () => {
    const screen = await renderDock({ open: false });
    mockTimingValue = 0.25;
    await screen.setOpen(true);
    mockTiming.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Planung beenden" }));
    const legs = mockTiming.mock.calls.filter(([, config]) => config?.duration === 360);
    expect(legs.map(([target]) => target)).toEqual([0]);
    expect(mockCancel).toHaveBeenCalled();
  });

  it("uses one short opacity-only transition when reduced motion is enabled", async () => {
    mockReducedMotion = true;
    const screen = await renderDock({ open: false });
    mockTiming.mockClear();
    await screen.setOpen(true);
    expect(mockTiming.mock.calls.some(([target]) => target === 0.5)).toBe(false);
    expect(
      mockTiming.mock.calls.some(
        ([target, config]) => target === 1 && config?.duration === MOTION.duration.instant,
      ),
    ).toBe(true);
    expect(
      StyleSheet.flatten(screen.getByTestId("quick-planner-close-row").props.style).transform,
    ).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Planung beenden" }));
    expect(
      mockTiming.mock.calls.some(
        ([target, config]) => target === 0 && config?.duration === MOTION.duration.instant,
      ),
    ).toBe(true);
  });

  it("uses responsive scene timings and an instant reduced-motion fallback", () => {
    expect(quickPlannerTransitionDuration(true, false)).toBe(480);
    expect(quickPlannerTransitionDuration(false, false)).toBe(360);
    expect(quickPlannerTransitionDuration(true, true)).toBe(MOTION.duration.instant);
  });

  it("opens from the persistent pencil target", async () => {
    const onOpen = jest.fn();
    const screen = await renderDock({ onOpen, open: false });
    expect(
      screen.getByText("add", {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByText("pencil", {
        includeHiddenElements: true,
      }),
    ).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Dienstplan bearbeiten" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("quick-planner-dock", { includeHiddenElements: true })).toBeTruthy();
    expect(
      screen.getByTestId("quick-planner-close-hit-target", { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it("keeps the dock visually stable while an entry is being saved", async () => {
    const screen = await renderDock({ busy: true });
    const action = screen.getByRole("button", { name: "Früh auswählen" });

    expect(StyleSheet.flatten(action.props.style).opacity).not.toBe(0.42);
    expect(screen.getByTestId("quick-planner-dock", { includeHiddenElements: true })).toHaveStyle({
      backgroundColor: DARK_PALETTE.surface,
    });
  });
});

describe("quick planner control travel", () => {
  const frame = (progress: number, reduceMotion = false) => ({
    add: quickPlannerControlMotion(progress, "add", reduceMotion),
    close: quickPlannerControlMotion(progress, "close", reduceMotion),
    dock: quickPlannerDockMotion(
      progress,
      reduceMotion,
      QUICK_PLANNER_METRICS.dockHeight + MOTION.distance.scene,
    ),
  });

  it("slides add down before close rises from the same lower point", () => {
    const start = frame(0);
    const leaving = frame(0.15);
    const changeover = frame(0.3);
    const arriving = frame(0.55);
    const end = frame(1);
    expect(start.add).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
    expect(leaving.add.opacity).toBeGreaterThan(0);
    expect(leaving.add.opacity).toBeLessThan(1);
    expect(leaving.add.transform[0].translateY).toBeGreaterThan(0);
    expect(leaving.close.opacity).toBe(0);
    expect(leaving.dock.opacity).toBe(0);
    expect(changeover.add).toEqual({
      opacity: 0,
      transform: [{ translateY: MOTION.distance.scene }],
    });
    expect(changeover.close).toEqual(changeover.add);
    expect(arriving.add.opacity).toBe(0);
    expect(arriving.close.opacity).toBeGreaterThan(0);
    expect(arriving.close.opacity).toBeLessThan(1);
    expect(arriving.close.transform[0].translateY).toBeLessThan(MOTION.distance.scene);
    expect(end.close).toEqual(start.add);
  });

  it("reverses the path on closing and interrupted direction changes without overlap", () => {
    const values = [1, 0.9, 0.75, 0.5, 0.25, 0, 0.25, 0.75, 0.25, 0];
    const frames = values.map((value) => frame(value));
    for (const state of frames) {
      expect(state.add.opacity * state.close.opacity).toBe(0);
      expect(state.add.opacity * state.dock.opacity).toBe(0);
      expect(state.close.opacity).toBe(state.dock.opacity);
      expect(state.add.transform[0].translateY).toBeGreaterThanOrEqual(0);
      expect(state.close.transform[0].translateY).toBeGreaterThanOrEqual(0);
    }
    expect(frames[2].close.transform[0].translateY).toBeGreaterThan(
      frames[1].close.transform[0].translateY,
    );
    expect(frames[4].add.transform[0].translateY).toBeLessThan(
      frames[3].add.transform[0].translateY,
    );
    expect(frames[4]).toEqual(frames[6]);
    expect(frames[6]).toEqual(frames[8]);
    expect(frames.at(-1)?.add.opacity).toBe(1);
  });

  it("settles the drawer and close together without overshoot or a reversal on arrival", () => {
    const landed = frame(5 / 6);
    expect(landed.dock.transform).toEqual([{ translateY: 0 }]);
    expect(landed.close.transform).toEqual([{ translateY: 0 }]);
    const values = Array.from({ length: 101 }, (_, index) => index / 100);
    const frames = values.map((value) => frame(value));
    for (const [index, state] of frames.entries()) {
      const dockY = state.dock.transform[0].translateY;
      const closeY = state.close.transform[0].translateY;
      expect(dockY).toBeGreaterThanOrEqual(0);
      expect(closeY).toBeGreaterThanOrEqual(0);
      if (index > 0) {
        expect(dockY).toBeLessThanOrEqual(frames[index - 1].dock.transform[0].translateY);
        expect(closeY).toBeLessThanOrEqual(frames[index - 1].close.transform[0].translateY);
      }
      if (values[index] >= 5 / 6) {
        expect(state.close.transform).toEqual([{ translateY: 0 }]);
        expect(state.dock.transform).toEqual([{ translateY: 0 }]);
        expect(state.close.opacity).toBe(1);
        expect(state.add.opacity).toBe(0);
      }
    }
    expect(frames.at(-1)?.dock.transform).toEqual([{ translateY: 0 }]);
    expect(
      values
        .slice()
        .reverse()
        .map((value) => frame(value)),
    ).toEqual(frames.slice().reverse());
  });

  it("uses opacity only with reduced motion and preserves both settled states", () => {
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      const reduced = frame(value, true);
      const normal = frame(value);
      expect(reduced.add.transform).toEqual([]);
      expect(reduced.close.transform).toEqual([]);
      expect(reduced.dock.transform).toEqual([]);
      expect(reduced.add.opacity).toBe(normal.add.opacity);
      expect(reduced.close.opacity).toBe(normal.close.opacity);
    }
    expect(frame(0, true).add.opacity).toBe(1);
    expect(frame(1, true).close.opacity).toBe(1);
  });
});
