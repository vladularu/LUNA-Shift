import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { SHIFT_SYMBOLS } from "@/theme/shift-symbols";
import DesignIcon, { DESIGN_ICON_MAP } from "@/ui/icon";

jest.mock("lucide-react-native", () => ({
  ...jest.requireActual<object>("lucide-react-native"),
  Plus: (props: object) => {
    const { View } = jest.requireActual<typeof import("react-native")>("react-native");
    return <View testID="plus-glyph" {...props} />;
  },
}));

describe("Figma icon adapter", () => {
  it.each([false, true])("keeps default icons readable in dark=%s", async (dark) => {
    const scheme = jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue(dark ? "dark" : "light");
    try {
      const screen = await render(<DesignIcon name="add" />);
      expect(screen.getByTestId("plus-glyph", { includeHiddenElements: true })).toHaveProp(
        "color",
        (dark ? DARK_PALETTE : LIGHT_PALETTE).text,
      );
    } finally {
      scheme.mockRestore();
    }
  });
  it("can draw every existing stored shift symbol without changing its identifier", async () => {
    for (const symbol of SHIFT_SYMBOLS) {
      expect(DESIGN_ICON_MAP[symbol.icon]).toBeDefined();
      const screen = await render(<DesignIcon name={symbol.icon} color="#0F172A" size={24} />);
      expect(screen.toJSON()).not.toBeNull();
      await screen.unmount();
    }
  });
});
