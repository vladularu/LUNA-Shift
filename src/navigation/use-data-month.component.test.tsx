import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { currentMonth } from "@/engine/calendar";
import { createActiveMonthCoordinator } from "@/navigation/active-month";
import { useDataMonth } from "./use-data-month";

let mockCoordinator = createActiveMonthCoordinator("2035-12");
let mockSegments = ["(tabs)", "(calendar)"];
let mockParams: { month?: string | string[] } = {};
jest.mock("@/navigation/active-month", () => ({
  ...jest.requireActual<typeof import("@/navigation/active-month")>("@/navigation/active-month"),
  useActiveMonthCoordinator: () => mockCoordinator,
  useActiveMonth: () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return React.useSyncExternalStore(
      mockCoordinator.subscribeMonths,
      mockCoordinator.getMonth,
      mockCoordinator.getMonth,
    );
  },
}));
jest.mock("expo-router", () => ({
  useSegments: () => mockSegments,
  useGlobalSearchParams: () => mockParams,
}));

beforeEach(() => {
  mockCoordinator = createActiveMonthCoordinator("2035-12");
  mockSegments = ["(tabs)", "(calendar)"];
  mockParams = {};
});

describe("data month for independent calendar and analysis tabs", () => {
  it("loads the focused tab's own year and restores the calendar data window on return", async () => {
    const screen = await renderHook(useDataMonth);
    expect(screen.result.current).toBe("2035-12");
    await act(async () => mockCoordinator.analysisRequests.setMonth("2020-06"));
    expect(screen.result.current).toBe("2035-12");

    mockSegments = ["(tabs)", "(analysis)"];
    await screen.rerender(undefined);
    expect(screen.result.current).toBe("2020-06");
    await act(async () => mockCoordinator.setMonth("2040-01"));
    expect(screen.result.current).toBe("2020-06");
    expect(mockCoordinator.analysisRequests.getMonth()).toBe("2020-06");

    mockSegments = ["(tabs)", "(calendar)"];
    await screen.rerender(undefined);
    expect(screen.result.current).toBe("2040-01");
    expect(mockCoordinator.analysisRequests.getMonth()).toBe("2020-06");
  });

  it("tracks the active analysis year without moving the calendar selection", async () => {
    mockSegments = ["(tabs)", "(analysis)"];
    const screen = await renderHook(useDataMonth);
    expect(screen.result.current).toBe(currentMonth());
    await act(async () => mockCoordinator.analysisRequests.setMonth("2021-03"));
    expect(screen.result.current).toBe("2021-03");
    expect(mockCoordinator.getMonth()).toBe("2035-12");
  });

  it.each(["period", "salary", "compliance"])(
    "loads the explicitly requested month for an analysis %s route",
    async (page) => {
      mockSegments = ["(tabs)", "(analysis)", page];
      mockParams = { month: "2010-04" };
      const screen = await renderHook(useDataMonth);
      expect(screen.result.current).toBe("2010-04");
      expect(mockCoordinator.getMonth()).toBe("2035-12");
      expect(mockCoordinator.analysisRequests.getMonth()).toBeNull();
    },
  );

  it.each([{ month: "2030-13" }, { month: "bad" }, { month: ["2010-04", "2011-07"] }])(
    "ignores invalid or ambiguous report month parameters: $month",
    async ({ month }) => {
      mockSegments = ["(tabs)", "(analysis)"];
      mockParams = { month };
      mockCoordinator.analysisRequests.setMonth("2020-06");
      const screen = await renderHook(useDataMonth);
      expect(screen.result.current).toBe("2020-06");
    },
  );
});
