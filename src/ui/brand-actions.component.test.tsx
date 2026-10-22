import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { HeaderAction } from "@/ui/design-system";
import { PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { DestructiveFormAction, HeaderSaveAction } from "@/ui/form-layout";

let mockPalette = LIGHT_PALETTE;
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));

describe("shared brand actions", () => {
  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "keeps theme fills, readable labels and secondary text in dark=$dark",
    async (palette) => {
      mockPalette = palette;
      const onPress = jest.fn();
      const screen = await render(
        <>
          <PrimaryButton onPress={onPress}>Speichern</PrimaryButton>
          <SecondaryButton onPress={() => undefined}>Abbrechen</SecondaryButton>
          <HeaderAction emphasis label="Fertig" onPress={onPress} />
        </>,
      );
      expect(screen.getByRole("button", { name: "Speichern" })).toHaveStyle({
        backgroundColor: palette.primaryAction,
      });
      for (const name of ["Speichern", "Fertig"]) {
        expect(screen.getByText(name)).toHaveStyle({ color: palette.onPrimaryAction });
        await fireEvent.press(screen.getByRole("button", { name }));
      }
      expect(screen.getByText("Abbrechen")).toHaveStyle({ color: palette.primary });
      expect(onPress).toHaveBeenCalledTimes(2);
    },
  );

  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "fills header saves blue and destructive form actions red in dark=$dark",
    async (palette) => {
      mockPalette = palette;
      const save = jest.fn();
      const remove = jest.fn();
      const screen = await render(
        <>
          <HeaderSaveAction busy={false} label="Speichern" onPress={save} />
          <DestructiveFormAction label="Vorlage löschen" onPress={remove} />
          <HeaderAction label="Zurück" onPress={() => undefined} />
        </>,
      );
      expect(screen.getByRole("button", { name: "Speichern und schließen" })).toHaveStyle({
        backgroundColor: palette.primaryAction,
      });
      expect(screen.getByText("Speichern")).toHaveStyle({ color: palette.onPrimaryAction });
      expect(screen.getByRole("button", { name: "Vorlage löschen" })).toHaveStyle({
        backgroundColor: palette.dangerAction,
        borderWidth: 0,
      });
      expect(screen.getByText("Vorlage löschen")).toHaveStyle({ color: palette.onDanger });
      expect(screen.getByText("Zurück")).toHaveStyle({ color: palette.primary });
      await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
      await fireEvent.press(screen.getByRole("button", { name: "Vorlage löschen" }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);

      await screen.rerender(
        <>
          <HeaderSaveAction busy label="Speichern" onPress={save} />
          <DestructiveFormAction disabled label="Vorlage löschen" onPress={remove} />
        </>,
      );
      await fireEvent.press(screen.getByRole("button", { name: "Änderungen werden gespeichert" }));
      await fireEvent.press(screen.getByRole("button", { name: "Vorlage löschen" }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
    },
  );
});
