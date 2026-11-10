import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { Stack, useLocalSearchParams, usePathname } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { useEffect, useState, type PropsWithChildren } from "react";
import { AppState, Button, Text } from "react-native";
import type {
  CloudDeviceState,
  CloudLocalPort,
  PrivateCloudDocument,
  PrivateCloudRemote,
  PrivateCloudRevision,
} from "@/domain/private-cloud";
import { sameCloudValue } from "@/domain/private-cloud-merge";
import {
  ActiveMonthProvider,
  useActiveMonth,
  useActiveMonthCoordinator,
} from "@/navigation/active-month";
import { usePrivateCloud } from "@/features/private-cloud/private-cloud-context";
import { CloudDataRefreshBoundary } from "./cloud-data-refresh-boundary";
import { PrivateCloudProvider } from "./private-cloud-provider";

// canonicalize is ESM-only; canonical ordering is covered by the domain Vitest
// suite. These fixed-order fixtures exercise the real runtime/provider lifecycle.
jest.mock("canonicalize", () => ({ __esModule: true, default: JSON.stringify }), { virtual: true });

const mockNativeReload = jest.fn(async () => undefined);
jest.mock("expo", () => ({
  ...jest.requireActual<typeof import("expo")>("expo"),
  reloadAppAsync: () => mockNativeReload(),
}));
const mockDb = { closeAsync: jest.fn(async () => undefined) };
const mockOwnerMounted = jest.fn();
const mockOwnerUnmounted = jest.fn();
let mockRefreshVisible: (() => void) | undefined;
const mockRefreshCalendar = jest.fn(async () => {
  mockRefreshVisible?.();
});
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: true, refreshCalendar: mockRefreshCalendar }),
  usePflegeShiftTestData: () => ({ testMonths: [] }),
}));
jest.mock("@/infrastructure/startup-presentation", () => ({
  startupPresentation: {
    after: (callback: () => void) => {
      callback();
      return () => undefined;
    },
    isReady: () => true,
  },
}));
const mockUnsubscribeAuth = jest.fn();
const mockGetSession = jest.fn(async () => ({ id: "account", displayName: "Luna" }));
jest.mock("@/infrastructure/auth/sharing-auth", () => ({
  createSharingAuthPort: () => ({
    getSession: mockGetSession,
    subscribe: () => mockUnsubscribeAuth,
  }),
  getSharingSupabaseClient: () => ({}),
}));
jest.mock("@/infrastructure/database/private-cloud-repository", () => ({
  migratePrivateCloud: async () => undefined,
  createPrivateCloudLocal: () => mockLocal,
}));
jest.mock("@/infrastructure/database/local-backup-validation", () => ({
  loadCurrentDatabaseSchemaVersion: async () => 33,
}));
jest.mock("@/infrastructure/database/repository", () => ({
  loadProfile: async () => null,
  listCalendarEntries: async () => [],
}));
jest.mock("@/infrastructure/notifications/entry-notifications", () => ({
  cancelAllEntryNotifications: async () => undefined,
  syncEntryNotifications: async () => undefined,
}));
jest.mock("@/infrastructure/private-cloud/cloud-client", () => ({
  createPrivateCloudClient: () => mockRemote,
}));
jest.mock("@/infrastructure/private-cloud/cloud-document", () => ({
  validatePrivateCloudDocument: async (document: unknown) => ({ document }),
}));
jest.mock("@/features/private-cloud/cloud-media", () => ({
  readCloudPresentation: jest.fn(),
  prepareCloudPresentation: jest.fn(),
}));
jest.mock("@/features/account/use-account-photo", () => ({ useAccountPhoto: () => null }));
jest.mock("@/application/save-account-name", () => ({ saveAccountName: jest.fn() }));
jest.mock("@/infrastructure/sharing/cloud-sharing-client", () => ({
  createCloudSharingClient: jest.fn(),
}));

function document(title: string): PrivateCloudDocument {
  return {
    format: "lunashift-private-cloud",
    version: 1,
    backupVersion: 20,
    databaseSchemaVersion: 33,
    data: { shifts: [{ id: "shift", title }] },
    presentation: { calendarImage: null, calendarImageStrength: "medium" },
  };
}
let mockDevice: PrivateCloudDocument;
let mockCloud: PrivateCloudRevision;
let mockState: CloudDeviceState;
const mockApply = jest.fn<CloudLocalPort["apply"]>(async (account, expected, receipt, current) => {
  if (!current() || account !== mockState.accountId || !sameCloudValue(expected, mockDevice))
    return false;
  mockDevice = receipt.document;
  mockState = { ...mockState, baseline: receipt, pending: null };
  return true;
});
const mockLocal: CloudLocalPort = {
  state: async () => mockState,
  capture: async () => mockDevice,
  bind: async () => undefined,
  stage: async () => undefined,
  clearPending: async () => undefined,
  recovery: async () => null,
  apply: mockApply,
};
const mockReadCloud = jest.fn(async () => mockCloud);
const mockWriteCloud = jest.fn<PrivateCloudRemote["write"]>();
const mockRemote: PrivateCloudRemote = {
  read: mockReadCloud,
  history: async () => [mockCloud],
  write: mockWriteCloud,
};
const mockConsumerUnmounted = jest.fn();
function DatabaseOwner({ children }: PropsWithChildren) {
  useEffect(() => {
    mockOwnerMounted(mockDb);
    return () => {
      mockOwnerUnmounted();
      void mockDb.closeAsync();
    };
  }, []);
  return children;
}
function Screen() {
  const { runtime, user, ready } = usePrivateCloud();
  const path = usePathname();
  const { month } = useLocalSearchParams();
  const activeMonth = useActiveMonth();
  const coordinator = useActiveMonthCoordinator();
  const [snapshot, setSnapshot] = useState(mockDevice);
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    mockRefreshVisible = () => setSnapshot(mockDevice);
    return () => {
      mockRefreshVisible = undefined;
      mockConsumerUnmounted();
    };
  }, []);
  return (
    <>
      <Text>{JSON.stringify(snapshot.data)}</Text>
      <Text>{`${path}:${month}`}</Text>
      <Text>{`Monat:${activeMonth}`}</Text>
      <Text>{ready ? user?.id : "initializing"}</Text>
      <Text>{selected ? "selected" : "unselected"}</Text>
      <Button title="Sync" onPress={() => void runtime.synchronize()} />
      <Button title="Auswahl" onPress={() => setSelected(true)} />
      <Button title="Januar" onPress={() => coordinator.setMonth("2027-01")} />
    </>
  );
}
async function open(initialUrl = "/account?month=2027-01") {
  const screen = await renderRouter(
    {
      _layout: () => (
        <DatabaseOwner>
          <ActiveMonthProvider>
            <CloudDataRefreshBoundary>
              <PrivateCloudProvider>
                <Stack />
              </PrivateCloudProvider>
            </CloudDataRefreshBoundary>
          </ActiveMonthProvider>
        </DatabaseOwner>
      ),
      account: Screen,
      "(tabs)/more": Screen,
    },
    { initialUrl },
  );
  await waitFor(() => expect(screen.getByText("account")).toBeTruthy());
  await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
  return screen;
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, "currentState", { value: "active", writable: true });
  mockRefreshVisible = undefined;
  mockDevice = document("before");
  mockCloud = { document: mockDevice, revision: 1, updatedAt: "2026-11-10T20:00:00Z" };
  mockState = { accountId: "account", baseline: mockCloud, pending: null };
});

describe("cloud apply with a live database", () => {
  it("refreshes committed calendar data without remounting consumers, auth or navigation", async () => {
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "Auswahl" }));
    mockCloud = { ...mockCloud, document: document("from-cloud"), revision: 2 };
    await fireEvent.press(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(screen.getByText(/from-cloud/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("account")).toBeTruthy());
    expect(screen.getByText("/account:2027-01")).toBeTruthy();
    expect(mockOwnerMounted).toHaveBeenCalledTimes(1);
    expect(mockOwnerMounted).toHaveBeenCalledWith(mockDb);
    expect(mockOwnerUnmounted).not.toHaveBeenCalled();
    expect(mockDb.closeAsync).not.toHaveBeenCalled();
    expect(mockNativeReload).not.toHaveBeenCalled();
    expect(mockUnsubscribeAuth).not.toHaveBeenCalled();
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockConsumerUnmounted).not.toHaveBeenCalled();
    expect(mockRefreshCalendar).toHaveBeenCalledTimes(1);
    expect(screen.getByText("selected")).toBeTruthy();
    expect(mockWriteCloud).not.toHaveBeenCalled();
    await screen.unmount();
    expect(mockDb.closeAsync).toHaveBeenCalledTimes(1);
  });

  it("does not refresh unchanged syncs, including the automatic sync after remount", async () => {
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "Sync" }));
    expect(mockConsumerUnmounted).not.toHaveBeenCalled();
    mockCloud = { ...mockCloud, document: document("changed"), revision: 2 };
    await fireEvent.press(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(screen.getByText(/changed/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("account")).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: "Sync" }));
    await fireEvent.press(screen.getByRole("button", { name: "Sync" }));
    expect(mockConsumerUnmounted).not.toHaveBeenCalled();
    expect(mockRefreshCalendar).toHaveBeenCalledTimes(1);
    expect(mockNativeReload).not.toHaveBeenCalled();
    expect(mockDb.closeAsync).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("keeps the browsed month even when the route has no month parameter", async () => {
    const screen = await open("/account");
    await fireEvent.press(screen.getByRole("button", { name: "Januar" }));
    expect(screen.getByText("Monat:2027-01")).toBeTruthy();
    mockCloud = { ...mockCloud, document: document("new-month-data"), revision: 2 };
    await fireEvent.press(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(screen.getByText(/new-month-data/)).toBeTruthy());
    expect(screen.getByText("Monat:2027-01")).toBeTruthy();
    expect(mockDb.closeAsync).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("removes a cloud-deleted entry while the More route and its local state stay open", async () => {
    const screen = await open("/more");
    await fireEvent.press(screen.getByRole("button", { name: "Auswahl" }));
    mockCloud = { ...mockCloud, document: { ...mockDevice, data: { shifts: [] } }, revision: 2 };
    await fireEvent.press(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(screen.queryByText(/before/)).toBeNull());
    expect(screen.getByText("/more:undefined")).toBeTruthy();
    expect(screen.getByText("selected")).toBeTruthy();
    expect(mockConsumerUnmounted).not.toHaveBeenCalled();
    expect(mockNativeReload).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("still refreshes all persisted contexts when presentation data changes", async () => {
    const screen = await open();
    mockCloud = {
      ...mockCloud,
      document: {
        ...document("new-presentation"),
        presentation: { ...mockDevice.presentation, calendarImageStrength: "strong" },
      },
      revision: 2,
    };
    await fireEvent.press(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(screen.getByText(/new-presentation/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("account")).toBeTruthy());
    expect(mockRefreshCalendar).not.toHaveBeenCalled();
    expect(mockConsumerUnmounted).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribeAuth).toHaveBeenCalledTimes(1);
    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(mockDb.closeAsync).not.toHaveBeenCalled();
    await screen.unmount();
  });
});
