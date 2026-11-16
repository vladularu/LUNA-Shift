import { CARD_HEADER_INSET, CORNER_CURVE, MINIMUM_TOUCH_TARGET, RADII, SPACING } from "./tokens";

export const CARD_METRICS = {
  contentInset: SPACING.lg,
  contentTopPadding: SPACING.lg,
  rowMinHeight: 48,
  rowPaddingVertical: 10,
  iconSize: 20,
  infoMinHeight: MINIMUM_TOUCH_TARGET,
  infoPaddingVertical: SPACING.md,
} as const;

export function cardHeaderFrame(dark: boolean, horizontalPadding: number) {
  const inset = dark ? 0 : CARD_HEADER_INSET;
  return {
    borderCurve: CORNER_CURVE,
    paddingHorizontal: horizontalPadding - inset,
    marginHorizontal: inset,
    marginTop: inset,
    borderTopLeftRadius: dark ? 0 : RADII.card - inset,
    borderTopRightRadius: dark ? 0 : RADII.card - inset,
  };
}
