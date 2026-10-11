import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { SheetBackFooter } from "./sheet-back-footer";

let mockPalette = LIGHT_PALETTE;
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));

beforeEach(() => {
  mockPalette = LIGHT_PALETTE;
  jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(true);
  jest.mocked(isLiquidGlassAvailable).mockReturnValue(true);
  jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(false);
});

describe("floating back action platform boundary", () => {
  it("supports the close action without changing its save semantics", async () => {
    const onPress = jest.fn();
    const screen = await render(
      <SheetBackFooter
        accessibilityLabel="Schließen und speichern"
        icon="close"
        label="Schließen"
        onPress={onPress}
      />,
    );
    expect(screen.getByText("Schließen")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it("uses available native glass with the selected app theme and preserves the back action", async () => {
    mockPalette = DARK_PALETTE;
    const onPress = jest.fn();
    const screen = await render(<SheetBackFooter label="Zurück zu Mehr" onPress={onPress} />);
    expect(screen.getByTestId("back-footer-surface").props.colorScheme).toBe("dark");
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zu Mehr" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("keeps a usable return action when the native glass API is unavailable", async () => {
    jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(false);
    const onPress = jest.fn();
    const screen = await render(<SheetBackFooter onPress={onPress} />);
    expect(isLiquidGlassAvailable).not.toHaveBeenCalled();
    expect(screen.getByTestId("back-footer-surface").props.isInteractive).toBeUndefined();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("uses an opaque surface when iOS reduces transparency and still blocks return while saving", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(true);
    const onPress = jest.fn();
    const screen = await render(<SheetBackFooter disabled onPress={onPress} />);
    await waitFor(() => {
      const surface = screen.getByTestId("back-footer-surface");
      expect(surface.props.isInteractive).toBeUndefined();
      expect(StyleSheet.flatten(surface.props.style).backgroundColor).toBe(LIGHT_PALETTE.surface);
    });
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
