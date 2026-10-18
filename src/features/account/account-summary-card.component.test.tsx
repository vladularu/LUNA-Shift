import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { PrivateCloudContext } from "@/features/private-cloud/private-cloud-context";
import { AccountSummaryCard } from "./account-summary-card";
import type { SharingAuthUser } from "@/infrastructure/auth/sharing-auth";
import type { PrivateCloudStatus } from "@/application/private-cloud-runtime";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
let mockFontScale = 1;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));
function Card({
  user = null,
  phase = "signed_out",
  ready = true,
}: {
  user?: SharingAuthUser | null;
  phase?: PrivateCloudStatus["phase"];
  ready?: boolean;
}) {
  return (
    <PrivateCloudContext value={{ user, ready, status: { phase, lastSyncedAt: null } } as never}>
      <AccountSummaryCard />
    </PrivateCloudContext>
  );
}
describe("More Cloud account card", () => {
  beforeEach(() => {
    mockFontScale = 1;
  });
  it("shows a guest action and opens the shared account", async () => {
    const screen = await render(<Card />);
    expect(screen.getByText("Anmelden")).toBeTruthy();
    expect(screen.getByHintText("Anmelden. Cloud: Nicht angemeldet")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Konto" }));
    expect(router.push).toHaveBeenCalledWith("/account");
  });
  it("uses the current Cloud identity and discards it after account switch or logout", async () => {
    const screen = await render(
      <Card user={{ id: "a", displayName: "Vlad Ularu" }} phase="synced" />,
    );
    expect(screen.getByText("VU")).toBeTruthy();
    expect(screen.getByText("Vlad Ularu")).toBeTruthy();
    expect(screen.getByHintText("Vlad Ularu. Cloud: Aktiv")).toBeTruthy();
    await screen.rerender(<Card user={{ id: "b", displayName: "Alex Sommer" }} phase="error" />);
    expect(screen.queryByText("Vlad Ularu")).toBeNull();
    expect(screen.getByText("AS")).toBeTruthy();
    expect(screen.getByHintText("Alex Sommer. Cloud: Abgleich offen")).toBeTruthy();
    expect(screen.queryByHintText("Vlad Ularu. Cloud: Aktiv")).toBeNull();
    await screen.rerender(<Card />);
    expect(screen.queryByText("Alex Sommer")).toBeNull();
    expect(screen.getByText("Anmelden")).toBeTruthy();
  });
  it("does not display a stale name or success while the account is loading", async () => {
    const screen = await render(
      <Card user={{ id: "a", displayName: "Vlad Ularu" }} phase="synced" ready={false} />,
    );
    expect(screen.queryByText("Vlad Ularu")).toBeNull();
    expect(screen.getByHintText("Wird geladen …. Cloud: Wird geladen …")).toBeTruthy();
    expect(screen.queryByHintText("Vlad Ularu. Cloud: Aktiv")).toBeNull();
  });
  it("keeps the account name and sync status available with large text", async () => {
    mockFontScale = 2;
    const screen = await render(
      <Card user={{ id: "a", displayName: "Vlad Ularu" }} phase="synced" />,
    );
    expect(screen.getByText("Vlad Ularu")).toBeTruthy();
    expect(screen.getByHintText("Vlad Ularu. Cloud: Aktiv")).toBeTruthy();
    expect(screen.queryByText("VU")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Konto" }));
    expect(router.push).toHaveBeenCalledWith("/account");
  });
});
