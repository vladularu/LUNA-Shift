import { fireEvent, render } from "@testing-library/react-native";
import { expect, it, jest } from "@jest/globals";
import { appResumeStore } from "@/navigation/app-resume-storage";
import { ReportScrollView } from "./report-layout";

jest.mock("@/navigation/app-resume-storage", () => {
  const { createAppResumeStore } = jest.requireActual<
    typeof import("@/navigation/app-resume-state")
  >("@/navigation/app-resume-state");
  return {
    appResumeStore: createAppResumeStore({ read: async () => null, write: async () => {} }),
  };
});
jest.mock("./period-swipe-scroll", () => ({
  PeriodSwipeScroll: ({ children }: { children: import("react").ReactNode }) => children,
}));
jest.mock("./screen-layout", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ScreenScrollView: ({
      scrollRef,
      ...props
    }: import("react-native").ScrollViewProps & {
      scrollRef: import("react").RefObject<import("react-native").ScrollView | null>;
    }) => React.createElement(ScrollView, { ...props, ref: scrollRef, testID: "report-scroll" }),
  };
});

it("restores analysis scroll and prevents a preloaded neighbour from replacing it", async () => {
  await appResumeStore.load();
  const href = "/analysis?month=2026-11&period=MONTH";
  await appResumeStore.record(href);
  appResumeStore.scroll(href, 640);
  const view = await render(<ReportScrollView resumeKey={href} />);
  const scroll = view.getByTestId("report-scroll");
  expect(scroll.props.contentOffset).toEqual({ x: 0, y: 640 });
  await fireEvent(scroll, "scrollBeginDrag");
  await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 820 } } });
  expect(appResumeStore.current()?.scrollY).toBe(820);
  await view.rerender(<ReportScrollView resumeKey={null} />);
  await fireEvent.scroll(view.getByTestId("report-scroll"), {
    nativeEvent: { contentOffset: { y: 0 } },
  });
  expect(appResumeStore.current()?.scrollY).toBe(820);
});
