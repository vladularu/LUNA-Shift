import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { SelectionControl } from "@/ui/selection-control";
import { SelectionChip, SelectionRow } from "@/ui/selection-option";

let mockSelectionPalette = LIGHT_PALETTE;
jest.mock("@/theme/palette", () => ({ usePalette: () => mockSelectionPalette }));

const items = [
  { value: "tariff", label: "Nach Tarif" },
  { value: "manual", label: "Eigenes Brutto" },
] as const;
const nativeModule = jest.requireActual<typeof import("react-native")>("react-native");

describe("shared selection family", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockSelectionPalette = LIGHT_PALETTE;
    jest
      .spyOn(nativeModule, "useWindowDimensions")
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  });

  it("announces a setting as a radio choice and reflects the controlled value after one callback", async () => {
    const onChange = jest.fn();
    const screen = await render(
      <SelectionControl
        items={items}
        value="tariff"
        onChange={onChange}
        accessibilityLabel="Gehaltsgrundlage"
      />,
    );
    expect(screen.getByRole("radio", { name: "Nach Tarif", checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Eigenes Brutto" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("manual");
    await screen.rerender(
      <SelectionControl
        items={items}
        value="manual"
        onChange={onChange}
        accessibilityLabel="Gehaltsgrundlage"
      />,
    );
    expect(screen.getByRole("radio", { name: "Eigenes Brutto", checked: true })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Nach Tarif", checked: false })).toBeTruthy();
  });

  it("keeps disabled settings, chips and rows from invoking their actions", async () => {
    const onPress = jest.fn();
    const screen = await render(
      <>
        <SelectionControl items={items} value="tariff" onChange={onPress} disabled />
        <SelectionChip label="Nacht" selected onPress={onPress} disabled />
        <SelectionRow label="Zum Dienstbeginn" selected onPress={onPress} disabled />
      </>,
    );
    for (const name of ["Eigenes Brutto", "Nacht", "Zum Dienstbeginn"]) {
      const choice = screen.getByRole("radio", { name, disabled: true });
      await fireEvent.press(choice);
    }
    expect(onPress).not.toHaveBeenCalled();
  });

  it("stacks large text without shrinking labels or expanding touch areas over adjacent options", async () => {
    jest
      .spyOn(nativeModule, "useWindowDimensions")
      .mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 2 });
    const screen = await render(
      <SelectionControl
        items={items}
        value="tariff"
        onChange={jest.fn()}
        testID="large-selection"
      />,
    );
    expect(screen.getByTestId("large-selection")).toHaveStyle({
      flexDirection: "column",
      borderRadius: 12,
    });
    for (const item of items) {
      const option = screen.getByRole("radio", { name: item.label });
      expect(option).toHaveStyle({ minHeight: 44, borderRadius: 8 });
      expect(option.props.hitSlop).toBeUndefined();
      const text = screen.getByText(item.label);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.maxFontSizeMultiplier).toBe(0);
      expect(text.props.adjustsFontSizeToFit).not.toBe(true);
    }
  });

  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "uses semantic selection colors for dark=$dark",
    async (palette) => {
      mockSelectionPalette = palette;
      const screen = await render(
        <SelectionControl
          items={items}
          value="tariff"
          onChange={jest.fn()}
          testID="mode-selection"
        />,
      );
      expect(screen.getByTestId("mode-selection")).toHaveStyle({
        backgroundColor: palette.selectionTrack,
        borderRadius: 12,
        borderCurve: "continuous",
      });
      expect(screen.getByTestId("mode-selection:active-surface")).toHaveStyle({
        borderRadius: 8,
        borderCurve: "continuous",
      });
      expect(screen.getByText("Nach Tarif")).toHaveStyle({ color: palette.text });
      expect(screen.getByRole("radio", { name: "Nach Tarif", checked: true })).toBeTruthy();
    },
  );

  it("preserves actions and selected state in long rows and filter chips", async () => {
    const onPress = jest.fn();
    const screen = await render(
      <>
        <SelectionChip label="Nacht" caption="120,00 €" selected onPress={onPress} />
        <SelectionRow label="Benutzerdefiniert" selected={false} onPress={onPress} navigation />
      </>,
    );
    expect(screen.getByRole("radio", { name: "Nacht", checked: true })).toHaveStyle({
      borderRadius: 999,
    });
    expect(screen.getByText("120,00 €")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Benutzerdefiniert", checked: false }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
