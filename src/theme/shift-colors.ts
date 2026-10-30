import type { ShiftType } from "@/domain/types";

export const SHIFT_COLOR_PAIRS = [
  { main: "#59CA50", soft: "#DDF4D9" },
  { main: "#E74C55", soft: "#F8D8DA" },
  { main: "#FFA338", soft: "#FFE7C4" },
  { main: "#25A3B9", soft: "#D4EFF3" },
  { main: "#347ED1", soft: "#D9E8FA" },
  { main: "#D95F9A", soft: "#F7DDEC" },
  { main: "#F09A3E", soft: "#FBE8D3" },
  { main: "#929292", soft: "#E7E7E7" },
  { main: "#9B59D0", soft: "#EBDCF4" },
  { main: "#4267D5", soft: "#DDE4F7" },
  { main: "#2AA0B8", soft: "#D8EFF3" },
  { main: "#8BCB33", soft: "#EBF5D9" },
  { main: "#F2C230", soft: "#FAF1CE" },
  { main: "#E36B37", soft: "#F8E0D6" },
  { main: "#B27A66", soft: "#EDE1DC" },
] as const;

export const SHIFT_COLORS = SHIFT_COLOR_PAIRS.map((pair) => pair.main);
export const SHIFT_PRESET_COLOR_PAIRS = SHIFT_COLOR_PAIRS.slice(0, 14);

const PASTEL_SHIFT_COLORS = new Map<string, string>(
  [
    ...SHIFT_PRESET_COLOR_PAIRS,
    // Presets offered before the calendar palette refresh; existing entries retain these values.
    { main: "#4FCB68", soft: "#DDF4E2" },
    { main: "#F05C68", soft: "#F9DDE0" },
    { main: "#F2A93B", soft: "#FCEBCC" },
    { main: "#31A7C3", soft: "#D8F0F5" },
    { main: "#2F80ED", soft: "#DCEAFE" },
    { main: "#858A8E", soft: "#E5E7E8" },
  ].map(({ main, soft }) => [main, soft]),
);

const KNOWN_PASTEL_COLORS = new Set(PASTEL_SHIFT_COLORS.values());

/** Display only: retain accepted preset pairs and lighten individual colors without changing hue. */
export function shiftDisplayColor(color: string, pastelColors = false): string {
  if (!pastelColors) return color;
  let hex = color.trim().replace(/^#/, "");
  if (!color.trim().startsWith("#")) return color;
  if (/^[0-9a-f]{3}$/i.test(hex))
    hex = hex
      .split("")
      .map((channel) => channel + channel)
      .join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
  const normalized = `#${hex.toUpperCase()}`;
  const preset = PASTEL_SHIFT_COLORS.get(normalized);
  if (preset) return preset;
  if (KNOWN_PASTEL_COLORS.has(normalized)) return color;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const channelSum = Math.min(...channels) + Math.max(...channels);
  const minimumLightnessSum = 2 * 255 * 0.9;
  if (channelSum >= minimumLightnessSum) return color;
  // Multiply integer channel values before division so repeated renders cannot drift by a byte.
  const whiteNumerator = minimumLightnessSum - channelSum;
  const whiteDenominator = 2 * 255 - channelSum;
  return `#${channels
    .map((channel) =>
      Math.round(channel + ((255 - channel) * whiteNumerator) / whiteDenominator)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

export const APPOINTMENT_COLOR = "#2F80ED";
export const HOLIDAY_COLOR = "#8B5BD1";
export const DEFAULT_TEMPLATE_COLOR = "#D95F9A";

export const SHIFT_TYPE_COLORS: Readonly<Record<ShiftType, string>> = {
  EARLY: "#59CA50",
  LATE: "#E74C55",
  NIGHT: "#FFA338",
  DAY: "#25A3B9",
  TRAINING: "#347ED1",
  VACATION: "#929292",
  SICK: "#F09A3E",
  FREE: "#929292",
  CUSTOM: "#D95F9A",
};
