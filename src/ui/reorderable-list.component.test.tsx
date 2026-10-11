import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useState } from "react";
import { Animated } from "react-native";
import { PointerType, State, type PanGesture } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { moveListItem } from "@/domain/reorder";
import { ReorderableList, type ReorderItem } from "./reorderable-list";

const items: readonly ReorderItem[] = ["Früh", "Spät", "Nacht", "Tag"].map((title, index) => ({
  id: String(index),
  title,
  leading: null,
}));
const mockMove = jest.fn<(id: string, index: number) => Promise<void>>();

function SavedOrderList() {
  const [saved, setSaved] = useState(items);
  return (
    <ReorderableList
      items={saved}
      testID="sort"
      onMove={async (id, to) => {
        await mockMove(id, to);
        setSaved((current) =>
          moveListItem(
            current,
            current.findIndex((item) => item.id === id),
            to,
          ),
        );
      }}
    />
  );
}

describe("ReorderableList", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMove.mockReset();
    mockMove.mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function drop(
    translation: number,
    end: typeof State.END | typeof State.CANCELLED | typeof State.FAILED = State.END,
    id = "0",
  ) {
    await act(async () => {
      fireGestureHandler(getByGestureTestId(`sort-drag-${id}`), [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationY: 0, translationX: 0, absoluteY: 250 },
        { state: State.ACTIVE, translationY: translation, translationX: 30, absoluteY: 250 },
        { state: end, translationY: translation, translationX: 30, absoluteY: 250 },
      ]);
      jest.advanceTimersByTime(500);
    });
  }
  it("retains the landed coordinate throughout the drop handoff and delayed persistence", async () => {
    let complete!: () => void;
    mockMove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const writes = jest.spyOn(Animated.Value.prototype, "setValue");
    const screen = await render(<SavedOrderList />);
    const gesture = getByGestureTestId("sort-drag-0") as PanGesture;
    const event = { translationY: 230, translationX: 30, absoluteY: 250 };
    await act(async () => {
      gesture.handlers.onStart?.(event as never);
      gesture.handlers.onUpdate?.(event as never);
    });
    const y = writes.mock.contexts[
      writes.mock.calls.findIndex(([value]) => value === 230)
    ] as Animated.Value;
    const samples: number[] = [];
    const listener = y.addListener(({ value }) => samples.push(value));
    await act(async () => {
      gesture.handlers.onEnd?.(event as never, true);
      jest.advanceTimersByTime(500);
    });
    expect(mockMove).toHaveBeenCalledTimes(1);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples).not.toContain(0);
    expect(screen.getByTestId("sort-row-0").props.style.transform[1].translateY).toBe(216);
    await act(async () => complete());
    expect(samples).not.toContain(0);
    expect(screen.getByTestId("sort-row-0").props.style.transform[1].translateY).toBe(216);
    y.removeListener(listener);
  });
  it("keeps page scrolling locked until the asynchronous landing animation finishes", async () => {
    let landed!: (result: { finished: boolean }) => void;
    const parallel = Animated.parallel;
    jest.spyOn(Animated, "parallel").mockImplementation((animations, config) => {
      const animation = parallel(animations, config);
      if (animations.length !== items.length) return animation;
      return {
        ...animation,
        start: (callback) => {
          landed = callback!;
        },
      };
    });
    const scroll = { offset: () => 0, step: jest.fn(), setDragging: jest.fn() };
    const screen = await render(
      <ReorderableList items={items} onMove={mockMove} testID="sort" scroll={scroll} />,
    );
    scroll.setDragging.mockClear();
    await act(async () => {
      fireGestureHandler(getByGestureTestId("sort-drag-0"), [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationY: 0, translationX: 0, absoluteY: 250 },
        { state: State.ACTIVE, translationY: 230, translationX: 30, absoluteY: 250 },
        { state: State.END, translationY: 230, translationX: 30, absoluteY: 250 },
      ]);
    });
    expect(scroll.setDragging).toHaveBeenCalledWith(true);
    expect(scroll.setDragging).not.toHaveBeenCalledWith(false);
    expect(mockMove).not.toHaveBeenCalled();
    await act(async () => landed({ finished: true }));
    expect(scroll.setDragging).toHaveBeenLastCalledWith(false);
    expect(mockMove).toHaveBeenCalledWith("0", 3);
    expect(screen.getByRole("adjustable", { name: "Früh, Position 4 von 4" })).toBeTruthy();
  });
  it("does not rewind a completed drop while the incoming saved snapshot is still old", async () => {
    const screen = await render(<ReorderableList items={items} onMove={mockMove} testID="sort" />);
    await drop(230);
    expect(screen.getByRole("adjustable", { name: "Früh, Position 4 von 4" })).toBeTruthy();
    await screen.rerender(<ReorderableList items={[...items]} onMove={mockMove} testID="sort" />);
    expect(screen.getByRole("adjustable", { name: "Früh, Position 4 von 4" })).toBeTruthy();
    await screen.rerender(
      <ReorderableList
        items={[items[1], items[2], items[3], items[0]]}
        onMove={mockMove}
        testID="sort"
      />,
    );
    expect(screen.getByRole("adjustable", { name: "Früh, Position 4 von 4" })).toBeTruthy();
    await drop(-230);
    expect(screen.getByRole("adjustable", { name: "Früh, Position 1 von 4" })).toBeTruthy();
    expect(mockMove.mock.calls).toEqual([
      ["0", 3],
      ["0", 0],
    ]);
  });
  it.each(["success", "failure"])(
    "keeps every row fully visible while a delayed save is locked and settles (%s)",
    async (outcome) => {
      let complete!: () => void;
      let fail!: (error: Error) => void;
      mockMove.mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            complete = resolve;
            fail = reject;
          }),
      );
      const screen = await render(<SavedOrderList />);
      const expectConstantOpacity = () => {
        for (const item of items) {
          expect(screen.getByTestId(`sort-row-${item.id}`)).toHaveStyle({ opacity: 1 });
        }
      };
      expectConstantOpacity();
      await drop(230);
      expect(mockMove).toHaveBeenCalledTimes(1);
      expectConstantOpacity();
      for (const item of items) {
        expect(screen.getByTestId(`sort-row-${item.id}`).props.accessibilityState.disabled).toBe(
          true,
        );
        expect((getByGestureTestId(`sort-drag-${item.id}`) as PanGesture).config.enabled).toBe(
          false,
        );
      }
      await fireEvent(screen.getByTestId("sort-row-0"), "accessibilityAction", {
        nativeEvent: { actionName: "decrement" },
      });
      expect(mockMove).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (outcome === "success") complete();
        else fail(new Error("disk full"));
      });
      expectConstantOpacity();
      expect(
        screen.getByRole("adjustable", {
          name: `Früh, Position ${outcome === "success" ? 4 : 1} von 4`,
        }),
      ).toBeTruthy();
      for (const item of items) {
        expect(screen.getByTestId(`sort-row-${item.id}`).props.accessibilityState.disabled).toBe(
          false,
        );
      }
      await drop(outcome === "success" ? -230 : 230);
      expectConstantOpacity();
      expect(mockMove).toHaveBeenCalledTimes(2);
    },
  );
  it("reserves constant page space across drops with unequal heights and remeasures larger text", async () => {
    const writes = jest.spyOn(Animated.Value.prototype, "setValue");
    const screen = await render(<SavedOrderList />);
    const yValues = [...new Set(writes.mock.contexts)].filter(
      (_, index) => index % 2 === 1,
    ) as Animated.Value[];
    const coordinates = new Map<string, number>();
    const listeners = yValues.map((value, index) =>
      value.addListener(({ value: y }) => coordinates.set(String(index), y)),
    );
    const rowHeights = [90, 72, 108, 72];
    for (const [index, height] of rowHeights.entries()) {
      await fireEvent(screen.getByTestId(`sort-row-${index}`), "layout", {
        nativeEvent: { layout: { height } },
      });
    }
    expect(screen.getByTestId("sort")).toHaveStyle({ height: 344 });
    await drop(360);
    expect(screen.getByTestId("sort")).toHaveStyle({ height: 344 });
    for (const [id, y] of [
      ["1", 0],
      ["2", 72],
      ["3", 180],
      ["0", 252],
    ] as const) {
      expect(screen.getByTestId(`sort-row-${id}`).props.style.transform).toEqual([
        { translateX: 0 },
        { translateY: y },
        { scale: 1 },
      ]);
      expect(screen.getByTestId(`sort-row-${id}`)).toHaveStyle({ borderTopWidth: 1 });
    }
    await drop(-360, State.CANCELLED);
    expect(screen.getByTestId("sort")).toHaveStyle({ height: 344 });
    expect(screen.getByTestId("sort-row-0").props.style.transform[1].translateY).toBe(252);
    await fireEvent(screen.getByTestId("sort-row-1"), "layout", {
      nativeEvent: { layout: { height: 150 } },
    });
    expect(screen.getByTestId("sort")).toHaveStyle({ height: 422 });
    for (const [id, y] of [
      ["1", 0],
      ["2", 150],
      ["3", 258],
      ["0", 330],
    ] as const) {
      expect(coordinates.get(id)).toBe(y);
    }
    await fireEvent(screen.getByTestId("sort-row-1"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(screen.getByTestId("sort")).toHaveStyle({ height: 422 });
    expect(coordinates.get("2")).toBe(0);
    expect(coordinates.get("1")).toBe(108);
    expect(mockMove.mock.calls).toEqual([
      ["0", 3],
      ["1", 1],
    ]);
    yValues.forEach((value, index) => value.removeListener(listeners[index]));
  });
  it("keeps native transform bindings and settled coordinates after successive saved drops", async () => {
    const writes = jest.spyOn(Animated.Value.prototype, "setValue");
    const screen = await render(<SavedOrderList />);
    const initialValues = new Set(writes.mock.contexts);
    expect(initialValues.size).toBe(items.length * 2);
    const bindings = () =>
      new Map(
        items.map((item) => [
          item.id,
          screen.getByTestId(`sort-row-${item.id}`).props.style.transform,
        ]),
      );
    for (const [id, translation, position] of [
      ["0", 230, 4],
      ["0", -230, 1],
      ["2", -170, 1],
      ["1", 230, 4],
    ] as const) {
      await drop(translation, State.END, id);
      await waitFor(() =>
        expect(
          screen.getByRole("adjustable", {
            name: `${items[Number(id)].title}, Position ${position} von 4`,
          }),
        ).toBeTruthy(),
      );
      expect(writes.mock.contexts.every((value) => initialValues.has(value))).toBe(true);
      for (const [itemId, transform] of bindings()) {
        expect(transform[0].translateX).toBe(0);
        const label = screen.getByTestId(`sort-row-${itemId}`).props.accessibilityLabel as string;
        const slot = Number(label.match(/Position (\d+)/)![1]) - 1;
        expect(transform[1].translateY).toBe(slot * 72);
        expect(transform[2].scale).toBe(1);
      }
    }
    expect(mockMove.mock.calls).toEqual([
      ["0", 3],
      ["0", 0],
      ["2", 0],
      ["1", 3],
    ]);
  });
  it.each([State.CANCELLED, State.FAILED])(
    "clears a later cancelled gesture and allows the next saved drop (%s)",
    async (end) => {
      const screen = await render(<SavedOrderList />);
      await drop(230);
      await drop(-230, end);
      expect(screen.getByRole("adjustable", { name: "Früh, Position 4 von 4" })).toBeTruthy();
      const transform = screen.getByTestId("sort-row-0").props.style.transform;
      expect(transform).toEqual([{ translateX: 0 }, { translateY: 216 }, { scale: 1 }]);
      await drop(-230);
      expect(screen.getByRole("adjustable", { name: "Früh, Position 1 von 4" })).toBeTruthy();
      expect(mockMove.mock.calls).toEqual([
        ["0", 3],
        ["0", 0],
      ]);
    },
  );
  it("restores all row positions after a later failed save and can be dragged again", async () => {
    const screen = await render(<SavedOrderList />);
    await drop(230);
    mockMove.mockRejectedValueOnce(new Error("disk full"));
    await drop(-230);
    expect(screen.getByRole("adjustable", { name: "Früh, Position 4 von 4" })).toBeTruthy();
    for (const item of items) {
      const label = screen.getByTestId(`sort-row-${item.id}`).props.accessibilityLabel as string;
      const slot = Number(label.match(/Position (\d+)/)![1]) - 1;
      expect(screen.getByTestId(`sort-row-${item.id}`).props.style.transform).toEqual([
        { translateX: 0 },
        { translateY: slot * 72 },
        { scale: 1 },
      ]);
    }
    await drop(-230);
    expect(screen.getByRole("adjustable", { name: "Früh, Position 1 von 4" })).toBeTruthy();
    expect(mockMove.mock.calls).toEqual([
      ["0", 3],
      ["0", 0],
      ["0", 0],
    ]);
  });
  it("allows a held row to pass several slots and saves just once on drop", async () => {
    const screen = await render(<ReorderableList items={items} onMove={mockMove} testID="sort" />);
    await fireEvent(screen.getByTestId("sort-row-0"), "layout", {
      nativeEvent: { layout: { height: 90 } },
    });
    await drop(230);
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("0", 3));
    expect(mockMove).toHaveBeenCalledTimes(1);
  });
  it.each([State.CANCELLED, State.FAILED])(
    "restores a cancelled drag without saving (%s)",
    async (end) => {
      const screen = await render(
        <ReorderableList items={items} onMove={mockMove} testID="sort" />,
      );
      await drop(230, end);
      expect(mockMove).not.toHaveBeenCalled();
      expect(screen.getByRole("adjustable", { name: "Früh, Position 1 von 4" })).toBeTruthy();
    },
  );
  it("does not write when dropped in the original slot", async () => {
    await render(<ReorderableList items={items} onMove={mockMove} testID="sort" />);
    await drop(20);
    expect(mockMove).not.toHaveBeenCalled();
  });
  it("provides the same sorting through accessibility and respects disabled state", async () => {
    const screen = await render(
      <ReorderableList items={items} onMove={mockMove} testID="sort" disabled />,
    );
    await fireEvent(screen.getByTestId("sort-row-0"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(mockMove).not.toHaveBeenCalled();
    await screen.rerender(<ReorderableList items={items} onMove={mockMove} testID="sort" />);
    await fireEvent(screen.getByTestId("sort-row-0"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(mockMove).toHaveBeenCalledWith("0", 1);
  });
  it("restores the original order on a failed save and accepts a controlled rollback", async () => {
    mockMove.mockRejectedValueOnce(new Error("disk full"));
    const screen = await render(<ReorderableList items={items} onMove={mockMove} testID="sort" />);
    await drop(230);
    expect(mockMove).toHaveBeenCalledWith("0", 3);
    expect(screen.getByRole("adjustable", { name: "Früh, Position 1 von 4" })).toBeTruthy();
    await screen.rerender(
      <ReorderableList
        items={[items[1], items[2], items[3], items[0]]}
        onMove={mockMove}
        testID="sort"
      />,
    );
    expect(screen.getByRole("adjustable", { name: "Früh, Position 4 von 4" })).toBeTruthy();
    await screen.rerender(<ReorderableList items={items} onMove={mockMove} testID="sort" />);
    expect(screen.getByRole("adjustable", { name: "Früh, Position 1 von 4" })).toBeTruthy();
  });
  it("scrolls at the edge while retaining the original finger translation", async () => {
    let offset = 0;
    const scroll = {
      offset: () => offset,
      step: jest.fn(() => {
        offset += 10;
      }),
      setDragging: jest.fn(),
    };
    await render(<ReorderableList items={items} onMove={mockMove} testID="sort" scroll={scroll} />);
    const gesture = getByGestureTestId("sort-drag-0") as PanGesture;
    const event = {
      handlerTag: gesture.handlerTag,
      pointerType: PointerType.TOUCH,
      numberOfPointers: 1,
      state: State.ACTIVE,
      oldState: State.BEGAN,
      x: 0,
      y: 0,
      absoluteX: 0,
      absoluteY: 740,
      translationX: 0,
      translationY: 40,
      velocityX: 0,
      velocityY: 0,
    };
    // The official stream helper always appends END; invoke the registered callbacks
    // here to keep the finger down while the edge-scroll timer runs.
    await act(async () => {
      gesture.handlers.onStart?.(event);
      gesture.handlers.onUpdate?.(event);
      jest.advanceTimersByTime(320);
    });
    expect(scroll.step).toHaveBeenCalled();
    expect(mockMove).not.toHaveBeenCalled();
    await act(async () => {
      gesture.handlers.onEnd?.({ ...event, state: State.END }, true);
      jest.advanceTimersByTime(500);
    });
    expect(mockMove).toHaveBeenCalledWith("0", 3);
    expect(scroll.setDragging).toHaveBeenCalledWith(true);
    expect(scroll.setDragging).toHaveBeenCalledWith(false);
    const count = scroll.step.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(scroll.step).toHaveBeenCalledTimes(count);
  });
});
