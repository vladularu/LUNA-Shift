import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { TYPOGRAPHY } from "@/theme/typography";

import {
  ShiftTemplateAddRow,
  ShiftTemplateListRow,
} from "@/features/templates/shift-template-list";

const title = "Frühdienst auf der interdisziplinären Station";
const subtitle = "07:00–15:12 · 30 Min. Pause · Übergabe auf Station 3";
let mockPalette = LIGHT_PALETTE;

jest.mock("@/theme/palette", () => ({
  ...jest.requireActual<typeof import("@/theme/palette")>("@/theme/palette"),
  usePalette: () => mockPalette,
}));

async function renderRow(disabled = false, withMoreAction = true) {
  const onPress = jest.fn();
  const onMorePress = jest.fn();
  const props = {
    accessibilityLabel: `${title}, ${subtitle}, Vorlage bearbeiten`,
    color: "#33A889",
    disabled,
    onPress,
    subtitle,
    symbol: "sunny-outline",
    testID: "template-row",
    title,
  };
  const screen = await render(
    withMoreAction ? (
      <ShiftTemplateListRow
        {...props}
        moreAccessibilityLabel="Vorlage verwalten"
        onMorePress={onMorePress}
      />
    ) : (
      <ShiftTemplateListRow {...props} />
    ),
  );
  return { screen, onPress, onMorePress };
}

describe("shift template list text reflow", () => {
  beforeEach(() => {
    mockPalette = LIGHT_PALETTE;
  });

  it.each([
    { mode: "light", palette: LIGHT_PALETTE },
    { mode: "dark", palette: DARK_PALETTE },
  ])(
    "keeps primary names, muted descriptions and unrestricted text wrapping in $mode",
    async ({ palette }) => {
      mockPalette = palette;
      const { screen } = await renderRow();
      expect(screen.getByText(title)).toHaveStyle({ ...TYPOGRAPHY.body, color: palette.text });
      expect(screen.getByText(subtitle)).toHaveStyle({
        ...TYPOGRAPHY.caption,
        color: palette.textMuted,
      });
      for (const text of [title, subtitle]) {
        const label = screen.getByText(text);
        expect(label.props.numberOfLines).toBeUndefined();
        expect(label.props.adjustsFontSizeToFit).not.toBe(true);
        expect(label.props.allowFontScaling).not.toBe(false);
        expect(label).toHaveProp("maxFontSizeMultiplier", 0);
        expect(label.parent).toHaveStyle({ minWidth: 0, flex: 1 });
      }
      expect(screen.getByTestId("template-row")).toHaveStyle({ minHeight: 72 });
      expect(screen.getByTestId("template-row")).not.toHaveStyle({ height: 72 });
      expect(screen.getByRole("button", { name: "Vorlage verwalten" })).toHaveStyle({
        width: 44,
        height: 44,
      });
    },
  );

  it("keeps editing and management as separate actions with complete labels", async () => {
    const { screen, onPress, onMorePress } = await renderRow();
    await fireEvent.press(
      screen.getByRole("button", { name: `${title}, ${subtitle}, Vorlage bearbeiten` }),
    );
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onMorePress).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Vorlage verwalten" }));
    expect(onMorePress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("keeps both actions disabled during an operation", async () => {
    const { screen, onPress, onMorePress } = await renderRow(true);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      await fireEvent.press(button);
    }
    expect(onPress).not.toHaveBeenCalled();
    expect(onMorePress).not.toHaveBeenCalled();
  });

  it("offers only the row action when no separate action is supplied", async () => {
    const { screen, onPress, onMorePress } = await renderRow(false, false);
    const buttons = screen.getAllByRole("button");

    expect(buttons).toHaveLength(1);
    await fireEvent.press(buttons[0]);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onMorePress).not.toHaveBeenCalled();
  });

  it("bounds the add label while allowing the row to grow and keeping its action", async () => {
    const onPress = jest.fn();
    const screen = await render(
      <ShiftTemplateAddRow accessibilityLabel="Neue Dienstvorlage erstellen" onPress={onPress} />,
    );
    const label = screen.getByText("Dienstvorlage erstellen");
    expect(label).toHaveStyle({ flex: 1, minWidth: 0 });
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label).toHaveProp("maxFontSizeMultiplier", 0);
    const button = screen.getByRole("button", { name: "Neue Dienstvorlage erstellen" });
    expect(button).toHaveStyle({ minHeight: 64, paddingVertical: 8 });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
