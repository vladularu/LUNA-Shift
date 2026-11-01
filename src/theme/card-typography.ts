import type { TextStyle } from "react-native";

import type { Palette } from "./palette-values";

type CardTextRole = "title" | "label" | "value" | "total" | "note" | "action";

const CARD_TEXT_WEIGHT = {
  title: "600",
  label: "400",
  value: "400",
  total: "500",
  note: "400",
  action: "400",
} as const;

// Color and emphasis are independent of text size, row height and card spacing.
export function cardTextStyle(
  palette: Pick<Palette, "text" | "textMuted">,
  role: CardTextRole,
): Pick<TextStyle, "color" | "fontWeight"> {
  return {
    color:
      role === "title" || role === "value" || role === "total" ? palette.text : palette.textMuted,
    fontWeight: CARD_TEXT_WEIGHT[role],
  };
}
