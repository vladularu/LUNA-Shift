import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { buildQuickEntryActions } from "./quick-entry-actions";
import { QuickEntryActionStrip } from "./quick-entry-action-strip";
import type { ShiftTemplate } from "@/domain/types";

let mockNativeOffset = 0;
let mockReducedMotion = false;
const mockScrollTo = jest.fn((options: { x: number }) => {
  mockNativeOffset = options.x;
});
jest.mock("react-native", () => {
  const native = jest.requireActual<typeof import("react-native")>("react-native");
  const React = jest.requireActual<typeof import("react")>("react");
  const mocked = Object.create(null, Object.getOwnPropertyDescriptors(native));
  Object.defineProperty(mocked, "ScrollView", {
    enumerable: true,
    configurable: true,
    value: React.forwardRef(function ScrollView(
      props: import("react-native").ScrollViewProps,
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
      return <native.View {...props}>{props.children}</native.View>;
    }),
  });
  return mocked;
});
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...jest.requireActual<typeof import("react-native-reanimated")>("react-native-reanimated"),
  useReducedMotion: () => mockReducedMotion,
}));

const template: ShiftTemplate = {
  id: "shift",
  name: "Dienst",
  type: "EARLY",
  startTime: "06:00",
  endTime: "14:00",
  breakMinutes: 30,
  color: "#62B94C",
  symbol: "F",
  sortOrder: 0,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revision: 1,
};
const actions = buildQuickEntryActions(
  Array.from({ length: 13 }, (_, i) => ({ ...template, id: String(i), name: `Dienst ${i + 1}` })),
).filter((action) => action.kind === "TEMPLATE");
const select = jest.fn();
const strip = (activeKey: string | null) => (
  <QuickEntryActionStrip
    actions={actions}
    activeKey={activeKey}
    busy={false}
    onSelectAction={select}
    tileWidth={82}
  />
);

beforeEach(() => {
  jest.useFakeTimers();
  mockScrollTo.mockClear();
  mockNativeOffset = 0;
  mockReducedMotion = false;
});
afterEach(() => {
  jest.useRealTimers();
});

it.each([false, true])(
  "matches the three reference photos: center the open pair, then the collapsed service (reduced=%s)",
  async (reduced) => {
    mockReducedMotion = reduced;
    const screen = await render(strip(null));
    expect(mockNativeOffset).toBe(0);
    await screen.rerender(strip("template:4"));
    expect(mockNativeOffset).toBe(205);
    // The fourth-index service and its adjacent time column form the centered pair.
    expect(4 * 82 + 82 - mockNativeOffset).toBe(410 / 2);
    await screen.rerender(strip(null));
    expect(mockNativeOffset).toBe(164);
    expect(4 * 82 + 41 - mockNativeOffset).toBe(410 / 2);
    expect(mockScrollTo.mock.calls.map(([options]) => options)).toEqual([
      { x: 205, animated: !reduced },
      { x: 164, animated: !reduced },
    ]);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(mockScrollTo).toHaveBeenCalledTimes(2);
  },
);

it("scrolls by individual services with five-place sizing and stable disclosure bounds", async () => {
  const screen = await render(strip(null));
  await fireEvent(screen.getByTestId("quick-planner-strip"), "layout", {
    nativeEvent: { layout: { width: 410, height: 72 } },
  });
  let view = screen.getByTestId("quick-planner-strip");
  expect(view.props.snapToOffsets).toEqual([0, 82, 164, 246, 328, 410, 492, 574, 656]);
  expect(view.props.snapToEnd).toBe(false);
  expect(view.props.disableIntervalMomentum).not.toBe(true);
  expect(view.props.pagingEnabled).not.toBe(true);
  const contentWidth = StyleSheet.flatten(view.props.contentContainerStyle).width;
  expect(contentWidth).toBe(1148);
  const before = StyleSheet.flatten(
    screen.getByTestId("quick-planner-template-template:7").props.style,
  ).width;
  await screen.rerender(strip("template:7"));
  view = screen.getByTestId("quick-planner-strip");
  expect(StyleSheet.flatten(view.props.contentContainerStyle).width).toBe(contentWidth);
  expect(
    StyleSheet.flatten(screen.getByTestId("quick-planner-template-template:7").props.style).width,
  ).toBe(before);
});

it("preserves the scrolled service on resize and ignores stale content-size events", async () => {
  const screen = await render(strip(null));
  const view = () => screen.getByTestId("quick-planner-strip");
  await fireEvent(view(), "layout", { nativeEvent: { layout: { width: 410, height: 72 } } });
  await fireEvent(view(), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: 246, y: 0 } },
  });
  mockNativeOffset = 246;
  await fireEvent(view(), "layout", { nativeEvent: { layout: { width: 360, height: 72 } } });
  await fireEvent(view(), "contentSizeChange", 1148, 72);
  expect(mockScrollTo).not.toHaveBeenCalled();
  await fireEvent(view(), "contentSizeChange", 1008, 72);
  expect(mockScrollTo).toHaveBeenCalledTimes(1);
  expect(mockScrollTo).toHaveBeenCalledWith({ x: 216, animated: false });
  expect(view().props.snapToOffsets).toEqual([0, 72, 144, 216, 288, 360, 432, 504, 576]);
});

it.each([false, true])(
  "clamps the unused disclosure space at the list end (reduced motion=%s)",
  async (reduced) => {
    mockReducedMotion = reduced;
    const tree = (key: string | null) => (
      <QuickEntryActionStrip
        actions={actions.slice(0, 5)}
        activeKey={key}
        busy={false}
        onSelectAction={select}
        tileWidth={82}
      />
    );
    const screen = await render(tree("template:2"));
    const view = () => screen.getByTestId("quick-planner-strip");
    expect(view().props.snapToOffsets).toEqual([0, 82]);
    const bounds = StyleSheet.flatten(view().props.contentContainerStyle).width;
    await fireEvent(view(), "scrollBeginDrag");
    await fireEvent(view(), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: 82, y: 0 } },
    });
    mockNativeOffset = 82;
    mockScrollTo.mockClear();
    await screen.rerender(tree(null));
    expect(view().props.snapToOffsets).toEqual([0]);
    expect(view().props.scrollEnabled).toBe(false);
    expect(StyleSheet.flatten(view().props.contentContainerStyle).width).toBe(bounds);
    expect(mockScrollTo).toHaveBeenCalledWith({ x: 0, animated: !reduced });
  },
);

it("handles interrupted disclosure without a late second centering or an old return point", async () => {
  const screen = await render(strip(null));
  await screen.rerender(strip("template:4"));
  await screen.rerender(strip(null));
  // Ignore a native completion from the superseded opening.
  await fireEvent(screen.getByTestId("quick-planner-strip"), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: 205, y: 0 } },
  });
  await screen.rerender(strip("template:4"));
  await screen.rerender(strip(null));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(mockScrollTo.mock.calls.map(([options]) => options.x)).toEqual([205, 164, 205, 164]);
});

it("retains a manual service swipe instead of chasing the old selection on collapse", async () => {
  const screen = await render(strip(null));
  await screen.rerender(strip("template:4"));
  mockScrollTo.mockClear();
  const view = () => screen.getByTestId("quick-planner-strip");
  await fireEvent(view(), "scrollBeginDrag");
  mockNativeOffset = 246;
  await fireEvent(view(), "scroll", { nativeEvent: { contentOffset: { x: 246, y: 0 } } });
  await fireEvent(view(), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: 246, y: 0 } },
  });
  await screen.rerender(strip(null));
  expect(mockScrollTo).not.toHaveBeenCalled();
  expect(mockNativeOffset).toBe(246);
});

it("centers each new selection once without accumulating offsets during rapid changes", async () => {
  const screen = await render(strip(null));
  for (const key of ["template:4", "template:7", "template:6", null]) {
    await screen.rerender(strip(key));
  }
  await act(async () => jest.advanceTimersByTime(1000));
  expect(mockScrollTo.mock.calls.map(([options]) => options.x)).toEqual([205, 451, 369, 328]);
});

it.each([
  { actual: 700, target: undefined },
  { actual: 600, target: 738 },
])(
  "bounds a slow drag or a fast fling before the unused disclosure space ($actual, $target)",
  async ({ actual, target }) => {
    const screen = await render(strip(null));
    const view = () => screen.getByTestId("quick-planner-strip");
    await fireEvent(view(), "scrollBeginDrag");
    await fireEvent(view(), "scroll", { nativeEvent: { contentOffset: { x: actual, y: 0 } } });
    await fireEvent(view(), "scrollEndDrag", {
      nativeEvent: {
        contentOffset: { x: actual, y: 0 },
        targetContentOffset: target === undefined ? undefined : { x: target, y: 0 },
      },
    });
    expect(mockScrollTo.mock.calls.map(([options]) => options.x)).toEqual([656]);
  },
);

it.each([false, true])(
  "keeps the selection centered when resizing during disclosure (collapse=%s)",
  async (collapse) => {
    const screen = await render(strip("template:4"));
    const view = () => screen.getByTestId("quick-planner-strip");
    expect(mockNativeOffset).toBe(205);
    await fireEvent(view(), "layout", { nativeEvent: { layout: { width: 360, height: 72 } } });
    if (collapse) await screen.rerender(strip(null));
    await fireEvent(view(), "contentSizeChange", 1008, 72);
    expect(mockNativeOffset).toBe(collapse ? 144 : 180);
    expect(mockScrollTo).toHaveBeenLastCalledWith({ x: collapse ? 144 : 180, animated: false });
  },
);
