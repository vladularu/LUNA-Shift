import { fireEvent, render, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { Keyboard, StyleSheet, Text } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import { ProfilePage } from "./profile-page";
const mockPalette = LIGHT_PALETTE;
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
describe("profile page one-handed footer", () => {
  it("keeps the return action outside the scrolling content and above the home indicator", async () => {
    const screen = await render(
      <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
        <ProfilePage title="Arbeitszeit" backLabel="Zurück zum Arbeitsprofil" onBack={() => {}}>
          <Text>Entwurf</Text>
        </ProfilePage>
      </SafeAreaInsetsContext.Provider>,
    );
    const footer = screen.getByTestId("profile-back-footer");
    expect(
      within(screen.getByTestId("profile-scroll-content")).queryByRole("button", {
        name: "Zurück zum Arbeitsprofil",
      }),
    ).toBeNull();
    const footerStyle = StyleSheet.flatten(footer.props.style);
    expect(footerStyle.position).toBe("absolute");
    expect(footerStyle.bottom).toBeGreaterThanOrEqual(34);
    expect(footerStyle.borderTopWidth).toBeUndefined();
    expect(footerStyle.backgroundColor).toBeUndefined();
    const button = within(footer).getByRole("button", { name: "Zurück zum Arbeitsprofil" });
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(
      StyleSheet.flatten(screen.getByTestId("profile-scroll-content").props.contentContainerStyle)
        .paddingBottom,
    ).toBeGreaterThanOrEqual(34 + 48);
    expect(screen.getByText("Entwurf")).toBeTruthy();
  });
  it("keeps the last content reachable when the floating action grows with larger text", async () => {
    const screen = await render(
      <ProfilePage title="Arbeitszeit" backLabel="Zurück zum Arbeitsprofil" onBack={() => {}}>
        <Text>Letzter Eintrag</Text>
      </ProfilePage>,
    );
    const scroll = () =>
      StyleSheet.flatten(screen.getByTestId("profile-scroll-content").props.contentContainerStyle);
    const initialPadding = scroll().paddingBottom;
    await fireEvent(screen.getByTestId("back-footer-surface"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 345, height: 80 } },
    });
    expect(scroll().paddingBottom).toBeGreaterThanOrEqual(initialPadding + 32);
    expect(screen.getByText("Letzter Eintrag")).toBeTruthy();
  });
  it("dismisses the keyboard and invokes the parent return action", async () => {
    const onBack = jest.fn();
    const dismiss = jest.spyOn(Keyboard, "dismiss");
    const screen = await render(
      <ProfilePage title="Arbeitszeit" backLabel="Zurück zum Arbeitsprofil" onBack={onBack} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Arbeitsprofil" }));
    expect(dismiss).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
    dismiss.mockRestore();
  });
  it("prevents return while the whole draft is being saved", async () => {
    const onBack = jest.fn();
    const screen = await render(
      <ProfilePage
        title="Arbeitszeit"
        backLabel="Zurück zum Arbeitsprofil"
        onBack={onBack}
        backDisabled
      />,
    );
    const button = screen.getByRole("button", { name: "Zurück zum Arbeitsprofil" });
    expect(button.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(button);
    expect(onBack).not.toHaveBeenCalled();
  });
});
