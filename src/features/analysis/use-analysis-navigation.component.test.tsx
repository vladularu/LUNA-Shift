import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import * as MockReact from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { createActiveMonthCoordinator } from "@/navigation/active-month";
import { currentMonth } from "@/engine/calendar";
import { useAnalysisNavigation } from "./use-analysis-navigation";
import { selectionFeedback } from "@/ui/haptics";
jest.mock("@/ui/haptics", () => ({ selectionFeedback: jest.fn() }));

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
function Page() {
  const value = useAnalysisNavigation("Europe/Berlin");
  MockReact.useLayoutEffect(() => {
    navigation = value;
  }, [value]);
  return <Text>{`${value.month}|${value.year}|${value.period}`}</Text>;
}
beforeEach(() => {
  mockCoordinator = createActiveMonthCoordinator("2030-12");
  mockFocused = true;
  mockParams = {};
  jest.mocked(router.push).mockClear();
  jest.mocked(router.setParams).mockClear();
  jest.mocked(selectionFeedback).mockClear();
});

describe("native analysis period navigation", () => {
  it("commits chronological months locally without a new native route", async () => {
    const screen = await render(<Page />);
    await act(async () => navigation.moveMonth(1));
    expect(screen.getByText("2031-01|2031|MONTH")).toBeTruthy();
    expect(mockCoordinator.getMonth()).toBe("2031-01");
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
    mockCoordinator.setMonth("2031-01");
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
    mockCoordinator.setMonth("2031-03");
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

  it("uses the calendar selection when returning from another tab and resets MONTH independently", async () => {
    const screen = await render(<Page />);
    mockFocused = false;
    await screen.rerender(<Page />);
    mockCoordinator.setMonth("2028-02");
    mockFocused = true;
    await screen.rerender(<Page />);
    expect(screen.getByText("2028-02|2028|MONTH")).toBeTruthy();
    await act(async () => {
      mockCoordinator.analysisRequests.request();
    });
    const month = currentMonth("Europe/Berlin");
    expect(screen.getByText(`${month}|${month.slice(0, 4)}|MONTH`)).toBeTruthy();
  });
});
