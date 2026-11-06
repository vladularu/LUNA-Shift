import { render, fireEvent } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { Text, StyleSheet } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as PaletteModule from "@/theme/palette";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { SPACING } from "@/theme/tokens";
import { SalaryPage } from "./salary-ui";

jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));

describe("salary page bottom safe area", () => {
  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "keeps the bottom inset inside the scroll content (dark=$dark)",
    async (palette) => {
      jest.spyOn(PaletteModule, "usePalette").mockReturnValue(palette);
      const page = (bottom: number) => (
        <SafeAreaInsetsContext.Provider value={{ top: 59, bottom, left: 0, right: 0 }}>
          <SalaryPage title="Gehalt & Netto" showBackFooter={false}>
            <Text>Letzter Inhalt</Text>
          </SalaryPage>
        </SafeAreaInsetsContext.Provider>
      );
      const screen = await render(page(34));
      expect(screen.getByTestId("salary-page-safe-area").props.edges.bottom).toBe("off");
      expect(screen.queryByTestId("salary-back-footer")).toBeNull();
      const scroll = screen.getByTestId("salary-scroll-content");
      expect(scroll.props.contentInsetAdjustmentBehavior).toBe("never");
      expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(34);
      expect(scroll).toHaveStyle({ backgroundColor: palette.groupedBackground });

      await screen.rerender(page(0));
      expect(
        StyleSheet.flatten(screen.getByTestId("salary-scroll-content").props.contentContainerStyle)
          .paddingBottom,
      ).toBe(SPACING.lg);
      expect(screen.getByText("Letzter Inhalt")).toBeTruthy();
    },
  );

  it("retains the existing back footer and its scroll clearance on other salary details", async () => {
    const screen = await render(
      <SafeAreaInsetsContext.Provider value={{ top: 59, bottom: 34, left: 0, right: 0 }}>
        <SalaryPage title="Gehaltsdetails">
          <Text>Letzter Inhalt</Text>
        </SalaryPage>
      </SafeAreaInsetsContext.Provider>,
    );
    expect(screen.getByTestId("salary-back-footer")).toHaveStyle({ bottom: 34 });
    expect(
      StyleSheet.flatten(screen.getByTestId("salary-scroll-content").props.contentContainerStyle)
        .paddingBottom,
    ).toBe(34 + 48 + SPACING.lg);
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Gehalt" }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
