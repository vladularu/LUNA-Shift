import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { createElement as mockCreateElement } from "react";
import { View, View as MockView } from "react-native";
import { SHIFT_SYMBOLS, shiftSymbolDefinition } from "@/theme/shift-symbols";
import { SharedShiftSymbol } from "./shared-shift-symbol";
import { ShiftSymbol } from "./shift-symbol";

jest.mock("@/ui/icon", () => ({
  __esModule: true,
  default: (props: object) =>
    mockCreateElement(MockView, { ...props, testID: "shared-symbol-icon" }),
}));
jest.mock("react-native-svg", () => ({
  __esModule: true,
  ...jest.requireActual<typeof import("react-native-svg")>("react-native-svg"),
  Path: (props: object) => mockCreateElement(MockView, { ...props, testID: "filled-shift-symbol" }),
}));

describe("sharing protocol icons", () => {
  it.each([
    ["sunrise", "rise"],
    ["sun", "sun"],
    ["moon", "moon"],
    ["home", "home"],
    ["book", "book"],
    ["clock", "time"],
    ["star", "star"],
  ])("renders %s as a filled Luna shift symbol", async (value, id) => {
    const screen = await render(<SharedShiftSymbol value={value} color="#123456" size={15} />);
    const glyph = screen.getByTestId("filled-shift-symbol", { includeHiddenElements: true });
    expect(glyph).toHaveProp("d", shiftSymbolDefinition(id)?.path);
    expect(glyph).toHaveProp("fill", "#123456");
    expect(screen.queryByText(value)).toBeNull();
  });

  it.each([
    ["calendar", "calendar-outline"],
    ["unavailable", "close-circle"],
  ])("renders %s as the matching sharing status icon", async (value, name) => {
    const screen = await render(<SharedShiftSymbol value={value} color="#123456" size={15} />);
    expect(screen.getByTestId("shared-symbol-icon")).toHaveProp("name", name);
    expect(screen.queryByText(value)).toBeNull();
  });
  it("renders each stored shift symbol with its filled glyph", async () => {
    const screen = await render(
      <View>
        {SHIFT_SYMBOLS.map(({ id }) => (
          <ShiftSymbol key={id} value={id} color="#123456" size={21} />
        ))}
      </View>,
    );
    const glyphs = screen.getAllByTestId("filled-shift-symbol", { includeHiddenElements: true });
    expect(glyphs.map((glyph) => glyph.props.d)).toEqual(SHIFT_SYMBOLS.map(({ path }) => path));
  });

  it("keeps personal text symbols and unsupported shared text unchanged", async () => {
    const screen = await render(
      <View>
        <ShiftSymbol value="sunrise" color="#123456" size={15} />
        <SharedShiftSymbol value="F" color="#123456" size={15} />
      </View>,
    );
    expect(screen.getByText("sunrise")).toBeTruthy();
    expect(screen.getByText("F")).toBeTruthy();
  });
});
