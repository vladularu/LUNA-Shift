import type { Palette } from "@/theme/palette-values";

export const PLANNING_TITLE = "Dienstfolgen & Erholung";
export const PLANNING_SUBTITLE = "Hinweise zu Nachtserien, Dienstwechseln und Erholungszeiten.";
export const PLANNING_KIND_LABEL = "Arbeitswissenschaftliche Hinweise";
export const LEGAL_KIND_LABEL = "Gesetzliche Prüfung";

export function planningAppearance(palette: Palette) {
  return {
    cardStyle: {
      borderColor: palette.planningBorder,
      borderWidth: 1,
    },
    labelColor: palette.textMuted,
  };
}
