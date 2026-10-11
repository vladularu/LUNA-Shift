import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { Switch } from "@/ui/switch";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { colorContrastRatio } from "@/theme/color-contrast";

describe("Figma switch", () => {
  it.each([false, true])("keeps both toggle states visible in dark=%s", async (dark) => {
    const scheme = jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue(dark ? "dark" : "light");
    try {
      const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
      for (const value of [false, true]) {
        const screen = await render(<Switch accessibilityLabel="Anzeige" value={value} />);
        const track = value ? palette.accent : palette.surfaceMuted;
        const thumb = value ? palette.onAccent : palette.textMuted;
        expect(screen.toJSON()).toMatchObject({
          children: [
            {
              props: { style: expect.objectContaining({ backgroundColor: track }) },
              children: [{ props: { style: expect.objectContaining({ backgroundColor: thumb }) } }],
            },
          ],
        });
        expect(colorContrastRatio(thumb, track)).toBeGreaterThanOrEqual(3);
        await screen.unmount();
      }
    } finally {
      scheme.mockRestore();
    }
  });
  it("keeps the controlled value and reports the next value on press", async () => {
    const onValueChange = jest.fn<(value: boolean) => void>();
    const screen = await render(
      <Switch accessibilityLabel="Anzeige" value onValueChange={onValueChange} />,
    );
    const control = screen.getByRole("switch", { name: "Anzeige", checked: true });
    await fireEvent.press(control);
    expect(onValueChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("switch", { name: "Anzeige", checked: true })).toBeTruthy();
  });

  it("does not toggle a disabled control", async () => {
    const onValueChange = jest.fn<(value: boolean) => void>();
    const screen = await render(
      <Switch accessibilityLabel="Anzeige" disabled onValueChange={onValueChange} />,
    );
    await fireEvent.press(screen.getByRole("switch", { name: "Anzeige" }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
