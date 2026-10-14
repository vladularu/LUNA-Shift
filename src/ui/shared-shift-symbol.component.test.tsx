import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { createElement as mockCreateElement } from "react";
import { View, View as MockView } from "react-native";
import { SharedShiftSymbol } from "./shared-shift-symbol";
import { ShiftSymbol } from "./shift-symbol";

jest.mock("@/ui/icon", () => ({
  __esModule: true,
  default: (props: object) =>
    mockCreateElement(MockView, { ...props, testID: "shared-symbol-icon" }),
}));
describe("sharing protocol icons", () => {
  it.each([
    ["sunrise", "weather-sunset-up"],
    ["sun", "white-balance-sunny"],
    ["moon", "weather-night"],
    ["home", "home"],
    ["book", "book-open-variant"],
    ["clock", "clock-outline"],
    ["star", "star"],
    ["calendar", "calendar-outline"],
    ["unavailable", "close-circle"],
  ])("renders %s as the matching Luna icon", async (value, name) => {
    const screen = await render(<SharedShiftSymbol value={value} color="#123456" size={15} />);
    expect(screen.getByTestId("shared-symbol-icon")).toHaveProp("name", name);
    expect(screen.queryByText(value)).toBeNull();
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
