import { Text } from "@/ui/text";
import { AnalysisViewControls } from "./analysis-view-controls";
import Ionicons from "@/ui/icon";
import { Pressable, View, useWindowDimensions } from "react-native";

import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import {
  CONTROL_HEIGHT,
  MINIMUM_TOUCH_TARGET,
  RADII,
  SCREEN_LAYOUT,
  SPACING,
} from "@/theme/tokens";
import { TabScreenHeader } from "@/ui/screen-layout";
import {
  ReportScrollEdge,
  ReportScrollHeader,
  useReportScrollHeaderEnabled,
} from "@/ui/report-scroll-header";
import { PeriodArrow } from "./analysis-period-arrow";
export { formatMonthRangeLabel } from "@/ui/report-period-labels";

export function AnalysisMonthHeader({
  label,
  onPrevious,
  onNext,
  onOpenYear,
}: {
  readonly label: string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onOpenYear: () => void;
}) {
  return (
    <AnalysisPeriodHeader
      label={label}
      nextAccessibilityLabel={`Nächster Monat, aktuell ${label}`}
      onNext={onNext}
      onPrevious={onPrevious}
      onToggle={onOpenYear}
      previousAccessibilityLabel={`Vorheriger Monat, aktuell ${label}`}
      testID="analysis-month-toolbar"
      toggleAccessibilityLabel="Jahresauswertung öffnen"
    />
  );
}

export function AnalysisYearHeader({
  year,
  activeMonthCount,
  onPrevious,
  onNext,
  onOpenMonth,
}: {
  readonly year: number;
  readonly activeMonthCount?: number;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onOpenMonth: () => void;
}) {
  return (
    <AnalysisPeriodHeader
      label={`${year} ${activeMonthCount ?? "…"} Monate mit Einträgen`}
      compactSingleLine
      nextAccessibilityLabel={`Nächstes Jahr, aktuell ${year}`}
      onNext={onNext}
      onPrevious={onPrevious}
      onToggle={onOpenMonth}
      previousAccessibilityLabel={`Vorheriges Jahr, aktuell ${year}`}
      testID="analysis-year-toolbar"
      toggleAccessibilityLabel="Monatsauswertung öffnen"
    />
  );
}

function AnalysisPeriodHeader({
  label,
  compactSingleLine = false,
  previousAccessibilityLabel,
  nextAccessibilityLabel,
  toggleAccessibilityLabel,
  testID,
  onPrevious,
  onNext,
  onToggle,
}: {
  readonly label: string;
  readonly compactSingleLine?: boolean;
  readonly previousAccessibilityLabel: string;
  readonly nextAccessibilityLabel: string;
  readonly toggleAccessibilityLabel: string;
  readonly testID: string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onToggle: () => void;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.3;
  const hasScrollEdge = useReportScrollHeaderEnabled();
  const periodLabel = (
    <View
      style={{
        minWidth: 0,
        flexShrink: 1,
        width: largeText ? "100%" : undefined,
        gap: SPACING.xxs,
      }}
    >
      <Text
        accessibilityLiveRegion="polite"
        dynamicTypeRamp="body"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        numberOfLines={compactSingleLine && !largeText ? 1 : undefined}
        selectable
        style={{
          color: palette.textMuted,
          textAlign: "left",
          ...TYPOGRAPHY.body,
          fontVariant: ["tabular-nums"],
        }}
      >
        {label}
      </Text>
    </View>
  );
  return (
    <ReportScrollHeader>
      <TabScreenHeader
        backgroundColor={hasScrollEdge ? "transparent" : undefined}
        bottomPadding={largeText ? SCREEN_LAYOUT.headerBottomPadding : 0}
        testID={`${testID}-header`}
        accessory={
          <View style={{ flexDirection: "row", gap: SPACING.sm }}>
            <AnalysisViewControls compact />
            <Pressable
              accessibilityLabel={toggleAccessibilityLabel}
              accessibilityRole="button"
              onPress={onToggle}
              style={({ pressed }) => ({
                width: CONTROL_HEIGHT.compact,
                height: CONTROL_HEIGHT.compact,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: palette.separator,
                borderRadius: RADII.pill,
                backgroundColor: pressed ? palette.surfaceMuted : palette.surface,
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <Ionicons
                accessible={false}
                color={palette.text}
                name="calendar-number-outline"
                size={22}
              />
            </Pressable>
          </View>
        }
        surface="groupedBackground"
        title="Auswertung"
        toolbarSpacing={largeText ? SPACING.xs : 0}
        toolbar={
          <ReportScrollEdge>
            <View
              accessibilityRole="toolbar"
              testID={testID}
              style={{
                minHeight: MINIMUM_TOUCH_TARGET,
                flexDirection: "row",
                flexWrap: largeText ? "wrap" : "nowrap",
                alignItems: largeText ? "center" : "flex-start",
                marginHorizontal: -SPACING.sm,
              }}
            >
              {largeText ? periodLabel : null}
              <PeriodArrow
                alignTop={!largeText}
                accessibilityLabel={previousAccessibilityLabel}
                direction="back"
                onPress={onPrevious}
              />
              {largeText ? <View style={{ flex: 1 }} /> : periodLabel}
              <PeriodArrow
                alignTop={!largeText}
                accessibilityLabel={nextAccessibilityLabel}
                direction="forward"
                onPress={onNext}
              />
            </View>
          </ReportScrollEdge>
        }
      />
    </ReportScrollHeader>
  );
}
