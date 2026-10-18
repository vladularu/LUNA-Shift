import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";

import { SettingsInfoDetailsScreen } from "@/features/settings/settings-info-details-screen";

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ section: "STORAGE" }),
}));

describe("SettingsInfoDetailsScreen location disclosure", () => {
  it("names the external providers and the no-tracking boundary", async () => {
    const screen = await render(<SettingsInfoDetailsScreen />);

    expect(
      screen.getByText(/Apple \(iOS\) oder den systemseitigen Geocoder \(Android\)/),
    ).toBeTruthy();
    expect(screen.getByText(/aktuelle GPS-Position wird nicht abgefragt/)).toBeTruthy();
    expect(screen.getByText(/Ab drei Zeichen/)).toBeVisible();
    expect(
      screen.getByText(/Android kann dafür trotzdem eine Standortberechtigung verlangen/),
    ).toBeVisible();
    expect(screen.getByText(/Karten von Apple \(iOS\) oder Google \(Android\)/)).toBeTruthy();
    expect(screen.getByText(/nicht an einen LUNA Shift-Server/)).toBeTruthy();
    expect(screen.getByText(/Beim Öffnen einer Karten-App gehen die Koordinaten/)).toBeVisible();
    expect(screen.getByText(/Koordinaten bleiben außerdem verschlüsselt/)).toBeVisible();
    expect(
      screen.getByText(/Datenschutzbedingungen von Apple beziehungsweise Google/),
    ).toBeVisible();
  });
});
