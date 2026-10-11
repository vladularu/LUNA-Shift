import type { TextStyle } from "react-native";

// Exact values read from a2xfLIanDJARWqLyPI4X1r, Colors and Typography.
export const SHADCN_COLORS = {
  white: "#FFFFFF",
  slate50: "#F8FAFC",
  slate100: "#F1F5F9",
  slate200: "#E2E8F0",
  slate300: "#CBD5E1",
  slate400: "#94A3B8",
  slate500: "#64748B",
  slate600: "#475569",
  slate700: "#334155",
  slate800: "#1E293B",
  slate900: "#0F172A",
  destructive: "#EF4444",
  destructivePressed: "#DC2626",
  overlay: "rgba(15, 23, 42, 0.5)",
  overlaySubtle: "rgba(15, 23, 42, 0.08)",
  shadow: "rgba(0, 0, 0, 0.09)",
} as const;

export const INTER_FONTS = {
  regular: "Inter-Regular",
  medium: "Inter-Medium",
  semibold: "Inter-SemiBold",
  bold: "Inter-Bold",
  extraBold: "Inter-ExtraBold",
  italic: "Inter-Italic",
} as const;

export function interFontFamily(weight: TextStyle["fontWeight"], italic = false): string {
  if (italic) return INTER_FONTS.italic;
  const numeric = weight === "bold" ? 700 : Number(weight ?? 400);
  if (numeric >= 800) return INTER_FONTS.extraBold;
  if (numeric >= 700) return INTER_FONTS.bold;
  if (numeric >= 600) return INTER_FONTS.semibold;
  if (numeric >= 500) return INTER_FONTS.medium;
  return INTER_FONTS.regular;
}

export const SHADCN_TYPOGRAPHY = {
  h1: { fontSize: 48, lineHeight: 48, fontWeight: "800", letterSpacing: -1.2 },
  h2: { fontSize: 30, lineHeight: 36, fontWeight: "600", letterSpacing: -0.75 },
  h3: { fontSize: 24, lineHeight: 32, fontWeight: "600", letterSpacing: -0.6 },
  h4: { fontSize: 20, lineHeight: 28, fontWeight: "600", letterSpacing: -0.5 },
  p: { fontSize: 16, lineHeight: 28, fontWeight: "400" },
  input: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  bodyMedium: { fontSize: 14, lineHeight: 24, fontWeight: "500" },
  subtle: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
  subtleMedium: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  subtleSemibold: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  large: { fontSize: 18, lineHeight: 28, fontWeight: "600" },
  small: { fontSize: 14, lineHeight: 14, fontWeight: "500" },
  detail: { fontSize: 12, lineHeight: 20, fontWeight: "500" },
  lead: { fontSize: 20, lineHeight: 28, fontWeight: "400" },
} as const satisfies Readonly<Record<string, TextStyle>>;
