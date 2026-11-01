import { act, render, waitFor } from "@testing-library/react-native";
import { it, expect, jest } from "@jest/globals";
import { AppState, type AppStateStatus } from "react-native";
import { createActiveMonthCoordinator } from "./active-month";
import { AppResumeCheckpoint } from "./app-resume-checkpoint";
import { appResumeStore } from "./app-resume-storage";

let mockPath = "/";
let mockParams = {};
let mockReady = false;
let mockNavigation: { key: string } | undefined;
let mockProfile: object | null = {};
let mockDisk: string | null = JSON.stringify({
  version: 1,
  href: "/analysis?month=2026-07&period=YEAR",
  scrollY: 640,
});
const mockCoordinator = createActiveMonthCoordinator("2026-07");
jest.mock("expo-router", () => ({
  usePathname: () => mockPath,
  useGlobalSearchParams: () => mockParams,
  useRootNavigationState: () => mockNavigation,
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: mockReady, error: null }),
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
}));
jest.mock("./active-month", () => {
  const actual = jest.requireActual<typeof import("./active-month")>("./active-month");
  return { ...actual, useActiveMonthCoordinator: () => mockCoordinator };
});
jest.mock("./app-resume-storage", () => {
  const { createAppResumeStore } =
    jest.requireActual<typeof import("./app-resume-state")>("./app-resume-state");
  return {
    appResumeStore: createAppResumeStore({
      read: async () => mockDisk,
      write: async (value) => {
        mockDisk = value;
      },
    }),
  };
});

it("keeps the cold-launch checkpoint until navigation is ready, checkpoints on inactive, and clears it without a profile", async () => {
  let stateChange: ((state: AppStateStatus) => void) | undefined;
  const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    stateChange = listener;
    return { remove: jest.fn() };
  });
  const view = await render(<AppResumeCheckpoint />);
  await waitFor(() => expect(appResumeStore.current()?.scrollY).toBe(640));
  expect(JSON.parse(mockDisk!).href).toBe("/analysis?month=2026-07&period=YEAR");
  mockPath = "/analysis";
  mockParams = { month: "2026-07", period: "YEAR" };
  mockCoordinator.analysisRequests.setMonth("2026-07");
  mockCoordinator.analysisRequests.setPeriod("YEAR");
  mockNavigation = { key: "root" };
  mockReady = true;
  await view.rerender(<AppResumeCheckpoint />);
  await act(async () => {
    appResumeStore.scroll("/analysis?month=2026-07&period=YEAR", 820);
    stateChange!("inactive");
  });
  await waitFor(() => expect(JSON.parse(mockDisk!).scrollY).toBe(820));
  mockPath = "/shift-editor";
  mockParams = { entryId: "private-id" };
  await view.rerender(<AppResumeCheckpoint />);
  expect(JSON.parse(mockDisk!).href).toBe("/analysis?month=2026-07&period=YEAR");
  mockProfile = null;
  await view.rerender(<AppResumeCheckpoint />);
  await waitFor(() => expect(mockDisk).toBeNull());
  await view.unmount();
  spy.mockRestore();
});
