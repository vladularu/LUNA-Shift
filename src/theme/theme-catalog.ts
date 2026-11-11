import type { ThemeId } from "@/domain/appearance";
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from "./palette-values";
export const CALENDAR_IMAGE_OVERLAY_OPACITY = 0.9;

export const THEME_OPTIONS = [
  { id: "standard", name: "LUNA Standard", description: "Vertraut und zurückhaltend" },
] as const;

// Legacy identifiers remain readable in backups; all now use LUNA Standard.
export function resolvePalette(_themeId: ThemeId, dark: boolean): Palette {
  return dark ? DARK_PALETTE : LIGHT_PALETTE;
}
