import type { Palette } from "./palette-values";
import { CALENDAR_IMAGE_OVERLAY_OPACITY } from "./theme-catalog";

export const CALENDAR_IMAGE_STRENGTH_OPTIONS = [
  { value: "subtle", label: "Dezent", overlayOpacity: CALENDAR_IMAGE_OVERLAY_OPACITY },
  { value: "medium", label: "Mittel", overlayOpacity: 0.75 },
  { value: "strong", label: "Kräftig", overlayOpacity: 0.6 },
] as const;
export type CalendarImageStrength =
  (typeof CALENDAR_IMAGE_STRENGTH_OPTIONS)[number]["value"] | number;
export const DEFAULT_CALENDAR_IMAGE_STRENGTH: CalendarImageStrength = "medium";
export const MAX_CALENDAR_IMAGE_OPACITY = 100;

export function parseCalendarImageStrength(value: unknown): CalendarImageStrength {
  if (typeof value === "string" && /^\d{1,3}$/.test(value)) value = Number(value);
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100)
    return value;
  return (
    CALENDAR_IMAGE_STRENGTH_OPTIONS.find((option) => option.value === value)?.value ??
    DEFAULT_CALENDAR_IMAGE_STRENGTH
  );
}
export function calendarImageOverlayOpacity(strength: CalendarImageStrength): number {
  if (typeof strength === "number" && parseCalendarImageStrength(strength) === strength)
    return 1 - strength / 100;
  return (
    CALENDAR_IMAGE_STRENGTH_OPTIONS.find((option) => option.value === strength)?.overlayOpacity ??
    0.75
  );
}
export function calendarImageOpacityPercentage(strength: CalendarImageStrength): number {
  return Math.round((1 - calendarImageOverlayOpacity(strength)) * 100);
}
export function calendarImageLabelColor(palette: Palette, strength: CalendarImageStrength): string {
  return calendarImageOpacityPercentage(strength) <= 10 ? palette.textSecondary : palette.text;
}
