import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { SurfaceCard, CardSeparator, RowButton } from "@/ui/design-system";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, MINIMUM_TOUCH_TARGET, RADII, SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { ScreenScrollView } from "@/ui/screen-layout";
import { BackFooterLayout } from "@/ui/back-footer-layout";
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
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly month?: string;
  readonly action?: ReactNode;
  readonly backLabel?: string;
  readonly largeTitle?: boolean;
}>) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const stacked = !largeTitle && fontScale >= SCREEN_LAYOUT.headerAccessoryStackFontScale;
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: palette.groupedBackground }}
    >
      <View
        accessibilityRole="toolbar"
        style={{
          flexDirection: "row",
          flexWrap: stacked ? "wrap" : "nowrap",
          alignItems: "center",
          gap: largeTitle ? SPACING.sm : SPACING.md,
          paddingHorizontal: largeTitle ? SPACING.sm : SPACING.xl,
          paddingVertical: SPACING.md,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zurück"
          onPress={() => router.back()}
          style={({ pressed }) => ({
            width: MINIMUM_TOUCH_TARGET,
            minHeight: MINIMUM_TOUCH_TARGET,
            borderRadius: RADII.pill,
            borderCurve: CORNER_CURVE,
            borderWidth: largeTitle ? 0 : 1,
            borderColor: palette.separator,
            backgroundColor: pressed
              ? palette.surfaceMuted
              : largeTitle
                ? "transparent"
                : palette.surface,
            alignItems: "center",
            justifyContent: "center",
          })}
        >
          <Ionicons
            name="chevron-back"
            size={largeTitle ? 29 : 25}
            color={palette.text}
            accessibilityElementsHidden
          />
        </Pressable>
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
        label={backLabel}
        onPress={() => router.back()}
      >
        {(bottomPadding) => (
          <ScreenScrollView
            surface="groupedBackground"
            contentInsetAdjustmentBehavior="never"
            contentGap={SPACING.lg}
            contentContainerStyle={{ paddingTop: 0 }}
            bottomPadding={bottomPadding}
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
}: {
  readonly label: string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
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
  children,
}: PropsWithChildren<{ readonly title: string; readonly amount?: string }>) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = amount !== undefined && (width < 360 || fontScale >= 1.4);
  return (
    <SurfaceCard>
      <View
        style={{
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "stretch" : "center",
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          gap: SPACING.xs,
          backgroundColor: palette.cardHeader,
          borderBottomWidth: 1,
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
      {children}
    </SurfaceCard>
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
}: {
  readonly label: string;
  readonly value: string;
  readonly subtitle?: string;
  readonly onPress?: () => void;
  readonly expanded?: boolean;
  readonly quiet?: boolean;
  readonly emphasizeValue?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.4;
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
        <Text
          selectable={!onPress}
          style={{
            ...(quiet ? TYPOGRAPHY.body : TYPOGRAPHY.bodyStrong),
            color: quiet ? palette.textMuted : palette.text,
          }}
        >
          {label}
        </Text>
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
            ...(quiet && !emphasizeValue ? TYPOGRAPHY.body : TYPOGRAPHY.bodyStrong),
            color: palette.text,
            textAlign: "right",
            fontVariant: ["tabular-nums"],
            flexShrink: 1,
          }}
        >
          {value}
        </Text>
        {onPress ? (
          <Ionicons
            name={
              expanded === undefined ? "chevron-forward" : expanded ? "chevron-up" : "chevron-down"
            }
            color={palette.textMuted}
            size={18}
            accessibilityElementsHidden
          />
        ) : null}
      </View>
    </View>
  );
  const style = {
    minHeight: quiet ? 48 : 56,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
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
          <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>{title}</Text>
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
  onPress,
  grouped = false,
}: {
  readonly totalCents: number;
  readonly taxFreeCents: number | null;
  readonly onPress?: () => void;
  readonly grouped?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.4;
  if (grouped)
    return (
      <SalarySectionCard title="Zeitzuschläge" amount={netPayEuro(totalCents)}>
        {taxFreeCents === null ? (
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
    <SalarySectionCard title="Zeitzuschläge">
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
            accessibilityLabel={`Zeitzuschläge: ${netPayEuro(totalCents)}`}
            selectable
            style={{
              ...(stacked ? TYPOGRAPHY.highlightCount : TYPOGRAPHY.highlightValue),
              color: palette.text,
              fontVariant: ["tabular-nums"],
              flex: 1,
              minWidth: 0,
            }}
          >
            {netPayEuro(totalCents).replaceAll("\u00a0", " ")}
          </Text>
        </View>
        <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
          {taxFreeCents === null
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
