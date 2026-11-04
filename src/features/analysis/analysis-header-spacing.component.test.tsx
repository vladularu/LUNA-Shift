import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnalysisMonthHeader } from "./analysis-period-header";

jest.mock("./analysis-view-controls", () => ({ AnalysisViewControls: () => null }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe("compact analysis page header", () => {
  it.each([1, 1.2, 1.6])(
    "keeps complete arrow targets and readable period controls at font scale %s",
    async (fontScale) => {
      jest
        .spyOn(
          jest.requireActual<typeof import("react-native")>("react-native"),
          "useWindowDimensions",
        )
        .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
      const previous = jest.fn(),
        next = jest.fn();
      const screen = await render(
        <SafeAreaProvider initialMetrics={metrics}>
          <AnalysisMonthHeader
            label="So. 1. Nov. - 30. Nov. 2026"
            onPrevious={previous}
            onNext={next}
            onOpenYear={jest.fn()}
          />
        </SafeAreaProvider>,
      );
      const compact = fontScale < 1.3;
      expect(screen.getByTestId("analysis-month-toolbar-header-title-area")).toHaveStyle({
        minHeight: 44,
      });
      expect(screen.getByTestId("analysis-month-toolbar-header-toolbar-area")).toHaveStyle({
        marginTop: compact ? 0 : 6,
      });
      expect(screen.getByTestId("analysis-month-toolbar")).toHaveStyle({
        alignItems: compact ? "flex-start" : "center",
      });
      const back = screen.getByRole("button", { name: /^Vorheriger Monat/ });
      const forward = screen.getByRole("button", { name: /^Nächster Monat/ });
      for (const control of [back, forward]) {
        expect(control).toHaveStyle({
          width: 44,
          height: 44,
          justifyContent: compact ? "flex-start" : "center",
        });
      }
      await fireEvent.press(back);
      await fireEvent.press(forward);
      expect(previous).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("header", { name: "Auswertung" })).toHaveProp(
        "dynamicTypeRamp",
        "largeTitle",
      );
      await screen.unmount();
    },
  );
});
