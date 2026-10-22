import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import * as MockReact from "react";
import { ScrollView, Text } from "react-native";
import { ReportPeriodPager } from "@/ui/report-period-pager";
import { router } from "expo-router";
import { createActiveMonthCoordinator } from "@/navigation/active-month";
import { currentMonth } from "@/engine/calendar";
import { useAnalysisNavigation } from "./use-analysis-navigation";
import { selectionFeedback } from "@/ui/haptics";
jest.mock("@/ui/haptics", () => ({ selectionFeedback: jest.fn() }));
jest.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

let mockCoordinator = createActiveMonthCoordinator("2030-12");
let mockFocused = true;
let mockParams: { month?: string; period?: string } = {};
let navigation: ReturnType<typeof useAnalysisNavigation>;
jest.mock("@/navigation/active-month", () => ({
  ...jest.requireActual<typeof import("@/navigation/active-month")>("@/navigation/active-month"),
  useActiveMonthCoordinator: () => mockCoordinator,
}));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  useIsFocused: () => mockFocused,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void) =>
    MockReact.useEffect(() => {
      if (mockFocused) return callback();
    }, [callback, mockFocused]),
}));
function Page({ withPager = false }: { withPager?: boolean }) {
  const value = useAnalysisNavigation("Europe/Berlin");
  MockReact.useLayoutEffect(() => {
    navigation = value;
  }, [value]);
  return withPager ? (
    <ReportPeriodPager
      value={value.month}
      unit={value.period}
      enabled={mockFocused}
      onChange={value.selectMonth}
      renderPage={(month) => <Text>{[month, month.slice(0, 4), value.period].join("|")}</Text>}
    />
  ) : (
    <Text>{[value.month, value.year, value.period].join("|")}</Text>
  );
}
beforeEach(() => {
  mockCoordinator = createActiveMonthCoordinator("2030-12");
  mockFocused = true;
  mockParams = { month: "2030-12" };
  jest.mocked(router.push).mockClear();
  jest.mocked(router.setParams).mockClear();
  jest.mocked(selectionFeedback).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("native analysis period navigation", () => {
  it("commits chronological months locally without a new native route", async () => {
    const screen = await render(<Page />);
    await act(async () => navigation.moveMonth(1));
    expect(screen.getByText("2031-01|2031|MONTH")).toBeTruthy();
    expect(mockCoordinator.getMonth()).toBe("2030-12");
    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2031-01", period: "MONTH" });
    await act(async () => navigation.moveMonth(-1));
    expect(screen.getByText("2030-12|2030|MONTH")).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(selectionFeedback).not.toHaveBeenCalled();
  });
  it("restores the previous mode and month after leaving an actual native subpage", async () => {
    const screen = await render(<Page />);
    await act(async () => navigation.changePeriod("YEAR"));
    mockFocused = false;
    await screen.rerender(<Page />);
    mockCoordinator.analysisRequests.setMonth("2031-01");
    mockCoordinator.analysisRequests.setPeriod("YEAR");
    mockFocused = true;
    await screen.rerender(<Page />);
    expect(screen.getByText("2030-12|2030|MONTH")).toBeTruthy();
    expect(mockCoordinator.getMonth()).toBe("2030-12");
  });
  it("changes years locally and preserves the month when opening monthly mode", async () => {
    mockParams = { month: "2030-03", period: "YEAR" };
    const screen = await render(<Page />);
    await act(async () => navigation.moveYear(-1));
    expect(screen.getByText("2029-03|2029|YEAR")).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => navigation.changePeriod("MONTH"));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/(tabs)/(analysis)/period",
      params: { month: "2029-03", period: "MONTH" },
    });
  });
  it("ignores period changes while an underlying page is hidden", async () => {
    const screen = await render(<Page />);
    mockFocused = false;
    await screen.rerender(<Page />);
    await act(async () => navigation.selectMonth("2031-02"));
    expect(mockCoordinator.getMonth()).toBe("2030-12");
    expect(router.setParams).not.toHaveBeenCalled();
  });

  it("uses the active child page's YEAR mode when a tab reselect pops back to a monthly root", async () => {
    const screen = await render(<Page />);
    await act(async () => navigation.changePeriod("YEAR"));
    mockFocused = false;
    await screen.rerender(<Page />);
    mockCoordinator.analysisRequests.setMonth("2031-03");
    mockCoordinator.analysisRequests.setPeriod("YEAR");
    await act(async () => {
      mockCoordinator.analysisRequests.request();
    });
    expect(screen.getByText("2030-12|2030|MONTH")).toBeTruthy();
    mockFocused = true;
    await screen.rerender(<Page />);
    const year = currentMonth("Europe/Berlin").slice(0, 4);
    expect(screen.getByText(`${year}-03|${year}|YEAR`)).toBeTruthy();
    expect(router.setParams).toHaveBeenLastCalledWith({ month: `${year}-03`, period: "YEAR" });
    expect(mockCoordinator.getTodayRequestRevision()).toBe(0);
  });

  it("keeps its last month on tab entry and resets MONTH without moving the calendar", async () => {
    const screen = await render(<Page />);
    mockFocused = false;
    await screen.rerender(<Page />);
    mockCoordinator.setMonth("2028-02");
    mockFocused = true;
    await screen.rerender(<Page />);
    expect(screen.getByText("2030-12|2030|MONTH")).toBeTruthy();
    await act(async () => {
      mockCoordinator.analysisRequests.request();
    });
    const month = currentMonth("Europe/Berlin");
    expect(screen.getByText(`${month}|${month.slice(0, 4)}|MONTH`)).toBeTruthy();
    expect(mockCoordinator.getMonth()).toBe("2028-02");
  });
  it("opens the current month on its first visit independently of the calendar", async () => {
    mockParams = {};
    mockCoordinator.setMonth("2028-02");
    const screen = await render(<Page />);
    const month = currentMonth("Europe/Berlin");
    expect(screen.getByText([month, month.slice(0, 4), "MONTH"].join("|"))).toBeTruthy();
    expect(mockCoordinator.getMonth()).toBe("2028-02");
  });

  it("remembers its own month after remounting while the calendar changes", async () => {
    mockParams = {};
    const first = await render(<Page />);
    await act(async () => navigation.selectMonth("2030-06"));
    await first.unmount();
    mockCoordinator.setMonth("2031-12");
    const screen = await render(<Page />);
    expect(screen.getByText("2030-06|2030|MONTH")).toBeTruthy();
    expect(mockCoordinator.getMonth()).toBe("2031-12");
  });

  it("preserves the annual view across tab switches and resets only its own year on reselect", async () => {
    mockParams = { month: "2028-03", period: "YEAR" };
    const screen = await render(<Page />);
    mockFocused = false;
    await screen.rerender(<Page />);
    mockCoordinator.setMonth("2031-12");
    mockFocused = true;
    await screen.rerender(<Page />);
    expect(screen.getByText("2028-03|2028|YEAR")).toBeTruthy();
    await act(async () => {
      mockCoordinator.analysisRequests.request();
    });
    const year = currentMonth("Europe/Berlin").slice(0, 4);
    expect(screen.getByText([year + "-03", year, "YEAR"].join("|"))).toBeTruthy();
    expect(mockCoordinator.getMonth()).toBe("2031-12");
  });

  it.each(["MONTH", "YEAR"] as const)(
    "keeps the %s pager stationary when switching tabs with a different calendar month",
    async (period) => {
      mockParams = { month: "2030-06", period };
      const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
      const screen = await render(<Page withPager />);
      await fireEvent(screen.getByTestId("report-period-pager"), "layout", {
        nativeEvent: { layout: { width: 390, height: 700 } },
      });
      scrollTo.mockClear();

      mockFocused = false;
      await screen.rerender(<Page withPager />);
      mockCoordinator.setMonth("2030-12");
      mockFocused = true;
      await screen.rerender(<Page withPager />);

      expect(screen.getByText(["2030-06", "2030", period].join("|"))).toBeTruthy();
      expect(scrollTo).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    },
  );
  it("honors an explicit report month arriving together with focus without moving the calendar", async () => {
    mockParams = { month: "2030-06" };
    const screen = await render(<Page />);
    mockFocused = false;
    await screen.rerender(<Page />);
    mockParams = { month: "2031-02" };
    mockFocused = true;
    await screen.rerender(<Page />);
    expect(screen.getByText("2031-02|2031|MONTH")).toBeTruthy();
    expect(mockCoordinator.getMonth()).toBe("2030-12");
  });
});
