import { Text } from "@/ui/text";
import { View, useWindowDimensions } from "react-native";
import { usePalette } from "@/theme/palette";
import { cardTextStyle } from "@/theme/card-typography";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { SPACING } from "@/theme/tokens";
import { CARD_METRICS } from "@/theme/card-layout";
import { CardFooterLine, SurfaceCard } from "@/ui/design-system";
import { AnalysisCardHeader, AnalysisValueRow } from "./analysis-list-card";

export function WorktimeCard({
  target,
  actual,
  balance,
  balanceAccent,
  onPress,
  caption,
  actualLabel = "Ist",
  action,
}: {
  readonly target: string;
  readonly actual: string;
  readonly balance: string;
  readonly balanceAccent: string;
  readonly onPress?: () => void;
  readonly caption?: string;
  readonly actualLabel?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3;
  const withUnit = (value: string) => (/[0-9]/u.test(value) ? value + " h" : value);
  const values = [
    { label: "Soll", value: target, accent: palette.text },
    { label: actualLabel, value: actual, accent: palette.text },
    { label: "Saldo", value: balance, accent: balanceAccent },
  ];
  return (
    <SurfaceCard>
      <AnalysisCardHeader
        title="Arbeitszeit"
        label={`Stunden, ${actualLabel} ${withUnit(actual)}, Soll ${withUnit(target)}, Saldo ${withUnit(balance)}`}
        onPress={onPress}
      />
      <View
        testID="worktime-values"
        style={{
          flexDirection: stacked ? "column" : "row",
          paddingTop: CARD_METRICS.contentTopPadding,
          paddingBottom: CARD_METRICS.rowPaddingVertical,
        }}
      >
        {values.map((item, index) => (
          <View
            key={item.label}
            accessibilityLabel={`${item.label === "Saldo" ? "Stundensaldo" : item.label}: ${withUnit(item.value)}`}
            accessible
            style={{
              minWidth: 0,
              flex: stacked ? undefined : 1,
              gap: SPACING.xs,
              borderLeftWidth: !stacked && index > 0 ? 1 : 0,
              borderLeftColor: palette.cardSeparator,
              borderTopWidth: stacked && index > 0 ? 1 : 0,
              borderTopColor: palette.cardSeparator,
              paddingHorizontal: SPACING.md,
              paddingVertical: stacked ? SPACING.sm : 0,
            }}
          >
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              selectable
              style={{ ...TYPOGRAPHY.caption, ...cardTextStyle(palette, "label") }}
            >
              {item.label}
            </Text>
            <Text
              selectable
              style={{
                color: item.accent,
                ...TYPOGRAPHY.metricValue,
                fontVariant: ["tabular-nums"],
              }}
            >
              {item.value}
            </Text>
          </View>
        ))}
      </View>
      {action ? (
        <AnalysisValueRow first label={action.label} value="" onPress={action.onPress} />
      ) : null}
      <CardFooterLine caption={caption} />
    </SurfaceCard>
  );
}
