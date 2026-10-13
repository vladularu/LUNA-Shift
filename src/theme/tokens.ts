export const SPACING = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const RADII = {
  small: 3,
  control: 12,
  card: 16,
  sheet: 24,
  large: 24,
  pill: 999,
} as const;

export const CORNER_CURVE = "continuous" as const;

export const CONTROL_CORNERS = {
  borderRadius: RADII.control,
  borderCurve: CORNER_CURVE,
} as const;

export const MINIMUM_TOUCH_TARGET = 44;

export const SELECTION_METRICS = {
  trackRadius: RADII.pill,
  stackedTrackRadius: RADII.sheet,
  optionRadius: RADII.pill,
  trackInset: SPACING.xxs,
  optionHeight: MINIMUM_TOUCH_TARGET,
  iconSize: 18,
  stackFontScale: 1.2,
  narrowWidth: 360,
  maxInlineOptions: 3,
  inlineLabelLimit: 24,
  pressedOpacity: 0.72,
  disabledOpacity: 0.5,
} as const;

export const SHADCN_METRICS = {
  tabItemHeight: 32,
  tabPadding: 5,
  switchWidth: 44,
  switchHeight: 24,
  switchThumbSize: 20,
  switchInset: 2,
} as const;

export const CONTROL_HEIGHT = {
  compact: MINIMUM_TOUCH_TARGET,
  regular: 40,
  large: 40,
} as const;

export const SCREEN_LAYOUT = {
  horizontalPadding: SPACING.xl,
  contentTopPadding: SPACING.md,
  contentBottomPadding: 48,
  contentGap: SPACING.xxl,
  sectionGap: SPACING.xl,
  headerMinHeight: 84,
  headerTopPadding: SPACING.sm,
  headerBottomPadding: SPACING.lg,
  headerAccessoryStackFontScale: 1.6,
} as const;

export const REPORT_CARD_GAP = 24;

export const CARD_HEADER_INSET = 0;

export const SHADOWS = {
  card: "0 0 0 rgba(0, 0, 0, 0)",
  raised: "0 4px 6px rgba(0, 0, 0, 0.09)",
  overlay: "0 4px 6px rgba(0, 0, 0, 0.09)",
} as const;

export const CALENDAR_METRICS = {
  chipRadius: 2,
  chipGap: 1,
  chipHorizontalInset: 1,
  chipTextColor: "#FFFFFF",
  horizontalInset: 0,
  weekdayHeight: 30,
  weekdayFontSize: 12,
  weekNumberFontSize: 9,
  weekNumberInset: 1,
  dayNumberHeight: 38,
  dayNumberFontSize: 17,
  weekRowHeight: 118,
  entryRowHeight: 17,
  entryFontSize: 12,
  entryLineHeight: 15,
  cardRadius: RADII.card,
  floatingActionSize: 40,
} as const;

export const CALENDAR_MINI_METRICS = {
  rowHeight: 21,
  daySize: 18,
  fontSize: 10,
} as const;

// Muted colors for names of separate, read-only calendar layers.
export const SHARED_CALENDAR_COLORS = [
  { color: "#527D92", name: "Blau" },
  { color: "#4D8C64", name: "Grün" },
  { color: "#A27447", name: "Braun" },
  { color: "#7666A4", name: "Violett" },
] as const;

/** QR contrast must remain black on white in every appearance mode. */
export const QR_COLORS = { ink: "#000000", paper: "#FFFFFF" } as const;
