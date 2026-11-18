import { expect, it, jest } from "@jest/globals";
import { fireEvent, render, within } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";

import { TabRootHeader } from "./tab-root-header";
import { SoftScrollAnchor, SoftScrollScope, SoftScrollView } from "./soft-scroll-layout";

const mockRegister = jest.fn();
jest.mock("@/ui/native-scroll-edge", () => ({
  nativeScrollEdge: {
    ScrollEdgeEffectProvider: ({ children }: React.PropsWithChildren) => children,
    ScrollEdgeEffect: jest.requireActual<typeof import("react-native")>("react-native").View,
    useScrollEdgeEffectRef: () => mockRegister,
  },
}));

const layout = (height: number) => ({ nativeEvent: { layout: { height } } });

it("adds header overlap to padding without changing the mounted scroll position", async () => {
  const offset = { x: 0, y: 84 };
  const onLayout = jest.fn();
  const screen = await render(
    <SoftScrollScope>
      <SoftScrollAnchor>
        <View />
      </SoftScrollAnchor>
      <SoftScrollView
        testID="scroller"
        contentOffset={offset}
        contentContainerStyle={{ paddingVertical: 12 }}
        onLayout={onLayout}
      />
    </SoftScrollScope>,
  );
  const anchor = screen.getByTestId("soft-scroll-anchor");
  const scroller = screen.getByTestId("scroller");
  await fireEvent(scroller, "layout", layout(600));
  await fireEvent(anchor, "layout", layout(65));
  expect(screen.getByTestId("soft-scroll-edge").props).toMatchObject({
    edge: "top",
    effect: "soft",
  });
  expect(StyleSheet.flatten(anchor.props.style).marginBottom).toBe(-65);
  expect(StyleSheet.flatten(scroller.props.contentContainerStyle).paddingTop).toBe(77);
  expect(scroller.props.contentOffset).toBe(offset);
  expect(onLayout).toHaveBeenCalledTimes(1);
  await fireEvent(anchor, "layout", layout(82));
  expect(StyleSheet.flatten(scroller.props.contentContainerStyle).paddingTop).toBe(94);
  expect(scroller.props.contentOffset).toBe(offset);
  expect(mockRegister).toHaveBeenCalledTimes(1);
});

it.each(["Mehr", "Dienstvorlagen"])(
  "extends the native edge below %s while leaving its layout and scroll offset alone",
  async (title) => {
    const offset = { x: 0, y: 84 };
    const screen = await render(
      <SoftScrollScope>
        <TabRootHeader title={title} />
        <SoftScrollView
          testID="tab-scroll"
          contentOffset={offset}
          contentContainerStyle={{ paddingTop: 12 }}
        />
      </SoftScrollScope>,
    );
    const anchor = screen.getByTestId("soft-scroll-anchor");
    const effect = screen.getByTestId("soft-scroll-edge");
    const scroller = screen.getByTestId("tab-scroll");
    await fireEvent(scroller, "layout", layout(600));
    await fireEvent(anchor, "layout", layout(80));

    expect(effect).toHaveProp("effect", "soft");
    expect(effect).toHaveProp("pointerEvents", "none");
    expect(effect).toHaveStyle({ position: "absolute", top: 0, bottom: -24 });
    expect(within(effect).queryByText(title)).toBeNull();
    expect(within(anchor).getByRole("header", { name: title })).toBeTruthy();
    expect(anchor).toHaveStyle({ marginBottom: -80 });
    expect(scroller.props.contentOffset).toBe(offset);
    expect(StyleSheet.flatten(scroller.props.contentContainerStyle).paddingTop).toBe(92);
  },
);

it("extends a fixed popup viewport while reporting its original content height", async () => {
  const sizeChange = jest.fn();
  const screen = await render(
    <SoftScrollScope edge="bottom">
      <SoftScrollView testID="popup" fixedViewportHeight={140} onContentSizeChange={sizeChange} />
      <SoftScrollAnchor>
        <View />
      </SoftScrollAnchor>
    </SoftScrollScope>,
  );
  const scroller = screen.getByTestId("popup");
  await fireEvent(scroller, "layout", layout(140));
  await fireEvent(screen.getByTestId("soft-scroll-anchor"), "layout", layout(44));
  expect(StyleSheet.flatten(scroller.props.style).height).toBe(184);
  expect(StyleSheet.flatten(scroller.props.contentContainerStyle).paddingBottom).toBe(44);
  expect(scroller.props.contentOffset).toBeUndefined();
  await fireEvent(scroller, "contentSizeChange", 320, 260);
  expect(sizeChange).toHaveBeenLastCalledWith(320, 216);
});

it("leaves a measured header in flow when its screen has no participating scroll view", async () => {
  const screen = await render(
    <SoftScrollScope>
      <SoftScrollAnchor>
        <View />
      </SoftScrollAnchor>
      <View />
    </SoftScrollScope>,
  );
  const anchor = screen.getByTestId("soft-scroll-anchor");
  await fireEvent(anchor, "layout", layout(65));
  expect(StyleSheet.flatten(anchor.props.style).marginBottom).toBe(-0);
});

it("keeps an existing overlapping header above its calendar scroll view", async () => {
  const screen = await render(
    <SoftScrollScope>
      <SoftScrollAnchor existingOverlap>
        <View />
      </SoftScrollAnchor>
      <SoftScrollView testID="calendar-pager" contentOffset={{ x: 0, y: 240 }} />
    </SoftScrollScope>,
  );
  expect(screen.queryByTestId("soft-scroll-anchor")).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId("soft-scroll-edge").props.style).zIndex).toBe(1);
  expect(screen.getByTestId("calendar-pager").props.contentOffset.y).toBe(240);
});
