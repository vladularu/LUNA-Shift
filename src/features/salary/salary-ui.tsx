import { useContext, type ComponentProps, type PropsWithChildren, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { SafeAreaInsetsContext, SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { SurfaceCard, CardSeparator, RowButton } from "@/ui/design-system";
import { usePalette } from "@/theme/palette";
import {
  MINIMUM_TOUCH_TARGET,
  RADII,
  REPORT_CARD_GAP,
  SCREEN_LAYOUT,
  SPACING,
} from "@/theme/tokens";
import { CARD_METRICS, cardHeaderFrame } from "@/theme/card-layout";
import { cardTextStyle } from "@/theme/card-typography";
import { pageHeaderStyle } from "@/theme/page-header";
import { TYPOGRAPHY } from "@/theme/typography";
import { ScreenScrollView } from "@/ui/screen-layout";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import { GlassBackButton } from "@/ui/glass-back-button";
import { netPayEuro } from "./net-pay-format";

type IconName = ComponentProps<typeof Ionicons>["name"];

export function SalaryIcon({
  name,
  accent = false,
}: {
  readonly name: IconName;
  readonly accent?: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 40,
        height: 40,
        borderRadius: RADII.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: accent ? palette.salaryAccentSoft : palette.surfaceMuted,
      }}
    >
      <Ionicons name={name} size={23} color={accent ? palette.salaryAccent : palette.text} />
    </View>
  );
}

export function SalaryPage({
  title,
  month,
  action,
  backLabel = "Zurück zum Gehalt",
  largeTitle = false,
  showBackFooter = true,
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly month?: string;
  readonly action?: ReactNode;
  readonly backLabel?: string;
  readonly largeTitle?: boolean;
  readonly showBackFooter?: boolean;
}>) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const stacked = !largeTitle && fontScale >= SCREEN_LAYOUT.headerAccessoryStackFontScale;
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <SafeAreaView
      testID="salary-page-safe-area"
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: palette.groupedBackground }}
    >
      <View
        accessibilityRole="toolbar"
        style={{
          ...pageHeaderStyle(palette.groupedBackground),
          flexDirection: "row",
          flexWrap: stacked ? "wrap" : "nowrap",
          alignItems: "center",
          gap: largeTitle ? SPACING.sm : SPACING.md,
          paddingHorizontal: largeTitle ? SPACING.sm : SPACING.xl,
          paddingVertical: SPACING.md,
        }}
      >
        <GlassBackButton onPress={() => router.back()} />
        {stacked && action ? (
          <View style={{ width: MINIMUM_TOUCH_TARGET, marginLeft: "auto" }}>{action}</View>
        ) : null}
        <View
          style={{
            flex: stacked ? undefined : 1,
            flexBasis: stacked ? "100%" : undefined,
            minWidth: 0,
            gap: SPACING.xxs,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{
              ...(largeTitle
                ? TYPOGRAPHY.highlightValue
                : stacked
                  ? TYPOGRAPHY.sectionTitle
                  : TYPOGRAPHY.screenTitle),
              color: palette.text,
              textAlign: largeTitle ? "left" : "center",
            }}
          >
            {title}
          </Text>
          {month ? (
            <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, textAlign: "center" }}>
              {month}
            </Text>
          ) : null}
        </View>
        {!stacked && (!largeTitle || action) ? (
          <View style={{ width: MINIMUM_TOUCH_TARGET }}>{action}</View>
        ) : null}
      </View>
      <BackFooterLayout
        footerTestID="salary-back-footer"
        showFooter={showBackFooter}
        label={backLabel}
        onPress={() => router.back()}
      >
        {(bottomPadding) => (
          <ScreenScrollView
            testID="salary-scroll-content"
            surface="groupedBackground"
            contentInsetAdjustmentBehavior="never"
            contentGap={REPORT_CARD_GAP}
            contentContainerStyle={{ paddingTop: 0 }}
            bottomPadding={
              showBackFooter ? bottomPadding : Math.max(insets?.bottom ?? 0, SPACING.lg)
            }
          >
            {children}
          </ScreenScrollView>
        )}
      </BackFooterLayout>
    </SafeAreaView>
  );
}

export function SalaryMonthNavigator({
  label,
  onPrevious,
  onNext,
  disabled = false,
}: {
  readonly label: string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="toolbar"
      style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}
    >
      {(["previous", "label", "next"] as const).map((item) =>
        item === "label" ? (
          <Text
            key={item}
            accessibilityLiveRegion="polite"
            style={{
              ...TYPOGRAPHY.value,
              fontWeight: "400",
              color: palette.textMuted,
              textAlign: "center",
              flex: 1,
              minWidth: 0,
            }}
          >
            {label}
          </Text>
        ) : (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityLabel={`${item === "previous" ? "Vorheriger" : "Nächster"} Monat, aktuell ${label}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={item === "previous" ? onPrevious : onNext}
            style={({ pressed }) => ({
              width: MINIMUM_TOUCH_TARGET,
              minHeight: MINIMUM_TOUCH_TARGET,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: RADII.control,
              backgroundColor: pressed ? palette.surfaceMuted : "transparent",
            })}
          >
            <Ionicons
              name={item === "previous" ? "chevron-back" : "chevron-forward"}
              size={23}
              color={palette.text}
              accessibilityElementsHidden
            />
          </Pressable>
        ),
      )}
    </View>
  );
}

export function SalarySectionCard({
  title,
  amount,
  embedded = false,
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly amount?: string;
  readonly embedded?: boolean;
}>) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = amount !== undefined && (width < 360 || fontScale >= 1.4);
  const Container = embedded ? View : SurfaceCard;
  return (
    <Container>
      <View
        style={{
          ...(embedded
            ? { paddingHorizontal: SPACING.lg }
            : cardHeaderFrame(palette.dark, SPACING.lg)),
          minHeight: embedded || palette.dark ? undefined : 50,
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "stretch" : "center",
          paddingVertical: SPACING.md,
          gap: SPACING.xs,
          backgroundColor: embedded ? palette.surface : palette.cardHeader,
          borderBottomWidth: !embedded && palette.dark ? 1 : 0,
          borderBottomColor: palette.separator,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            ...TYPOGRAPHY.sectionTitle,
            color: palette.text,
            flex: stacked ? undefined : 1,
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          {title}
        </Text>
        {amount !== undefined ? (
          <Text
            style={{
              ...TYPOGRAPHY.sectionTitle,
              color: palette.text,
              textAlign: "right",
              fontVariant: ["tabular-nums"],
              flexShrink: 1,
            }}
          >
            {amount}
          </Text>
        ) : null}
      </View>
      <View style={{ paddingTop: embedded ? 0 : CARD_METRICS.contentTopPadding }}>{children}</View>
    </Container>
  );
}

export function SalaryAmountRow({
  label,
  value,
  subtitle,
  onPress,
  expanded,
  quiet = false,
  emphasizeValue = false,
  chevronPlacement = "value",
}: {
  readonly label: string;
  readonly value: string;
  readonly subtitle?: string;
  readonly onPress?: () => void;
  readonly expanded?: boolean;
  readonly quiet?: boolean;
  readonly emphasizeValue?: boolean;
  readonly chevronPlacement?: "value" | "label";
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.4;
  const labelContent = (
    <Text
      selectable={!onPress}
      style={{
        ...TYPOGRAPHY.body,
        ...cardTextStyle(palette, "label"),
      }}
    >
      {label}
    </Text>
  );
  const chevron = onPress ? (
    <Ionicons
      name={expanded === undefined ? "chevron-forward" : expanded ? "chevron-up" : "chevron-down"}
      color={palette.textMuted}
      size={18}
      accessibilityElementsHidden
    />
  ) : null;
  const content = (
    <View
      style={{
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "center",
        gap: SPACING.sm,
        flex: 1,
        minWidth: 0,
      }}
    >
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: SPACING.xxs }}>
        {onPress && chevronPlacement === "label" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.xs }}>
            <View style={{ flexShrink: 1 }}>{labelContent}</View>
            {chevron}
          </View>
        ) : (
          labelContent
        )}
        {subtitle ? (
          <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>{subtitle}</Text>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: SPACING.sm,
          maxWidth: stacked ? undefined : "55%",
          flexShrink: 1,
        }}
      >
        <Text
          selectable={!onPress}
          style={{
            ...TYPOGRAPHY.body,
            ...cardTextStyle(palette, emphasizeValue ? "total" : "value"),
            textAlign: "right",
            fontVariant: ["tabular-nums"],
            flexShrink: 1,
          }}
        >
          {value}
        </Text>
        {chevronPlacement === "value" ? chevron : null}
      </View>
    </View>
  );
  const style = {
    minHeight: CARD_METRICS.rowMinHeight + (quiet ? 0 : SPACING.xxs),
    paddingHorizontal: CARD_METRICS.contentInset,
    paddingVertical: CARD_METRICS.rowPaddingVertical,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint="Details öffnen"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        ...style,
        backgroundColor: pressed ? palette.surfaceMuted : "transparent",
      })}
    >
      {content}
    </Pressable>
  ) : (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${subtitle ? `. ${subtitle}` : ""}`}
      style={style}
    >
      {content}
    </View>
  );
}

export function SalaryNavigationRow({
  title,
  subtitle,
  icon,
  onPress,
  disabled = false,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: IconName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  if (!icon)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 48,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.md,
          backgroundColor: pressed ? palette.surfaceMuted : "transparent",
          opacity: disabled ? 0.5 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0, gap: SPACING.xxs }}>
          <Text style={{ ...TYPOGRAPHY.body, ...cardTextStyle(palette, "action") }}>{title}</Text>
          {subtitle ? (
            <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>{subtitle}</Text>
          ) : null}
        </View>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={palette.text}
          accessibilityElementsHidden
        />
      </Pressable>
    );
  return (
    <RowButton
      title={title}
      subtitle={subtitle}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      leading={<SalaryIcon name={icon} />}
      onPress={onPress}
      disabled={disabled}
    />
  );
}

export function SalaryPremiumCard({
  totalCents,
  taxFreeCents,
  title = "Zeitzuschläge",
  onPress,
  grouped = false,
}: {
  readonly totalCents: number | null;
  readonly taxFreeCents: number | null;
  readonly title?: string;
  readonly onPress?: () => void;
  readonly grouped?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.4;
  const amount = totalCents === null ? "Noch offen" : netPayEuro(totalCents);
  if (grouped)
    return (
      <SalarySectionCard title={title} amount={amount}>
        {taxFreeCents === null || totalCents === null ? (
          <Text style={{ ...TYPOGRAPHY.small, padding: SPACING.lg, color: palette.textMuted }}>
            Steuerliche Aufteilung noch nicht verfügbar.
          </Text>
        ) : (
          <>
            <SalaryAmountRow label="Steuerfrei" value={netPayEuro(taxFreeCents)} quiet />
            <CardSeparator />
            <SalaryAmountRow
              label="Steuerpflichtig"
              value={netPayEuro(totalCents - taxFreeCents)}
              quiet
            />
          </>
        )}
        {onPress ? (
          <>
            <CardSeparator />
            <SalaryNavigationRow title="Aufteilung ansehen" onPress={onPress} />
          </>
        ) : null}
      </SalarySectionCard>
    );
  return (
    <SalarySectionCard title={title}>
      <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
        <View
          style={{
            flexDirection: stacked ? "column" : "row",
            alignItems: stacked ? "stretch" : "center",
            gap: SPACING.md,
          }}
        >
          <Text
            accessible
            accessibilityLabel={`${title}: ${amount}`}
            selectable
            style={{
              ...(stacked ? TYPOGRAPHY.highlightCount : TYPOGRAPHY.highlightValue),
              color: palette.text,
              fontVariant: ["tabular-nums"],
              flex: 1,
              minWidth: 0,
            }}
          >
            {amount.replaceAll("\u00a0", " ")}
          </Text>
        </View>
        <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
          {taxFreeCents === null || totalCents === null
            ? "Steuerliche Aufteilung noch nicht verfügbar."
            : `Steuerfrei ${netPayEuro(taxFreeCents)} · Steuerpflichtig ${netPayEuro(totalCents - taxFreeCents)}`}
        </Text>
      </View>
      {onPress ? (
        <>
          <CardSeparator />
          <SalaryNavigationRow title="Zuschläge ansehen" onPress={onPress} />
        </>
      ) : null}
    </SalarySectionCard>
  );
}
