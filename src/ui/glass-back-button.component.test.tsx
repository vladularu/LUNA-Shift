import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AccessibilityInfo } from "react-native";

import { LIGHT_PALETTE } from "@/theme/palette-values";
import { GlassSurfaceVisibilityContext } from "./glass-appearance";
import { GlassBackButton } from "./glass-back-button";
import { pageBackButtonOptions } from "./native-page-header";

jest.mock("expo-glass-effect", () => ({
  GlassView: jest.requireActual<typeof import("react-native")>("react-native").View,
  isGlassEffectAPIAvailable: () => true,
  isLiquidGlassAvailable: () => true,
}));

describe("shared glass back button", () => {
  beforeEach(() => {
    jest.mocked(AccessibilityInfo.isReduceTransparencyEnabled).mockResolvedValue(false);
  });

  it("keeps the same target and callback in native toolbars and custom headers", async () => {
    const onBack = jest.fn();
    const options = pageBackButtonOptions(onBack, "Zurück zum Gehalt", true);
    const items = options.unstable_headerLeftItems({ canGoBack: false });
    expect(items[0].hidesSharedBackground).toBe(true);
    const screen = await render(items[0].element);
    expect(screen.getByRole("button", { name: "Zurück zum Gehalt" })).toHaveStyle({
      width: 44,
      height: 44,
    });
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Gehalt" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(pageBackButtonOptions().headerLeft({ canGoBack: false })).toBeNull();
  });

  it("uses an opaque fallback when reduced transparency is enabled", async () => {
    const setting = jest
      .spyOn(AccessibilityInfo, "isReduceTransparencyEnabled")
      .mockResolvedValue(true);
    try {
      const screen = await render(<GlassBackButton onPress={() => undefined} testID="back" />);
      expect(screen.getByTestId("back-surface").props.glassEffectStyle).toBeUndefined();
      expect(screen.getByTestId("back-surface")).toHaveStyle({
        backgroundColor: LIGHT_PALETTE.surface,
      });
    } finally {
      setting.mockRestore();
    }
  });

  it("disables the native material in prepared, inactive report pages", async () => {
    const screen = await render(
      <GlassSurfaceVisibilityContext.Provider value={false}>
        <GlassBackButton onPress={() => undefined} testID="inactive-back" />
      </GlassSurfaceVisibilityContext.Provider>,
    );
    expect(screen.getByTestId("inactive-back-surface").props.glassEffectStyle).toBeUndefined();
  });
});
