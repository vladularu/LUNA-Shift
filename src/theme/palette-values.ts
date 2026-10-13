import { SHADCN_COLORS } from "./shadcn";

export interface Palette {
  readonly dark: boolean;
  readonly background: string;
  readonly calendarBackground: string;
  readonly onboardingBackground: string;
  readonly groupedBackground: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly surfaceMuted: string;
  readonly selectionTrack: string;
  readonly selectionActiveSurface: string;
  readonly selectionActiveBorder: string;
  readonly cardHeader: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly border: string;
  readonly separator: string;
  readonly cardSeparator: string;
  /** Action fill; use primary for readable standalone text. */
  readonly accent: string;
  readonly onAccent: string;
  readonly primary: string;
  readonly primarySoft: string;
  readonly secondarySoft: string;
  readonly tertiarySoft: string;
  readonly salaryAccent: string;
  readonly salaryAccentSoft: string;
  readonly onPrimary: string;
  readonly sortAction: string;
  readonly onSortAction: string;
  readonly onDanger: string;
  readonly info: string;
  readonly success: string;
  readonly positiveBalance: string;
  readonly warning: string;
  readonly danger: string;
  readonly weekend: string;
  readonly outsideMonth: string;
  readonly tabBar: string;
  readonly calendarToday: string;
  readonly calendarYearAccent: string;
  readonly onCalendarToday: string;
  readonly calendarSelection: string;
  readonly onCalendarSelection: string;
  readonly floatingAction: string;
  readonly onFloatingAction: string;
  readonly overlay: string;
  readonly overlaySubtle: string;
  readonly shadow: string;
}

export const LUNA_LIGHT_BLUE = SHADCN_COLORS.slate900;
export const LUNA_LIGHT_BLUE_TEXT = SHADCN_COLORS.slate900;

export const LIGHT_PALETTE: Palette = {
  dark: false,
  calendarBackground: "#FAFAFA",
  background: "#F4F4F5",
  onboardingBackground: "#F4F4F5",
  groupedBackground: "#F4F4F5",
  surface: SHADCN_COLORS.white,
  surfaceRaised: "#FAFAFA",
  surfaceMuted: "#EDEDEF",
  selectionTrack: "#EDEDEF",
  selectionActiveSurface: "#FFFFFF",
  selectionActiveBorder: "#E4E4E7",
  cardHeader: "#FAFAFA",
  text: "#18181B",
  textSecondary: "#3F3F46",
  textMuted: "#5D5D66",
  border: "#D4D4D8",
  separator: "#E4E4E7",
  cardSeparator: "#E4E4E7",
  accent: "#18181B",
  onAccent: "#FAFAFA",
  primary: "#18181B",
  primarySoft: "#EDEDEF",
  secondarySoft: "#F4F4F5",
  tertiarySoft: "#F8F8FA",
  salaryAccent: "#C48A00",
  salaryAccentSoft: "#FFF8E8",
  onPrimary: "#FAFAFA",
  sortAction: "#18181B",
  onSortAction: "#FAFAFA",
  onDanger: SHADCN_COLORS.white,
  info: "#3F3F46",
  success: "#3F3F46",
  positiveBalance: "#15803D",
  warning: "#B91C1C",
  danger: "#B91C1C",
  weekend: "#EDEDEF",
  outsideMonth: "#F4F4F5",
  tabBar: SHADCN_COLORS.white,
  calendarToday: "#18181B",
  calendarYearAccent: "#B91C1C",
  onCalendarToday: "#FAFAFA",
  calendarSelection: "#EDEDEF",
  onCalendarSelection: "#18181B",
  floatingAction: "#18181B",
  onFloatingAction: "#FAFAFA",
  overlay: "rgba(9, 9, 11, 0.5)",
  overlaySubtle: "rgba(9, 9, 11, 0.06)",
  shadow: SHADCN_COLORS.shadow,
};

// Graphite tones follow the user's dark reference; containers stay subtly raised.
export const DARK_PALETTE: Palette = {
  dark: true,
  calendarBackground: "#09090B",
  background: "#09090B",
  onboardingBackground: "#09090B",
  groupedBackground: "#09090B",
  surface: "#141416",
  surfaceRaised: "#1C1C1F",
  surfaceMuted: "#27272A",
  selectionTrack: "#202023",
  selectionActiveSurface: "#303035",
  selectionActiveBorder: "#3F3F46",
  cardHeader: "#19191C",
  text: "#FAFAFA",
  textSecondary: "#D4D4D8",
  textMuted: "#A1A1AA",
  border: "#3F3F46",
  separator: "#27272A",
  cardSeparator: "#27272A",
  accent: "#FAFAFA",
  onAccent: "#18181B",
  primary: "#FAFAFA",
  primarySoft: "#27272A",
  secondarySoft: "#202023",
  tertiarySoft: "#19191C",
  salaryAccent: "#F1C767",
  salaryAccentSoft: "#292419",
  onPrimary: "#18181B",
  sortAction: "#FAFAFA",
  onSortAction: "#18181B",
  onDanger: "#18181B",
  info: "#D4D4D8",
  success: "#D4D4D8",
  positiveBalance: "#4ADE80",
  warning: "#FCA5A5",
  danger: "#FCA5A5",
  weekend: "#202023",
  outsideMonth: "#111113",
  tabBar: "#141416",
  calendarToday: "#FAFAFA",
  calendarYearAccent: "#EF4444",
  onCalendarToday: "#18181B",
  calendarSelection: "#303035",
  onCalendarSelection: "#FAFAFA",
  floatingAction: "#FAFAFA",
  onFloatingAction: "#18181B",
  overlay: "rgba(0, 0, 0, 0.62)",
  overlaySubtle: "rgba(250, 250, 250, 0.06)",
  shadow: "rgba(0, 0, 0, 0.35)",
};
