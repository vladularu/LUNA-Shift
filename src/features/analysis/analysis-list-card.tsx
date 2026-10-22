import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, CARD_HEADER_INSET, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardFooterLine, SurfaceCard } from "@/ui/design-system";
import { selectionFeedback } from "@/ui/haptics";

export function AnalysisCardHeader({
  title,
  label,
  onPress,
  accessory,
}: {
  readonly title: string;
  readonly label?: string;
  readonly onPress?: () => void;
  readonly accessory?: ReactNode;
}) {
  const p = usePalette();
  const secondaryText = p.dark ? p.text : p.textMuted;
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
          color: p.text,
          ...TYPOGRAPHY.sectionTitle,
          fontWeight: "500",
        }}
      >
        {title}
      </Text>
      {onPress ? (
        <Ionicons name="ellipsis-horizontal-circle" size={22} color={secondaryText} />
      ) : null}
    </>
  );
  const headerStyle = {
    borderCurve: CORNER_CURVE,
    minHeight: p.dark ? 56 : 50,
    paddingHorizontal: p.dark ? SPACING.lg : SPACING.lg - CARD_HEADER_INSET,
    paddingVertical: accessory ? SPACING.xxs : p.dark ? SPACING.sm : SPACING.xs,
    marginHorizontal: p.dark ? 0 : CARD_HEADER_INSET,
    marginTop: p.dark ? 0 : CARD_HEADER_INSET,
    borderTopLeftRadius: p.dark ? 0 : RADII.card - CARD_HEADER_INSET,
    borderTopRightRadius: p.dark ? 0 : RADII.card - CARD_HEADER_INSET,
    gap: SPACING.sm,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderBottomWidth: 1,
    borderBottomColor: p.cardSeparator,
    backgroundColor: p.cardHeader,
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
  captionBelowFooter = false,
  headerAccessory,
}: PropsWithChildren<{
  readonly title: string;
  readonly label?: string;
  readonly onPress?: () => void;
  readonly caption?: string;
  readonly captionBelowFooter?: boolean;
  readonly headerAccessory?: ReactNode;
}>) {
  const p = usePalette();
  const secondaryText = p.dark ? p.text : p.textMuted;
  const captionContent = caption ? (
    <Text
      testID="analysis-card-caption"
      style={{
        paddingHorizontal: SPACING.lg,
        paddingBottom: SPACING.md,
        color: captionBelowFooter ? p.textMuted : secondaryText,
        ...(captionBelowFooter ? TYPOGRAPHY.footnote : TYPOGRAPHY.caption),
      }}
    >
      {caption}
    </Text>
  ) : null;
  return (
    <SurfaceCard>
      <AnalysisCardHeader
        title={title}
        label={label}
        onPress={onPress}
        accessory={headerAccessory}
      />
      <View style={{ paddingHorizontal: SPACING.lg }}>{children}</View>
      {captionBelowFooter ? null : captionContent}
      <CardFooterLine />
      {captionBelowFooter ? captionContent : null}
    </SurfaceCard>
  );
}
export function AnalysisValueRow({
  label,
  value,
  total = false,
  first = false,
  onPress,
  icon,
  iconColor,
  leading,
  dot,
  reserveDisclosure = false,
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
}) {
  const p = usePalette();
  const secondaryText = p.dark ? p.text : p.textMuted;
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3;
  const style = {
    minHeight: 47,
    paddingVertical: SPACING.sm + SPACING.xxs,
    gap: SPACING.sm,
    borderTopWidth: first ? 0 : 1,
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
            color: secondaryText,
            ...TYPOGRAPHY.body,
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
            color: p.text,
            ...(total ? TYPOGRAPHY.bodyStrong : TYPOGRAPHY.body),
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
            {onPress ? (
              <Ionicons name="ellipsis-horizontal-circle" size={16} color={secondaryText} />
            ) : null}
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
