import { StyleSheet } from "react-native";

import { INTER_FONTS } from "@/theme/shadcn";
import { RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";

export const TEXT_EDITOR_STYLES = StyleSheet.create({
  sheet: { flex: 1, overflow: "hidden" },
  field: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: RADII.card,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingLeft: 22,
    paddingRight: 10,
  },
  input: {
    minHeight: 58,
    flex: 1,
    fontFamily: INTER_FONTS.regular,
    fontSize: TYPOGRAPHY.sectionTitle.fontSize,
    lineHeight: TYPOGRAPHY.button.lineHeight,
    paddingVertical: 0,
  },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
