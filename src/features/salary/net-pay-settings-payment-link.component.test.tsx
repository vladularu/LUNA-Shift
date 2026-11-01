import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { Text as MockText } from "react-native";
import type { ReactNode } from "react";
import { NetPaySettingsScreen } from "./net-pay-settings-screen";

const mockNavigate = jest.fn();
const mockSave = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ month: "2027-01" }),
  router: { push: (route: unknown) => mockNavigate(route), canGoBack: () => true, back: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 0,
  HeaderBackButton: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual<typeof import("react-native-safe-area-context")>(
    "react-native-safe-area-context",
  ),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: { federalState: "NW" } }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
  usePflegeShiftTestData: () => ({ testMonths: [] }),
}));
jest.mock("./use-net-pay-profile", () => ({
  useNetPayProfile: () => ({
    status: "ready",
    saved: null,
    timeline: [],
    busy: false,
    save: mockSave,
  }),
}));
jest.mock("./net-pay-setup-form", () => ({
  NetPaySetupForm: ({
    renderLayout,
  }: {
    renderLayout: (value: { content: ReactNode; footer: ReactNode; locked: boolean }) => ReactNode;
  }) =>
    renderLayout({
      content: <MockText>Bestehendes Netto-Formular</MockText>,
      footer: <MockText>Netto speichern</MockText>,
      locked: false,
    }),
}));

describe("allowance timing entry from net settings", () => {
  it("retains the legacy net form without a hidden payout detour", async () => {
    const screen = await render(<NetPaySettingsScreen />);
    expect(screen.getByText("Bestehendes Netto-Formular")).toBeTruthy();
    expect(screen.getByText("Netto speichern")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Auszahlung der Zulagen" })).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
