import { beforeEach, expect, it, jest } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { Text } from "@/ui/text";
import { SharingRuntimeProvider } from "@/composition/calendar-sharing-provider";
import { useVisibleSharedCalendars } from "./shared-calendars-context";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";

let mockInvalidate: () => void;
const mockStopRealtime = jest.fn();
jest.mock("@/infrastructure/sharing/sharing-realtime", () => ({
  watchSharingChanges: (_client: unknown, invalidate: () => void) => {
    mockInvalidate = invalidate;
    return mockStopRealtime;
  },
}));
let mockDb = {};
const mockEntries: readonly never[] = [];
const mockMonths: readonly string[] = [];
let mockReady = true;
let mockProfile: { timeZone: string } | null = { timeZone: "Europe/Berlin" };
let mockConfigured = false;
const mockList = jest.fn<() => Promise<readonly unknown[]>>().mockResolvedValue([]);
const mockGetSession = jest.fn<() => Promise<{ id: string; displayName: string } | null>>();
const mockInitialize = jest.fn<() => Promise<void>>().mockResolvedValue();
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: mockReady }),
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
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
  listSharingInvitations: async () => [],
  rememberSharingInvitation: async () => {},
  configureSharingContent: async () => {},
}));
function Harness() {
  const controller = useSharingUiController();
  const calendars = useVisibleSharedCalendars();
  return <Text>{`${controller?.status ?? "missing"} · ${calendars.length}`}</Text>;
}
beforeEach(() => {
  mockDb = {};
  mockReady = true;
  mockProfile = { timeZone: "Europe/Berlin" };
  mockConfigured = false;
  mockGetSession.mockReset().mockResolvedValue(null);
  mockInitialize.mockClear();
  mockList.mockClear();
  mockStopRealtime.mockClear();
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
it("keeps the initialized sharing session while another calendar year loads and when returning", async () => {
  mockConfigured = true;
  mockGetSession.mockResolvedValue({ id: "account", displayName: "Alex" });
  const tree = (
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>
  );
  const screen = await render(tree);
  await waitFor(() => expect(screen.getByText("signedIn · 0")).toBeTruthy());
  for (const ready of [false, true, false, true]) {
    mockReady = ready;
    await screen.rerender(
      <SharingRuntimeProvider>
        <Harness />
      </SharingRuntimeProvider>,
    );
    expect(screen.getByText("signedIn · 0")).toBeTruthy();
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockStopRealtime).not.toHaveBeenCalled();
  }
});
it("waits for the replacement database instead of retaining the previous initialized session", async () => {
  mockConfigured = true;
  mockGetSession.mockResolvedValue({ id: "account", displayName: "Alex" });
  const screen = await render(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  await waitFor(() => expect(screen.getByText("signedIn · 0")).toBeTruthy());
  mockDb = {};
  mockReady = false;
  await screen.rerender(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  expect(screen.queryByText("signedIn · 0")).toBeNull();
  expect(mockInitialize).toHaveBeenCalledTimes(1);
  expect(mockStopRealtime).toHaveBeenCalledTimes(1);
  mockReady = true;
  await screen.rerender(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  await waitFor(() => expect(screen.getByText("signedIn · 0")).toBeTruthy());
  expect(mockInitialize).toHaveBeenCalledTimes(2);
});
it("stops sharing when the profile is removed and waits for initialization on return", async () => {
  mockConfigured = true;
  mockGetSession.mockResolvedValue({ id: "account", displayName: "Alex" });
  const screen = await render(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  await waitFor(() => expect(screen.getByText("signedIn · 0")).toBeTruthy());
  mockProfile = null;
  mockReady = false;
  await screen.rerender(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  expect(screen.queryByText("signedIn · 0")).toBeNull();
  expect(mockStopRealtime).toHaveBeenCalledTimes(1);
  mockProfile = { timeZone: "Europe/Berlin" };
  await screen.rerender(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  expect(mockInitialize).toHaveBeenCalledTimes(1);
  mockReady = true;
  await screen.rerender(
    <SharingRuntimeProvider>
      <Harness />
    </SharingRuntimeProvider>,
  );
  await waitFor(() => expect(screen.getByText("signedIn · 0")).toBeTruthy());
  expect(mockInitialize).toHaveBeenCalledTimes(2);
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
  const realtimeBefore = mockList.mock.calls.length;
  await act(async () => mockInvalidate());
  expect(mockList.mock.calls.length).toBeGreaterThan(realtimeBefore);
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
    mockInvalidate();
  });
  expect(mockList.mock.calls.length).toBe(paused);
  await screen.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(mockStopRealtime).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
