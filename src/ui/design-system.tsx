import { SelectionControl, type SelectionControlProps } from "@/ui/selection-control";
import { Text } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import Ionicons from "@/ui/icon";
import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, View, type PressableStateCallbackType, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { usePalette } from "@/theme/palette";

import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, CARD_HEADER_INSET, RADII, SHADOWS, SPACING } from "@/theme/tokens";
import { accessibleChipBackgroundColor, chipTextColor } from "@/theme/color-contrast";
import { AnimatedPressable, usePressMotion } from "@/ui/press-motion";
import { ShiftSymbol } from "@/ui/shift-symbol";

export function SurfaceCard({
  children,
  style,
  accessibilityLabel,
  testID,
}: PropsWithChildren<{
  readonly style?: ViewStyle;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}>) {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={{
        overflow: "hidden",
        borderWidth: 1,
        borderColor: palette.separator,
        borderRadius: RADII.card,
        borderCurve: CORNER_CURVE,
        backgroundColor: palette.surface,
        boxShadow: SHADOWS.card,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

export function CardHeader({
  title,
  caption,
  action,
}: {
  readonly title: string;
  readonly caption?: string;
  readonly action?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        borderCurve: CORNER_CURVE,
        minHeight: palette.dark ? 56 : 50,
        justifyContent: "center",
        flexDirection: "row",
        alignItems: "center",
        gap: SPACING.sm,
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.lg,
        marginHorizontal: palette.dark ? 0 : CARD_HEADER_INSET,
        marginTop: palette.dark ? 0 : CARD_HEADER_INSET,
        borderTopLeftRadius: palette.dark ? 0 : RADII.card - CARD_HEADER_INSET,
        borderTopRightRadius: palette.dark ? 0 : RADII.card - CARD_HEADER_INSET,
        backgroundColor: palette.cardHeader,
        borderBottomWidth: 0,
        borderBottomColor: palette.cardSeparator,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{ alignSelf: "stretch", color: palette.text, ...TYPOGRAPHY.sectionTitle }}
        >
          {title}
        </Text>
        {caption ? (
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{
              color: palette.dark ? palette.text : palette.textMuted,
              ...TYPOGRAPHY.caption,
            }}
          >
            {caption}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function SectionHeader({
  title,
  caption,
  action,
}: {
  readonly title: string;
  readonly caption?: string;
  readonly action?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        minHeight: 26,
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: SPACING.md,
      }}
    >
      <View style={{ flex: 1, gap: SPACING.xxs }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{ color: palette.textSecondary, ...TYPOGRAPHY.sectionTitle }}
        >
          {title}
        </Text>
        {caption ? (
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            selectable
            style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
          >
            {caption}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function MetricCard({
  label,
  value,
  accent,
  compact = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: string;
  readonly compact?: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel={`${label}: ${value}`}
      accessible
      style={{
        minHeight: compact ? 72 : 82,
        flex: 1,
        justifyContent: "space-between",
        gap: SPACING.sm,
        borderWidth: 1,
        borderColor: palette.separator,
        borderRadius: RADII.card,
        borderCurve: CORNER_CURVE,
        backgroundColor: palette.surface,
        padding: compact ? SPACING.md : SPACING.lg,
      }}
    >
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.textMuted, ...TYPOGRAPHY.label }}
      >
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: accent ?? palette.text,
          ...TYPOGRAPHY.value,
          fontFamily: INTER_FONTS.regular,
          fontSize: compact ? 18 : TYPOGRAPHY.value.fontSize,
          fontVariant: ["tabular-nums"],
          letterSpacing: -0.4,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function RowButton({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  destructive = false,
  disabled = false,
  onLongPress,
  delayLongPress,
  accessibilityHint,
  accessibilityLabel,
  accessibilityState,
  subtitleBelow = false,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onPress?: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onLongPress?: () => void;
  readonly delayLongPress?: number;
  readonly accessibilityHint?: string;
  readonly accessibilityLabel?: string;
  readonly accessibilityState?: import("react-native").AccessibilityState;
  readonly subtitleBelow?: boolean;
}) {
  const palette = usePalette();
  const pressMotion = usePressMotion();
  const rowContent = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: SPACING.xxs }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{
            color: destructive ? palette.danger : palette.text,
            ...TYPOGRAPHY.bodyStrong,
          }}
        >
          {title}
        </Text>
        {subtitle && !subtitleBelow ? (
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            selectable
            style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <Ionicons
            accessibilityElementsHidden
            color={palette.textMuted}
            name="chevron-forward"
            size={18}
          />
        ) : null)}
    </>
  );

  const content =
    subtitleBelow && subtitle ? (
      <View style={{ flex: 1, minWidth: 0, gap: SPACING.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
          {rowContent}
        </View>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
        >
          {subtitle}
        </Text>
      </View>
    ) : (
      rowContent
    );

  if (!onPress && !onLongPress) {
    return (
      <View
        style={{
          minHeight: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.md,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.sm,
        }}
      >
        {content}
      </View>
    );
  }

  return (
    <Animated.View style={[{ minHeight: 56 }, pressMotion.animatedStyle]}>
      <Pressable
        accessibilityHint={accessibilityHint}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ ...accessibilityState, disabled }}
        accessibilityRole="button"
        delayLongPress={delayLongPress}
        disabled={disabled}
        onPressIn={pressMotion.onPressIn}
        onPressOut={pressMotion.onPressOut}
        onLongPress={onLongPress}
        onPress={onPress ?? (() => undefined)}
        style={({ pressed }) => ({
          minHeight: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.md,
          backgroundColor: pressed ? palette.surfaceMuted : "transparent",
          opacity: disabled ? 0.45 : 1,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.sm,
        })}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}

export function CardSeparator({ inset = SPACING.lg }: { readonly inset?: number }) {
  const palette = usePalette();
  return <View style={{ height: 1, backgroundColor: palette.cardSeparator, marginLeft: inset }} />;
}

export function CardFooterLine() {
  return (
    <View style={{ marginHorizontal: SPACING.lg, paddingBottom: SPACING.lg }}>
      <CardSeparator inset={0} />
    </View>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  readonly title: string;
  readonly message: string;
  readonly action?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel={`${title}. ${message}`}
      accessible
      style={{
        minHeight: 180,
        alignItems: "center",
        justifyContent: "center",
        gap: SPACING.sm,
        padding: SPACING.xxl,
      }}
    >
      <View
        accessibilityElementsHidden
        style={{
          borderCurve: CORNER_CURVE,
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: RADII.control,
          backgroundColor: palette.primarySoft,
        }}
      >
        <Ionicons color={palette.primary} name="calendar-clear-outline" size={21} />
      </View>
      <Text
        accessibilityElementsHidden
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.text, textAlign: "center", ...TYPOGRAPHY.sectionTitle }}
      >
        {title}
      </Text>
      <Text
        accessibilityElementsHidden
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ maxWidth: 290, color: palette.textMuted, textAlign: "center", ...TYPOGRAPHY.body }}
      >
        {message}
      </Text>
      {action}
    </View>
  );
}

export function InlineNotice({
  message,
  tone = "info",
}: {
  readonly message: string;
  readonly tone?: "info" | "error" | "warning";
}) {
  const palette = usePalette();
  const accent =
    tone === "error" ? palette.danger : tone === "warning" ? palette.warning : palette.info;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACING.sm,
        borderWidth: 1,
        borderColor: `${accent}52`,
        borderRadius: RADII.control,
        borderCurve: CORNER_CURVE,
        backgroundColor: `${accent}14`,
        paddingHorizontal: SPACING.md,
        paddingVertical: 10,
      }}
    >
      <Ionicons
        accessibilityElementsHidden
        color={accent}
        name={
          tone === "error"
            ? "alert-circle-outline"
            : tone === "warning"
              ? "warning-outline"
              : "information-circle-outline"
        }
        size={18}
      />
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ minWidth: 0, flex: 1, color: accent, ...TYPOGRAPHY.label }}
      >
        {message}
      </Text>
    </View>
  );
}

export function SegmentedControl(props: SelectionControlProps) {
  return <SelectionControl {...props} />;
}

export function HeaderAction({
  label,
  onPress,
  emphasis = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly emphasis?: boolean;
}) {
  const palette = usePalette();
  const pressMotion = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      onPressIn={pressMotion.onPressIn}
      onPressOut={pressMotion.onPressOut}
      style={({ pressed }: PressableStateCallbackType) => [
        {
          borderCurve: CORNER_CURVE,
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: label === "+" ? RADII.pill : RADII.control,
          backgroundColor: emphasis ? palette.primaryAction : palette.surfaceMuted,
          opacity: pressed ? 0.72 : 1,
          paddingHorizontal: label.length > 2 ? 12 : 0,
        },
        pressMotion.animatedStyle,
      ]}
    >
      {label === "+" ? (
        <Ionicons
          accessibilityElementsHidden
          color={emphasis ? palette.onPrimaryAction : palette.primary}
          name="add"
          size={22}
        />
      ) : (
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            color: emphasis ? palette.onPrimaryAction : palette.primary,
            ...TYPOGRAPHY.label,
          }}
        >
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}

export function ColorBadge({
  color,
  label,
  size = 42,
}: {
  readonly color: string;
  readonly label: string;
  readonly size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: size / 2,
        backgroundColor: accessibleChipBackgroundColor(color),
      }}
    >
      <ShiftSymbol color={chipTextColor} size={size * 0.48} value={label} />
    </View>
  );
}
