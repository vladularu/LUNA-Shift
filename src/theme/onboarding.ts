import { type TextStyle } from "react-native";
import { usePalette } from "./palette";
import { TYPOGRAPHY } from "./typography";
import { DARK_PALETTE, LIGHT_PALETTE } from "./palette-values";

export function useOnboardingPalette() {
  const palette = usePalette();
  const { dark } = palette;
  return {
    dark,
    canvas: palette.onboardingBackground,
    surface: palette.surface,
    text: palette.text,
    muted: palette.textMuted,
    accent: palette.accent,
    onAccent: palette.onAccent,
    accentText: palette.primary,
    selectionBorder: dark ? palette.border : palette.primary,
    error: palette.danger,
    border: palette.separator,
    control: palette.border,
    overlay: palette.overlay,
    rose: palette.surfaceMuted,
    apricot: palette.surfaceMuted,
    lavender: palette.surfaceMuted,
    highlight: DARK_PALETTE.salaryAccent,
    highlightSoft: palette.salaryAccentSoft,
    onHighlight: LIGHT_PALETTE.text,
  };
}
export const ONBOARDING_TYPOGRAPHY = {
  brandName: { fontSize: 29, lineHeight: 36, letterSpacing: -1.3, fontWeight: "400" },
  slogan: { fontSize: 16, lineHeight: 24, letterSpacing: -0.3 },
  question: { fontSize: 29, lineHeight: 35, letterSpacing: -0.9, fontWeight: "600" },
  percentage: {
    fontSize: 64,
    lineHeight: 76,
    fontWeight: "600",
    letterSpacing: -3,
    fontVariant: ["tabular-nums"],
  },
  hours: { fontSize: 22, lineHeight: 30 },
  hoursUnit: { fontSize: 13, lineHeight: 20 },
  optionLabel: { ...TYPOGRAPHY.small, fontWeight: "500" },
  salaryLabel: { ...TYPOGRAPHY.compact, fontWeight: "600" },
  smallCaption: { ...TYPOGRAPHY.caption, lineHeight: 18 },
  tariffWordmark: { fontSize: 23, lineHeight: 30, fontWeight: "600", letterSpacing: -1 },
  tariffLabel: { ...TYPOGRAPHY.small, fontWeight: "600" },
  tariffCaption: { ...TYPOGRAPHY.overline, fontSize: 10, fontWeight: "400" },
  checkmark: TYPOGRAPHY.highlightCount,
  body: TYPOGRAPHY.bodyLarge,
  label: {
    fontSize: TYPOGRAPHY.compact.fontSize,
    lineHeight: TYPOGRAPHY.small.lineHeight,
    fontWeight: "500",
  },
  caption: { ...TYPOGRAPHY.highlightSummary, fontWeight: "400" },
  title: TYPOGRAPHY.dialogTitle,
  display: { fontSize: 34, lineHeight: 40, fontWeight: "600", letterSpacing: -1 },
  numericInput: { fontSize: 48, lineHeight: 56, fontWeight: "400", fontVariant: ["tabular-nums"] },
  button: { ...TYPOGRAPHY.highlightTitle, letterSpacing: 0 },
} as const satisfies Readonly<Record<string, TextStyle>>;
