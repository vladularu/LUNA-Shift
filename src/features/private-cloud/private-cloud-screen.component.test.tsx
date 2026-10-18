import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Redirect } from "expo-router";
import { Alert } from "react-native";
import type { ReactNode } from "react";
import type { PrivateCloudStatus } from "@/application/private-cloud-runtime";
import { PrivateCloudScreen } from "./private-cloud-screen";

const mockSync = jest.fn<(...args: unknown[]) => Promise<void>>();
let mockUser: { id: string; email: string; displayName: string } | null;
let mockStatus: PrivateCloudStatus;
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  Redirect: jest.fn(() => null),
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock("./private-cloud-context", () => ({
  usePrivateCloud: () => ({
    ready: true,
    initializationError: null,
    user: mockUser,
    status: mockStatus,
    runtime: mockRuntime,
  }),
}));
const mockRuntime = {
  isCurrentAccount: (id: string) => mockUser?.id === id,
  synchronize: mockSync,
};
jest.mock("@/ui/back-footer-layout", () => ({
  BackFooterLayout: ({ children }: { children: (bottom: number) => ReactNode }) => children(0),
}));
jest.mock("@/ui/screen-layout", () => ({
  ScreenScrollView: ({ children }: { children: ReactNode }) => children,
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  mockStatus = {
    phase: "signed_out",
    lastSyncedAt: null,
    hasCloudData: false,
    conflictCount: 0,
    requiresFullChoice: false,
    message: null,
  };
  mockSync.mockResolvedValue();
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
async function confirm() {
  await act(async () => {
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)?.[2]
      ?.find((button) => button.text === "Fortfahren")
      ?.onPress?.();
  });
}
describe("required cloud data choice without manual backups", () => {
  it("returns to the common account when signed out", async () => {
    await render(<PrivateCloudScreen />);
    expect(jest.mocked(Redirect).mock.calls.at(-1)?.[0]).toEqual({ href: "/account" });
    expect(mockSync).not.toHaveBeenCalled();
  });
  it("has no backup view or restoration actions even when opened directly while synced", async () => {
    mockUser = { id: "a", email: "luna@example.test", displayName: "Luna" };
    mockStatus = { ...mockStatus, phase: "synced" };
    const screen = await render(<PrivateCloudScreen />);
    expect(jest.mocked(Redirect).mock.calls.at(-1)?.[0]).toEqual({ href: "/account" });
    expect(screen.queryByText("Frühere Sicherungen")).toBeNull();
    expect(screen.queryByText("Vorherigen Gerätestand")).toBeNull();
    expect(screen.queryByText("Sicherung wiederherstellen")).toBeNull();
    expect(screen.queryByText("Jetzt abgleichen")).toBeNull();
    expect(screen.queryByText("Mit diesen Gerätedaten starten")).toBeNull();
    expect(mockSync).not.toHaveBeenCalled();
  });
  it("only shows a data selection for an actual conflict", async () => {
    mockUser = { id: "a", email: "luna@example.test", displayName: "Luna" };
    mockStatus = { ...mockStatus, phase: "conflict", hasCloudData: true };
    const screen = await render(<PrivateCloudScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Daten aus der Cloud" }));
    expect(mockSync).not.toHaveBeenCalled();
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain("luna@example.test");
    expect(screen.queryByText("Frühere Sicherungen")).toBeNull();
    expect(screen.queryByText("Vorherigen Gerätestand")).toBeNull();
    await confirm();
    expect(mockSync).toHaveBeenCalledWith("cloud");
  });
  it("explains replacement before a destructive device choice", async () => {
    mockUser = { id: "a", email: "luna@example.test", displayName: "Luna" };
    mockStatus = { ...mockStatus, phase: "setup", hasCloudData: true };
    const screen = await render(<PrivateCloudScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Daten dieses Geräts" }));
    expect(mockSync).not.toHaveBeenCalled();
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain("ersetzt die Cloud-Daten");
  });
  it("ignores an old selection after account switch", async () => {
    mockUser = { id: "a", email: "a@example.test", displayName: "A" };
    mockStatus = { ...mockStatus, phase: "setup", hasCloudData: true };
    const screen = await render(<PrivateCloudScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Daten aus der Cloud" }));
    mockUser = { id: "b", email: "b@example.test", displayName: "B" };
    await confirm();
    expect(mockSync).not.toHaveBeenCalled();
  });
  it("closes the choice when automatic sync resolves the conflict", async () => {
    mockUser = { id: "a", email: "a@example.test", displayName: "A" };
    mockStatus = { ...mockStatus, phase: "conflict", hasCloudData: true };
    const screen = await render(<PrivateCloudScreen />);
    expect(screen.getByRole("button", { name: "Daten aus der Cloud" })).toBeTruthy();
    mockStatus = { ...mockStatus, phase: "synced" };
    await screen.rerender(<PrivateCloudScreen />);
    expect(jest.mocked(Redirect).mock.calls.at(-1)?.[0]).toEqual({ href: "/account" });
    expect(screen.queryByRole("button", { name: "Daten aus der Cloud" })).toBeNull();
    expect(mockSync).not.toHaveBeenCalled();
  });
});
