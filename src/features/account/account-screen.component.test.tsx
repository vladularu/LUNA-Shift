import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { ReactNode } from "react";
import { router } from "expo-router";
import { AccountScreen } from "./account-screen";
import { AccountNameScreen } from "./account-name-screen";
import { PrivateCloudContext } from "@/features/private-cloud/private-cloud-context";
import type { SharingAuthUser } from "@/infrastructure/auth/sharing-auth";

const mockApple = jest.fn<() => Promise<unknown>>();
const mockGoogle = jest.fn<() => Promise<unknown>>();
const mockLogout = jest.fn<() => Promise<void>>();
const mockDelete = jest.fn<() => Promise<void>>();
const mockSave = jest.fn<(id: string, first: string, last: string) => Promise<void>>();
const mockRefresh = jest.fn<() => Promise<void>>();
let mockUser: SharingAuthUser | null;
let mockDeletionAvailable = true;
jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: { title?: string; headerRight?: () => ReactNode } }) =>
      options.title === "Konto" ? (options.headerRight?.() ?? null) : null,
  },
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 88 }));
jest.mock("@/infrastructure/auth/sharing-auth", () => ({
  isSharingAppleSignInAvailable: async () => true,
  createSharingAuthPort: () => ({
    isConfigured: true,
    signInApple: mockApple,
    signInGoogle: mockGoogle,
    signOut: mockLogout,
  }),
}));
jest.mock("@/features/sharing/sharing-ui-provider", () => ({
  useSharingUiController: () => ({
    status: "signedIn",
    busy: false,
    accountDeletionAvailable: mockDeletionAvailable,
    signOut: mockLogout,
    deleteAccount: mockDelete,
  }),
}));
jest.mock("@/ui/back-footer-layout", () => ({
  BackFooterLayout: ({ children }: { children: (bottom: number) => unknown }) => children(0),
}));

function Harness({
  name = false,
  phase = "synced",
}: {
  name?: boolean;
  phase?: "synced" | "setup";
}) {
  return (
    <PrivateCloudContext
      value={{
        user: mockUser,
        ready: true,
        initializationError: null,
        status: {
          phase,
          lastSyncedAt: phase === "synced" ? "2026-10-18T12:30:00Z" : null,
          hasCloudData: false,
          conflictCount: 0,
          requiresFullChoice: false,
          message: null,
        },
        runtime: { isCurrentAccount: (id: string) => id === mockUser?.id } as never,
        refreshAccount: mockRefresh,
        saveName: mockSave,
      }}
    >
      {name ? <AccountNameScreen /> : <AccountScreen />}
    </PrivateCloudContext>
  );
}
async function confirm(text: string) {
  await act(async () => {
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)?.[2]
      ?.find((button) => button.text === text)
      ?.onPress?.();
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "a", displayName: "Alex Sommer", email: "alex@example.test" };
  mockDeletionAvailable = true;
  mockApple.mockResolvedValue(null);
  mockGoogle.mockResolvedValue(null);
  mockLogout.mockResolvedValue();
  mockDelete.mockResolvedValue();
  mockSave.mockResolvedValue();
  mockRefresh.mockResolvedValue();
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
describe("shared LUNA account", () => {
  it("shows identity, sync and name without backup actions or an account menu", async () => {
    const screen = await render(<Harness />);
    expect(screen.getByText("AS")).toBeTruthy();
    expect(screen.getByText("Sync-Status: Aktiv")).toBeTruthy();
    expect(screen.getByText(/Letzter Sync:/)).toBeTruthy();
    expect(screen.queryByText("Passwort")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Name/ }));
    expect(router.push).toHaveBeenLastCalledWith("/account-name");
    expect(screen.queryByRole("button", { name: "Sicherungen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kontoaktionen" })).toBeNull();
    expect(screen.queryByText("Sicherung wiederherstellen")).toBeNull();
    expect(screen.queryByText("Vorherigen Gerätestand")).toBeNull();
    expect(screen.queryByText("Daten auswählen")).toBeNull();
    await screen.rerender(<Harness phase="setup" />);
    expect(screen.getByText("Sync-Status: Auswahl erforderlich")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Daten auswählen/ }));
    expect(router.push).toHaveBeenLastCalledWith("/private-cloud");
  });
  it("offers only Apple/Google and serializes provider requests", async () => {
    mockUser = null;
    let done!: () => void;
    mockGoogle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = () => resolve(null);
        }),
    );
    const screen = await render(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mit Apple fortfahren" })).toBeTruthy(),
    );
    expect(screen.queryByLabelText("E-Mail")).toBeNull();
    expect(screen.queryByLabelText("Passwort")).toBeNull();
    expect(screen.getByText("Anmelden und automatisch synchronisieren.")).toBeTruthy();
    expect(screen.queryByText(/anschließend selbst ein/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Mit Google fortfahren" }));
    expect(screen.getByRole("button", { name: "Mit Apple fortfahren" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Mit Apple fortfahren" }));
    expect(mockApple).not.toHaveBeenCalled();
    await act(async () => done());
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "Mit Apple fortfahren" }));
    expect(mockApple).toHaveBeenCalledTimes(1);
  });
  it("hides raw provider errors", async () => {
    mockUser = null;
    mockGoogle.mockRejectedValueOnce(new Error("private backend secret"));
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByRole("button", { name: "Mit Google fortfahren" }));
    expect(
      screen.getByText("Das hat gerade nicht funktioniert. Bitte versuche es erneut."),
    ).toBeTruthy();
    expect(screen.queryByText(/backend secret/)).toBeNull();
  });
  it.each(["Abmelden", "Konto löschen"])("requires confirmation for %s", async (label) => {
    const screen = await render(<Harness />);
    const action = label === "Abmelden" ? mockLogout : mockDelete;
    await fireEvent.press(screen.getByRole("button", { name: label }));
    expect(action).not.toHaveBeenCalled();
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain("Daten bleiben");
    if (label === "Konto löschen")
      expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain(
        "Cloud-Sicherungen und Kalenderfreigaben",
      );
    await confirm(label);
    expect(action).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
  it("renders deletion as a centered text action with a full touch target", async () => {
    const screen = await render(<Harness />);
    const action = screen.getByRole("button", { name: "Konto löschen" });
    expect(action).toHaveStyle({ minHeight: 44, alignItems: "center", justifyContent: "center" });
    expect(screen.getByText("Konto löschen")).toHaveStyle({ textAlign: "center" });
  });
  it("blocks unavailable deletion and stale destructive confirmations", async () => {
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByRole("button", { name: "Konto löschen" }));
    mockUser = { id: "b", displayName: "Andere Person" };
    await confirm("Konto löschen");
    expect(mockDelete).not.toHaveBeenCalled();
    mockDeletionAvailable = false;
    await screen.rerender(<Harness />);
    expect(screen.getByRole("button", { name: "Konto löschen" })).toBeDisabled();
  });
});
describe("account name editor", () => {
  it("prefills first/last name and saves the same account before closing", async () => {
    const screen = await render(<Harness name />);
    expect(screen.getByLabelText("Vorname").props.value).toBe("Alex");
    expect(screen.getByLabelText("Nachname").props.value).toBe("Sommer");
    await fireEvent.changeText(screen.getByLabelText("Vorname"), "Kim");
    await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
    expect(mockSave).toHaveBeenCalledWith("a", "Kim", "Sommer");
    expect(router.back).toHaveBeenCalledTimes(1);
  });
  it("keeps failures retryable and does not close after a late account switch", async () => {
    mockSave.mockRejectedValueOnce(new Error("private backend secret"));
    const screen = await render(<Harness name />);
    await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
    expect(
      screen.getByText("Dein Name konnte nicht gespeichert werden. Bitte versuche es erneut."),
    ).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    let done!: () => void;
    mockSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
    mockUser = { id: "b", displayName: "Neue Person" };
    await screen.rerender(<Harness name />);
    expect(screen.getByLabelText("Vorname").props.value).toBe("Neue");
    await act(async () => done());
    expect(router.back).not.toHaveBeenCalled();
  });
});
