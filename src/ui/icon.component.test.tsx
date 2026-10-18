import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { SHIFT_SYMBOLS } from "@/theme/shift-symbols";
import Icon, { DESIGN_ICON_MAP } from "@/ui/icon";
import { SelectionChip, SelectionRow } from "@/ui/selection-option";

jest.mock("lucide-react-native", () => {
  const NativeView = jest.requireActual<typeof import("react-native")>("react-native").View;
  return {
    ...jest.requireActual<object>("lucide-react-native"),
    Plus: (props: object) => <NativeView testID="plus-glyph" {...props} />,
    Check: ({ style }: { style?: StyleProp<ViewStyle> }) => (
      <NativeView testID="check-glyph" style={style} />
    ),
  };
});

describe("Figma icon adapter", () => {
  it.each([false, true])("keeps default icons readable in dark=%s", async (dark) => {
    const scheme = jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue(dark ? "dark" : "light");
    try {
      const screen = await render(<Icon name="add" />);
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
      const screen = await render(<Icon name={symbol.icon} color="#0F172A" size={24} />);
      expect(screen.toJSON()).not.toBeNull();
      await screen.unmount();
    }
  });
});

describe("icon visibility in selection controls", () => {
  it.each(["row", "chip"])("shows a check only on the selected %s", async (variant) => {
    const Option = variant === "row" ? SelectionRow : SelectionChip;
    const screen = await render(
      <View>
        {["Dienst", "Fortbildung", "Urlaub", "Krank", "Frei"].map((label, index) => (
          <Option key={label} label={label} selected={index === 0} onPress={jest.fn()} />
        ))}
      </View>,
    );

    const checks = screen.getAllByTestId("check-glyph", { includeHiddenElements: true });
    expect(checks).toHaveLength(5);
    expect(checks.map((check) => StyleSheet.flatten(check.props.style)?.opacity)).toEqual([
      1, 0, 0, 0, 0,
    ]);
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
  });

  it("preserves opacity and transforms supplied as a style array", async () => {
    const style: StyleProp<TextStyle> = [{ opacity: 0 }, { transform: [{ rotate: "45deg" }] }];
    const screen = await render(<Icon name="checkmark" style={style} />);

    const glyph = screen.getByTestId("check-glyph", { includeHiddenElements: true });
    expect(StyleSheet.flatten(glyph.props.style)).toEqual({
      opacity: 0,
      transform: [{ rotate: "45deg" }],
    });
  });
});
