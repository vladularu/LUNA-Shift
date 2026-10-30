import { describe, expect, it } from "vitest";

import {
  accessibleChipBackgroundColor,
  calendarChipPalette,
  sharedCalendarChipPalette,
  chipTextColor,
  colorContrastRatio,
  MINIMUM_TEXT_CONTRAST,
  MINIMUM_UI_CONTRAST,
  relativeLuminance,
} from "@/theme/color-contrast";
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from "@/theme/palette-values";
import { SHIFT_PRESET_COLOR_PAIRS, shiftDisplayColor } from "@/theme/shift-colors";
import { SHIFT_COLOR_SWATCHES } from "@/theme/color-grid";

describe("optional pastel shift colors", () => {
  it.each([
    ["#4FCB68", "#DDF4E2"],
    ["#F05C68", "#F9DDE0"],
    ["#F2A93B", "#FCEBCC"],
    ["#31A7C3", "#D8F0F5"],
    ["#2F80ED", "#DCEAFE"],
    ["#858A8E", "#E5E7E8"],
  ])("recognizes the previously offered preset %s without rewriting it", (main, soft) => {
    expect(shiftDisplayColor(main, false)).toBe(main);
    expect(shiftDisplayColor(main.toLowerCase(), true)).toBe(soft);
    for (const dark of [false, true]) {
      const chip = calendarChipPalette(main, dark, true);
      expect(chip.main).toBe(soft);
      expect(colorContrastRatio(chip.onMain, chip.main)).toBeGreaterThanOrEqual(4.5);
      expect(colorContrastRatio(chip.onDetail, chip.detail)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([false, true])("uses preset pairs with readable labels in dark=%s", (dark) => {
    for (const { main, soft } of SHIFT_PRESET_COLOR_PAIRS) {
      expect(shiftDisplayColor(main)).toBe(main);
      expect(shiftDisplayColor(main.toLowerCase(), true)).toBe(soft);
      const chip = calendarChipPalette(main, dark, true);
      expect(chip.main).toBe(soft);
      expect(colorContrastRatio(chip.onMain, chip.main)).toBeGreaterThanOrEqual(4.5);
      expect(colorContrastRatio(chip.onDetail, chip.detail)).toBeGreaterThanOrEqual(4.5);
      const shared = sharedCalendarChipPalette(main, dark, true);
      expect(colorContrastRatio(shared.onDetail, shared.detail)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([false, true])(
    "renders every individual swatch as a readable pastel in dark=%s",
    (dark) => {
      for (const color of SHIFT_COLOR_SWATCHES) {
        const fill = shiftDisplayColor(color, true);
        expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
        expect(relativeLuminance(fill)).toBeGreaterThan(0.65);
        const chip = calendarChipPalette(color, dark, true);
        expect(colorContrastRatio(chip.onMain, chip.main)).toBeGreaterThanOrEqual(4.5);
        expect(colorContrastRatio(chip.onDetail, chip.detail)).toBeGreaterThanOrEqual(4.5);
        const shared = sharedCalendarChipPalette(color, dark, true);
        expect(colorContrastRatio(shared.onDetail, shared.detail)).toBeGreaterThanOrEqual(4.5);
        expect(shiftDisplayColor(fill, true)).toBe(fill);
        expect(shiftDisplayColor(color, false)).toBe(color);
      }
    },
  );

  it("derives individual pastels while retaining originals and accepted preset pairs", () => {
    expect(shiftDisplayColor("#123456", true)).toBe("#E1E6EA");
    expect(shiftDisplayColor("#abcdef", true)).toBe("#D4E6F7");
    expect(shiftDisplayColor("#8050A0", true)).toBe("#E7DEED");
    expect(shiftDisplayColor("#FF0000", true)).toBe("#FFCCCC");
    expect(shiftDisplayColor("#00FF00", true)).toBe("#CCFFCC");
    expect(shiftDisplayColor("#0000FF", true)).toBe("#CCCCFF");
    for (const { main, soft } of SHIFT_PRESET_COLOR_PAIRS) {
      expect(shiftDisplayColor(main, true)).toBe(soft);
      expect(shiftDisplayColor(soft, true)).toBe(soft);
    }
    for (const color of ["#123456", "#abcdef", "#B27A66", "#000000", "#FFFFFF"]) {
      expect(shiftDisplayColor(color, false)).toBe(color);
    }
    expect(shiftDisplayColor("#000000", true)).toBe("#E6E6E6");
    expect(shiftDisplayColor("#FFFFFF", true)).toBe("#FFFFFF");
    expect(shiftDisplayColor("#F7F7F7", true)).toBe("#F7F7F7");
    expect(shiftDisplayColor("#123", true)).toBe(shiftDisplayColor("#112233", true));
    expect(shiftDisplayColor("#fff", true)).toBe("#fff");
    for (const invalid of ["transparent", "", "#12", "#GGGGGG", "rgb(1,2,3)"]) {
      expect(shiftDisplayColor(invalid, true)).toBe(invalid);
    }
    expect(shiftDisplayColor("#59CA50", true)).toBe("#DDF4D9");
    expect(shiftDisplayColor("#E74C55", true)).toBe("#F8D8DA");
    expect(shiftDisplayColor("#E74C55", false)).toBe("#E74C55");
  });
});

describe("accessible service chips", () => {
  it("keeps the label color consistently white", () => {
    expect(chipTextColor).toBe("#FFFFFF");
  });

  it("keeps dark colors and tones down bright colors only for display", () => {
    expect(accessibleChipBackgroundColor("#7E57C2")).toBe("#7E57C2");
    expect(accessibleChipBackgroundColor("#F2A93B")).not.toBe("#F2A93B");
    expect(accessibleChipBackgroundColor("transparent")).toBe("transparent");
  });

  it.each([false, true])("builds readable two-line calendar chips in dark=%s", (dark) => {
    for (const color of ["#62B94C", "#F05C59", "#31A7C3", "#D95F9A"]) {
      const chip = calendarChipPalette(color, dark);
      expect(chip.main).toBe(color);
      expect(colorContrastRatio(chip.onMain, chip.main)).toBeGreaterThanOrEqual(
        MINIMUM_TEXT_CONTRAST,
      );
      expect(colorContrastRatio(chip.onDetail, chip.detail)).toBeGreaterThanOrEqual(
        MINIMUM_TEXT_CONTRAST,
      );
    }
  });

  it("keeps the clear source color and a pale matching detail band", () => {
    const chip = calendarChipPalette("#62B94C", false);

    expect(chip.main).toBe("#62B94C");
    expect(chip.onMain).toBe("#171719");
    expect(chip.detail).toBe("#D3EBCD");
    expect(chip.onDetail).toBe("#171719");
  });

  it("uses a dark matching detail band with light time text in dark mode", () => {
    expect(calendarChipPalette("#62B94C", true).onDetail).toBe("#FFFFFF");

    for (const color of ["#62B94C", "#F05C59", "#31A7C3", "#D95F9A"]) {
      const chip = calendarChipPalette(color, true);
      const mainLuminance = relativeLuminance(chip.main);
      const detailLuminance = relativeLuminance(chip.detail);

      expect(mainLuminance).not.toBeNull();
      expect(detailLuminance).not.toBeNull();
      expect(
        detailLuminance!,
        `${chip.detail} should be visibly darker than ${chip.main}`,
      ).toBeLessThan(mainLuminance!);
      expect(colorContrastRatio(chip.onDetail, chip.detail)).toBeGreaterThanOrEqual(
        MINIMUM_TEXT_CONTRAST,
      );
    }
  });
});

const TEXT_COLORS = [
  "text",
  "textSecondary",
  "textMuted",
  "primary",
  "info",
  "success",
  "warning",
  "danger",
] as const satisfies readonly (keyof Palette)[];

const CONTENT_BACKGROUNDS = [
  "background",
  "groupedBackground",
  "surface",
  "surfaceRaised",
  "surfaceMuted",
  "primarySoft",
] as const satisfies readonly (keyof Palette)[];

describe("shared action colors", () => {
  it("uses the approved blue and red fills with white labels in both modes", () => {
    for (const palette of [LIGHT_PALETTE, DARK_PALETTE]) {
      expect(palette.primaryAction).toBe("#2F6FED");
      expect(palette.dangerAction).toBe("#B91C1C");
      expect(palette.onPrimaryAction).toBe("#FFFFFF");
      expect(palette.onDanger).toBe("#FFFFFF");
    }
  });
});

describe.each([
  ["light", LIGHT_PALETTE],
  ["dark", DARK_PALETTE],
] as const)("%s palette contrast", (_, palette) => {
  it("keeps selection text readable and raises the active surface in both modes", () => {
    for (const background of [palette.selectionTrack, palette.selectionActiveSurface]) {
      for (const text of [palette.text, palette.textSecondary]) {
        expect(colorContrastRatio(text, background)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
      }
    }
    expect(relativeLuminance(palette.selectionActiveSurface)).toBeGreaterThan(
      relativeLuminance(palette.selectionTrack)!,
    );
  });
  it("uses readable mode-specific accents and calendar controls", () => {
    expect(palette.accent).toBe(palette.primary);
    expect(colorContrastRatio(palette.positiveBalance, palette.surface)).toBeGreaterThanOrEqual(
      MINIMUM_TEXT_CONTRAST,
    );
    expect(
      colorContrastRatio(palette.calendarYearAccent, palette.calendarBackground),
    ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
    expect(palette.onAccent).toBe(palette.onPrimary);
    expect(colorContrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(
      MINIMUM_TEXT_CONTRAST,
    );
    expect(colorContrastRatio(palette.primary, palette.tabBar)).toBeGreaterThanOrEqual(
      MINIMUM_UI_CONTRAST,
    );
    expect(palette.calendarToday).toBe(palette.accent);
    expect(palette.floatingAction).toBe(palette.accent);
    expect(palette.onFloatingAction).toBe(palette.onCalendarToday);
    expect(
      colorContrastRatio(palette.onCalendarToday, palette.calendarToday),
    ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
    expect(
      colorContrastRatio(palette.onFloatingAction, palette.floatingAction),
    ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
    expect(palette.cardSeparator).toBe(palette.separator);
    expect(palette.onboardingBackground).toBe(palette.background);
  });

  it.each(TEXT_COLORS)("keeps %s readable on content surfaces", (foreground) => {
    for (const background of CONTENT_BACKGROUNDS) {
      expect(
        colorContrastRatio(palette[foreground] as string, palette[background] as string),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
    }
  });

  it("keeps primary actions readable", () => {
    expect(
      colorContrastRatio(palette.onPrimaryAction, palette.primaryAction),
    ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
  });

  it("keeps destructive actions readable", () => {
    expect(colorContrastRatio(palette.onDanger, palette.dangerAction)).toBeGreaterThanOrEqual(
      MINIMUM_TEXT_CONTRAST,
    );
  });

  it.each(CONTENT_BACKGROUNDS)("keeps decorative borders understated on %s", (background) => {
    expect(
      colorContrastRatio(palette.border, palette[background] as string),
      `border on ${background}`,
    ).toBeLessThan(MINIMUM_UI_CONTRAST);
  });

  it("separates the canvas, cards and raised controls with quiet tones", () => {
    const surfaces = [palette.background, palette.surface, palette.surfaceRaised];
    expect(new Set(surfaces).size).toBe(3);
    for (const surface of surfaces.slice(1)) {
      const contrast = colorContrastRatio(surface, palette.background);
      expect(contrast).toBeGreaterThan(1);
      expect(contrast).toBeLessThan(1.5);
    }
  });
});

describe.each([false, true])("shared service text in dark mode %s", (dark) => {
  it("tints every preset without reducing small-text contrast", () => {
    for (const color of [
      "#FF526D",
      "#43D86E",
      "#FFBC41",
      "#6B67BE",
      "#00A0C0",
      "#888888",
      "#FFFFFF",
      "#000000",
    ]) {
      const chip = sharedCalendarChipPalette(color, dark);
      expect(chip.main).toBe(color);
      expect(chip.detail).toBe(calendarChipPalette(color, dark).detail);
      expect(colorContrastRatio(chip.onDetail, chip.detail)).toBeGreaterThanOrEqual(4.5);
    }
    expect(sharedCalendarChipPalette("#FF526D", dark).onDetail).not.toBe(
      sharedCalendarChipPalette("#43D86E", dark).onDetail,
    );
  });
});
