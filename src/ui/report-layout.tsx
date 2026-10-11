import { Text } from "@/ui/text";
import type { PropsWithChildren } from "react";
import { View } from "react-native";

import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { RADII, REPORT_CARD_GAP, SPACING } from "@/theme/tokens";
import { ScreenScrollView } from "@/ui/screen-layout";

export function ReportScrollView({
  children,
  bottomPadding,
}: PropsWithChildren<{ readonly bottomPadding?: number }>) {
  return (
    <ScreenScrollView surface="groupedBackground" bottomPadding={bottomPadding}>
      {children}
    </ScreenScrollView>
  );
}

export function ReportTestBadge() {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel="Testdaten"
      style={{
        alignSelf: "center",
        borderRadius: RADII.pill,
        backgroundColor: palette.primarySoft,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 5,
      }}
    >
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.primary, ...TYPOGRAPHY.overline }}
      >
        TESTDATEN
      </Text>
    </View>
  );
}

export function ReportPeriodContent({ children }: PropsWithChildren) {
  return <View style={{ gap: REPORT_CARD_GAP }}>{children}</View>;
}
