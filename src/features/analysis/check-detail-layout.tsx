import type { ReactNode } from "react";
import { View } from "react-native";
import { usePalette } from "@/theme/palette";
import { REPORT_CARD_GAP, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { Text } from "@/ui/text";

export function CheckDetailStack({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
  readonly embedded?: boolean;
}) {
  return (
    <View
      testID={testID}
      style={{
        // ReportScrollView owns the same insets as the Schichtzulage screen.
        gap: REPORT_CARD_GAP,
      }}
    >
      {children}
    </View>
  );
}

export function CheckDetailCard({
  children,
  title,
  testID,
  accent,
}: {
  readonly children: ReactNode;
  readonly title?: string;
  readonly testID?: string;
  readonly accent?: string;
}) {
  const palette = usePalette();
  return (
    <SurfaceCard
      testID={testID}
      style={{ padding: SPACING.xl, gap: SPACING.md, ...(accent ? { borderColor: accent } : {}) }}
    >
      {title ? (
        <Text accessibilityRole="header" style={{ ...TYPOGRAPHY.bodyStrong, color: palette.text }}>
          {title}
        </Text>
      ) : null}
      {children}
    </SurfaceCard>
  );
}
