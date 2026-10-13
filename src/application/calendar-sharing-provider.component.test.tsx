import { beforeEach, expect, it, jest } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { Text } from "@/ui/text";
import { SharingRuntimeProvider } from "@/composition/calendar-sharing-provider";
import { useVisibleSharedCalendars } from "./shared-calendars-context";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";

const mockDb = {};
const mockEntries: readonly never[] = [];
const mockMonths: readonly string[] = [];
let mockReady = true;
let mockConfigured = false;
const mockList = jest.fn<() => Promise<readonly unknown[]>>().mockResolvedValue([]);
const mockGetSession = jest.fn<() => Promise<{ id: string; displayName: string } | null>>();
const mockInitialize = jest.fn<() => Promise<void>>().mockResolvedValue();
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: mockReady }),
  usePflegeShiftProfile: () => ({ profile: { timeZone: "Europe/Berlin" } }),
  usePflegeShiftTestData: () => ({ testMonths: mockMonths }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
}));
jest.mock("@/infrastructure/auth/sharing-auth", () => ({
  createSharingAuthPort: () => ({
    isConfigured: mockConfigured,
    getSession: mockGetSession,
    subscribe: () => () => {},
    signOut: async () => {},
  }),
  getSharingSupabaseClient: () =>
    mockConfigured
      ? { auth: { getUser: async () => ({ data: { user: { identities: [] } }, error: null }) } }
      : null,
  isSharingAppleSignInAvailable: async () => false,
  prepareAppleAccountDeletion: async () => ({ status: "cancelled" }),
  forgetSharingAuthProfile: async () => {},
}));
jest.mock("@/infrastructure/sharing/cloud-sharing-client", () => ({
  SharingCloudError: class extends Error {},
  createCloudSharingClient: () => ({ listCalendars: mockList }),
}));
jest.mock("@/infrastructure/database/calendar-entry-repository", () => ({
  listCalendarEntries: async () => [],
}));
jest.mock("@/infrastructure/database/calendar-sharing-repository", () => ({
  migrateCalendarSharing: () => mockInitialize(),
  setSharingActiveAccount: async () => {},
  listSharingBindings: async () => [],
  listCachedSharingCalendars: async () => [],
}));
function Harness() {
  const controller = useSharingUiController();
  const calendars = useVisibleSharedCalendars();
  return <Text>{`${controller?.status ?? "missing"} · ${calendars.length}`}</Text>;
}
beforeEach(() => {
  mockReady = true;
  mockConfigured = false;
  mockGetSession.mockReset().mockResolvedValue(null);
  mockInitialize.mockClear();
  mockList.mockClear();
});
it("keeps the local app mounted while missing cloud setup remains explicitly unavailable", async () => {
  const screen = await render(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  await waitFor(() => expect(screen.getByText("unavailable · 0")).toBeTruthy());
  expect(mockInitialize).not.toHaveBeenCalled();
  expect(mockGetSession).not.toHaveBeenCalled();
});
it("waits for the main database/profile before initializing optional sharing", async () => {
  mockReady = false;
  mockConfigured = true;
  const screen = await render(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  expect(mockInitialize).not.toHaveBeenCalled();
  mockReady = true;
  await screen.rerender(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  await waitFor(() => expect(screen.getByText("signedOut · 0")).toBeTruthy());
  expect(mockInitialize).toHaveBeenCalledTimes(1);
});
it("refreshes on foreground and every fifteen active seconds, and removes listeners on unmount", async () => {
  jest.useFakeTimers();
  mockConfigured = true;
  mockGetSession.mockResolvedValue({ id: "account", displayName: "Alex" });
  let listener!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
    listener = callback;
    return { remove };
  });
  const screen = await render(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  await waitFor(() => expect(screen.getByText("signedIn · 0")).toBeTruthy());
  const before = mockList.mock.calls.length;
  await act(async () => {
    listener("active");
  });
  expect(mockList.mock.calls.length).toBeGreaterThan(before);
  const foreground = mockList.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(15000);
  });
  expect(mockList.mock.calls.length).toBeGreaterThan(foreground);
  await act(async () => {
    listener("background");
  });
  const paused = mockList.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(30000);
  });
  expect(mockList.mock.calls.length).toBe(paused);
  await screen.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
