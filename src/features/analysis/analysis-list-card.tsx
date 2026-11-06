import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
import { CARD_METRICS, cardHeaderFrame } from "@/theme/card-layout";
import { cardTextStyle } from "@/theme/card-typography";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardFooterLine, SurfaceCard } from "@/ui/design-system";
import { selectionFeedback } from "@/ui/haptics";

export function AnalysisCardHeader({
  title,
  label,
  onPress,
  accessory,
  value,
}: {
  readonly title: string;
  readonly label?: string;
  readonly onPress?: () => void;
  readonly accessory?: ReactNode;
  readonly value?: string;
}) {
  const p = usePalette();
  const secondaryText = p.textMuted;
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3 || width < 360;
  const heading = (
    <>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{
          flex: 1,
          textAlign: "left",
          ...TYPOGRAPHY.sectionTitle,
          ...cardTextStyle(p, "title"),
        }}
      >
        {title}
      </Text>
      {value ? (
        <Text
          style={{
            ...TYPOGRAPHY.bodyStrong,
            color: p.text,
            fontVariant: ["tabular-nums"],
            flexShrink: 1,
          }}
        >
          {value}
        </Text>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={22} color={secondaryText} /> : null}
    </>
  );
  const headerStyle = {
    ...cardHeaderFrame(p.dark, SPACING.lg),
    minHeight: p.dark ? 56 : 50,
    paddingVertical: accessory ? SPACING.xxs : p.dark ? SPACING.sm : SPACING.xs,
    gap: SPACING.sm,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderBottomWidth: 0,
    borderBottomColor: p.cardSeparator,
    backgroundColor: "transparent",
  };
  const headingContent = onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title + ": Details öffnen"}
      onPress={() => {
        selectionFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        flex: accessory && !stacked ? 1 : undefined,
        minHeight: accessory ? 44 : undefined,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACING.sm,
        opacity: pressed ? 0.65 : 1,
        ...(!accessory ? headerStyle : {}),
      })}
    >
      {heading}
    </Pressable>
  ) : (
    <View
      style={
        accessory
          ? { flex: stacked ? undefined : 1, flexDirection: "row", alignItems: "center" }
          : headerStyle
      }
    >
      {heading}
    </View>
  );
  return accessory ? (
    <View
      testID="analysis-card-header-with-accessory"
      style={{
        ...headerStyle,
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "center",
      }}
    >
      {headingContent}
      <View style={{ alignSelf: "flex-end", flexShrink: 1 }}>{accessory}</View>
    </View>
  ) : (
    headingContent
  );
}

export function AnalysisListCard({
  title,
  label,
  onPress,
  children,
  caption,
  headerAccessory,
  busy = false,
  bodyMinHeight,
  headerValue,
}: PropsWithChildren<{
  readonly title: string;
  readonly label?: string;
  readonly onPress?: () => void;
  readonly caption?: string;
  readonly headerAccessory?: ReactNode;
  readonly busy?: boolean;
  readonly bodyMinHeight?: number;
  readonly headerValue?: string;
}>) {
  return (
    <SurfaceCard>
      <AnalysisCardHeader
        title={title}
        label={label}
        onPress={onPress}
        accessory={headerAccessory}
        value={headerValue}
      />
      <View
        testID={`analysis-card-body-${title}`}
        accessibilityState={{ busy }}
        style={{
          paddingHorizontal: CARD_METRICS.contentInset,
          paddingTop: CARD_METRICS.contentTopPadding,
          minHeight: bodyMinHeight,
        }}
      >
        {children}
      </View>
      <CardFooterLine caption={caption} />
    </SurfaceCard>
  );
}
export function AnalysisValueRow({
  label,
  value,
  total = false,
  onPress,
  icon,
  iconColor,
  leading,
  dot,
  reserveDisclosure = false,
  minimumHeight = CARD_METRICS.rowMinHeight,
}: {
  readonly label: string;
  readonly value: string;
  readonly total?: boolean;
  readonly first?: boolean;
  readonly onPress?: () => void;
  readonly icon?: ComponentProps<typeof Ionicons>["name"];
  readonly iconColor?: string;
  readonly leading?: ReactNode;
  readonly dot?: string;
  readonly reserveDisclosure?: boolean;
  readonly minimumHeight?: number;
}) {
  const p = usePalette();
  const secondaryText = p.textMuted;
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3 || width < 360;
  const style = {
    minHeight: minimumHeight,
    paddingVertical: CARD_METRICS.rowPaddingVertical,
    gap: SPACING.sm,
    borderTopWidth: 0,
    borderTopColor: p.cardSeparator,
    flexDirection: stacked ? ("column" as const) : ("row" as const),
    alignItems: stacked ? ("stretch" as const) : ("center" as const),
  };
  const content = (
    <>
      <View
        style={{
          flex: stacked ? undefined : 1,
          minWidth: 0,
          flexDirection: "row",
          gap: SPACING.sm,
          alignItems: "center",
        }}
      >
        {leading}
        {icon ? <Ionicons name={icon} color={iconColor ?? secondaryText} size={18} /> : null}
        {dot ? (
          <View style={{ width: 8, height: 8, borderRadius: RADII.pill, backgroundColor: dot }} />
        ) : null}
        <Text
          style={{
            flex: 1,
            ...TYPOGRAPHY.body,
            ...cardTextStyle(p, "label"),
          }}
        >
          {label}
        </Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.xs,
          maxWidth: stacked ? "100%" : "58%",
          alignSelf: stacked ? "flex-end" : undefined,
        }}
      >
        <Text
          style={{
            flexShrink: 1,
            textAlign: "right",
            ...(total ? TYPOGRAPHY.bodyStrong : TYPOGRAPHY.body),
            ...cardTextStyle(p, total ? "total" : "value"),
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
        {onPress || reserveDisclosure ? (
          <View
            testID="analysis-disclosure-gutter"
            style={{ width: 16 }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {onPress ? <Ionicons name="chevron-forward" size={16} color={secondaryText} /> : null}
          </View>
        ) : null}
      </View>
    </>
  );
  const accessibilityLabel = label + ": " + value;
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        selectionFeedback();
        onPress();
      }}
      style={({ pressed }) => ({ ...style, opacity: pressed ? 0.65 : 1 })}
    >
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={accessibilityLabel} style={style}>
      {content}
    </View>
  );
}
