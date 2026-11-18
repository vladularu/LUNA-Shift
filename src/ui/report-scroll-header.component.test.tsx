import { afterEach, expect, it, jest } from "@jest/globals";
import { fireEvent, render, within } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import {
  AnalysisMonthHeader,
  AnalysisYearHeader,
} from "@/features/analysis/analysis-period-header";
import { appResumeStore } from "@/navigation/app-resume-storage";
import { SCREEN_LAYOUT } from "@/theme/tokens";
import { ReportScrollView } from "./report-layout";
import { ReportScrollHeaderPage, ReportScrollHeaderProvider } from "./report-scroll-header";

const mockScrollTo = jest.fn();

jest.mock("expo", () => {
  process.env.EXPO_OS = "ios";
  const { Platform, View } = jest.requireActual<typeof import("react-native")>("react-native");
  Object.defineProperty(Platform, "Version", { configurable: true, get: () => 27 });
  return {
    requireOptionalNativeModule: (name: string) => (name === "ExpoScrollEdgeEffect" ? {} : null),
    requireNativeView: () => View,
  };
});

jest.mock("@/navigation/app-resume-storage", () => ({
  appResumeStore: { current: jest.fn(() => null), scroll: jest.fn(), flush: jest.fn() },
}));

jest.mock("@/features/analysis/analysis-view-controls", () => ({
  AnalysisViewControls: () => null,
}));

jest.mock("./screen-layout", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ...jest.requireActual<typeof import("./screen-layout")>("./screen-layout"),
    ScreenScrollView: ({
      scrollRef,
      ...props
    }: import("react-native").ScrollViewProps & {
      scrollRef: import("react").RefObject<import("react-native").ScrollView | null>;
    }) => {
      React.useImperativeHandle(
        scrollRef,
        () => ({ scrollTo: mockScrollTo }) as unknown as import("react-native").ScrollView,
        [],
      );
      return React.createElement(ScrollView, { ...props, testID: "report-scroll" });
    },
  };
});

const hrefs = ["/analysis?month=2026-11&period=MONTH", "/analysis?month=2026-12&period=MONTH"];

function Reports({ active = 0, year = false }: { active?: number; year?: boolean }) {
  const onMove = jest.fn();
  return (
    <SafeAreaInsetsContext.Provider value={{ top: 59, bottom: 34, left: 0, right: 0 }}>
      <ReportScrollHeaderProvider>
        {year ? (
          <AnalysisYearHeader
            year={2026}
            activeMonthCount={7}
            onPrevious={onMove}
            onNext={onMove}
            onOpenMonth={onMove}
          />
        ) : (
          <AnalysisMonthHeader
            label="So. 1. Nov. - 30. Nov. 2026"
            onPrevious={onMove}
            onNext={onMove}
            onOpenYear={onMove}
          />
        )}
        {hrefs.map((href, index) => (
          <ReportScrollHeaderPage key={href} active={index === active}>
            <ReportScrollView resumeKey={index === active ? href : null}>
              <Text>Bericht {index}</Text>
            </ReportScrollView>
          </ReportScrollHeaderPage>
        ))}
      </ReportScrollHeaderProvider>
    </SafeAreaInsetsContext.Provider>
  );
}

type Screen = Awaited<ReturnType<typeof render>>;

async function measureHeader(screen: Screen, height: number) {
  await fireEvent(screen.getByTestId("report-scroll-header-content"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
  });
}

async function measureScroll(screen: Screen, index: number) {
  await fireEvent(screen.getAllByTestId("report-scroll")[index], "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } },
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

it.each([false, true])("attaches UIKit soft to the period row in yearly mode %s", async (year) => {
  const screen = await render(<Reports year={year} />);
  const header = screen.getByTestId("report-scroll-header-content");
  const edge = within(header).getByTestId("report-scroll-edge");
  expect(header).toHaveStyle({ position: "absolute" });
  expect(edge).toHaveProp("edge", "top");
  expect(edge).toHaveProp("effect", "soft");
  const toolbar = year ? "analysis-year-toolbar" : "analysis-month-toolbar";
  expect(within(edge).getByTestId(toolbar)).toBe(screen.getByTestId(toolbar));
  expect(within(edge).getByTestId(toolbar)).toHaveProp("accessibilityRole", "toolbar");
  expect(within(header).getByRole("header")).toHaveTextContent("Auswertung");
  expect(within(edge).queryByRole("header")).toBeNull();
});

it("adds measured spacing without commanding a new offset after the user has scrolled", async () => {
  const screen = await render(<Reports />);
  await measureHeader(screen, 180);
  const scroll = screen.getAllByTestId("report-scroll")[0];
  const start = scroll.props.contentOffset;
  expect(start).toEqual({ x: 0, y: 0 });
  expect(scroll).toHaveProp("contentInset", { bottom: 34 });
  expect(scroll.props.contentContainerStyle).toEqual({
    paddingTop: SCREEN_LAYOUT.contentTopPadding + 180,
  });

  await fireEvent(scroll, "scrollBeginDrag");
  await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: 80 } } });
  expect(appResumeStore.scroll).toHaveBeenLastCalledWith(hrefs[0], 80);
  await measureHeader(screen, 181);
  await fireEvent(scroll, "contentSizeChange", 390, 950);

  expect(screen.getAllByTestId("report-scroll")[0]).toBe(scroll);
  expect(scroll.props.contentOffset).toBe(start);
  expect(scroll.props.contentContainerStyle).toEqual({
    paddingTop: SCREEN_LAYOUT.contentTopPadding + 181,
  });
  expect(scroll).toHaveProp("scrollIndicatorInsets", { top: 181, bottom: 34 });
  expect(mockScrollTo).not.toHaveBeenCalled();
});

it("hands the native edge and checkpoint to the prepared page without moving its scroll view", async () => {
  const handle = jest
    .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "findNodeHandle")
    .mockReturnValue(101);
  const screen = await render(<Reports />);
  await measureHeader(screen, 180);
  await measureScroll(screen, 0);
  expect(screen.getByTestId("report-scroll-edge")).toHaveProp("scrollViewTag", 101);
  handle.mockReturnValue(202);
  await measureScroll(screen, 1);
  const prepared = screen.getAllByTestId("report-scroll")[1];
  const start = prepared.props.contentOffset;
  expect(prepared.props.onScroll).toBeUndefined();

  await screen.rerender(<Reports active={1} />);
  expect(screen.getAllByTestId("report-scroll")[1]).toBe(prepared);
  expect(prepared.props.contentOffset).toBe(start);
  expect(mockScrollTo).not.toHaveBeenCalled();
  expect(screen.getByTestId("report-scroll-edge")).toHaveProp("scrollViewTag", 202);
  await fireEvent.scroll(prepared, { nativeEvent: { contentOffset: { x: 0, y: 38 } } });
  expect(appResumeStore.scroll).toHaveBeenLastCalledWith(hrefs[1], 38);
});
