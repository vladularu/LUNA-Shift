import { createContext, useContext, type ReactNode } from "react";
import { View } from "react-native";
import { CHECK_REFERENCE_LIGHT_PALETTE, type Palette } from "@/theme/palette-values";
import { usePalette } from "@/theme/palette";
import { REPORT_CARD_GAP, SPACING } from "@/theme/tokens";
import { CHECK_REFERENCE_TYPOGRAPHY, TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { AnalysisDetailSummaryCard } from "./analysis-detail-layout";

export function checkReferenceColors(palette: Palette) {
  if (!palette.dark) return CHECK_REFERENCE_LIGHT_PALETTE;
  return {
    background: palette.background,
    paper: palette.surface,
    text: palette.text,
    secondary: palette.textMuted,
    line: palette.border,
    legal: palette.legalCheckBorder,
    legalLine: palette.legalCheckBorder,
    tariff: palette.tariffCheckBorder,
    tariffLine: palette.tariffCheckBorder,
    tariffSoft: palette.surfaceMuted,
    neutral: palette.textMuted,
    dot: palette.textMuted,
    track: palette.border,
  };
}

export const checkSourceLinkStyle = (palette: Palette) => ({
  color: checkReferenceColors(palette).tariff,
  textDecorationLine: "underline" as const,
});

export const CHECK_DETAIL_REFERENCE = {
  pageInset: 19,
  backInset: 6,
  cardRadius: 19,
  disclosureRadius: 15,
  cardPadding: 15,
  disclosureInset: 13,
  cardGap: 14,
} as const;

type ReferenceColors = ReturnType<typeof checkReferenceColors>;
export const CheckReferenceDetailContext = createContext<ReferenceColors | null>(null);

export function useCheckReferenceDetail() {
  return useContext(CheckReferenceDetailContext);
}

const category = {
  legal: { label: "Gesetz", icon: "time-outline" },
  tariff: { label: "Tarif", icon: "document-text-outline" },
  workplace: { label: "Betriebsregel", icon: "options-outline" },
  planning: { label: "Planungsempfehlung", icon: "information-circle-outline" },
} as const;

export function planningHintIcon(rule: string) {
  switch (rule) {
    case "PLANNING_WEEKEND_RECOVERY":
      return "calendar-outline";
    case "PLANNING_7_DAYS":
    case "PLANNING_NIGHT_SERIES":
      return "list-outline";
    case "PLANNING_NIGHT_RECOVERY":
      return "bed-outline";
    case "PLANNING_LATE_EARLY":
      return "repeat-outline";
    case "TIME_GROSS_OVER_16H":
      return "time-outline";
    default:
      return "information-circle-outline";
  }
}

export function CheckDetailHeading({
  kind,
  period,
  title,
  caption,
  planningIcon,
}: {
  readonly kind: keyof typeof category;
  readonly period: string;
  readonly title: string;
  readonly caption: string;
  readonly planningIcon?: import("react").ComponentProps<typeof Ionicons>["name"];
}) {
  const reference = useCheckReferenceDetail();
  if (!reference)
    return <AnalysisDetailSummaryCard period={period} title={title} caption={caption} />;
  const color = kind === "planning" || kind === "workplace" ? reference.neutral : reference[kind];
  return (
    <View testID="check-reference-heading" style={{ marginTop: 3, marginBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons
          name={planningIcon ?? category[kind].icon}
          color={color}
          size={15}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={{ ...CHECK_REFERENCE_TYPOGRAPHY.category, color, flexShrink: 1 }}>
          {category[kind].label}
        </Text>
      </View>
      <Text
        accessibilityRole="header"
        style={{
          ...CHECK_REFERENCE_TYPOGRAPHY.title,
          color: reference.text,
          marginTop: 7,
          marginBottom: 6,
        }}
      >
        {title}
      </Text>
      <Text style={{ ...CHECK_REFERENCE_TYPOGRAPHY.date, color: reference.secondary }}>
        {period}
      </Text>
    </View>
  );
}

export function CheckDetailStack({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
  readonly embedded?: boolean;
}) {
  const reference = useCheckReferenceDetail();
  return (
    <View
      testID={testID}
      style={{ gap: reference ? CHECK_DETAIL_REFERENCE.cardGap : REPORT_CARD_GAP }}
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
  disclosure = false,
}: {
  readonly children: ReactNode;
  readonly title?: string;
  readonly testID?: string;
  readonly accent?: string;
  readonly disclosure?: boolean;
}) {
  const palette = usePalette();
  const reference = useCheckReferenceDetail();
  if (reference)
    return (
      <View
        testID={testID}
        style={{
          paddingHorizontal: disclosure
            ? CHECK_DETAIL_REFERENCE.disclosureInset
            : CHECK_DETAIL_REFERENCE.cardPadding,
          paddingVertical: disclosure ? 0 : CHECK_DETAIL_REFERENCE.cardPadding,
          borderRadius: disclosure
            ? CHECK_DETAIL_REFERENCE.disclosureRadius
            : CHECK_DETAIL_REFERENCE.cardRadius,
          borderWidth: 1,
          borderColor: reference.line,
          ...(accent ? { borderLeftWidth: 3, borderLeftColor: accent } : {}),
          backgroundColor: reference.paper,
          gap: 7,
        }}
      >
        {title ? (
          <Text
            accessibilityRole="header"
            style={{ ...CHECK_REFERENCE_TYPOGRAPHY.section, color: reference.text }}
          >
            {title}
          </Text>
        ) : null}
        {children}
      </View>
    );
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
