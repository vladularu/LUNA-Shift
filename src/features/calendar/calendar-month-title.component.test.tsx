import { render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { CalendarMonthTitle } from "./calendar-month-title";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("month page title", () => {
  it("shows the complete target title immediately after a distant jump", async () => {
    const screen = await render(
      <CalendarMonthTitle month="2027-02" referenceMonth="2026-10" accessible />,
    );
    expect(screen.getByRole("header", { name: "Februar 2027" })).toBeVisible();
    await screen.rerender(
      <CalendarMonthTitle month="2026-10" referenceMonth="2026-10" accessible />,
    );
    expect(screen.getByRole("header", { name: "Oktober" })).toBeVisible();
    expect(screen.queryByText("Februar 2027")).toBeNull();
    expect(screen.getAllByRole("header")).toHaveLength(1);
  });
  it("keeps neighboring titles drawn but out of VoiceOver", async () => {
    const screen = await render(
      <CalendarMonthTitle month="2027-01" referenceMonth="2026-10" accessible={false} />,
    );
    expect(screen.queryByRole("header")).toBeNull();
    expect(screen.getByText("Januar 2027", { includeHiddenElements: true })).not.toHaveStyle({
      opacity: 0,
    });
  });
  it.each([1, 1.4, 2])(
    "preserves the existing header typography at font scale %s",
    async (fontScale) => {
      jest
        .spyOn(
          jest.requireActual<typeof import("react-native")>("react-native"),
          "useWindowDimensions",
        )
        .mockReturnValue({ width: 430, height: 932, scale: 3, fontScale });
      const screen = await render(
        <CalendarMonthTitle month="2027-01" referenceMonth="2026-10" accessible />,
      );
      const title = screen.getByRole("header", { name: "Januar 2027" });
      expect(title).toHaveStyle({ height: Math.ceil(41 * fontScale) });
      expect(title.props.maxFontSizeMultiplier).toBe(0);
      expect(title.props.numberOfLines).toBe(1);
    },
  );
});
