import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { Pressable, View, useWindowDimensions } from "react-native";
import type { NetPayResult } from "@/domain/net-pay";
import { formatMonthTitle } from "@/engine/calendar";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { NetPayText } from "./net-pay-controls";
import { netPayEuro, netPayForecastEuro, netPayForecastLabel } from "./net-pay-format";
import { NetPayAmountRow } from "./net-pay-amount-row";
import { CardSeparator } from "@/ui/design-system";
import { SalaryAmountRow, SalaryPremiumCard, SalarySectionCard } from "./salary-ui";

type AvailablePay = Extract<NetPayResult, { status: "available" }>;
type Premiums = { readonly paidPremiumCents: number; readonly taxFreeCents: number };

export function NetPaySalarySummary({
  pay,
  pensionOmitted,
  premiums,
  caption,
  onGross,
  onDeductions,
  onPremiums,
}: {
  readonly pay: AvailablePay;
  readonly pensionOmitted: boolean;
  readonly premiums: Premiums;
  readonly caption?: string;
  readonly onGross: () => void;
  readonly onDeductions: () => void;
  readonly onPremiums: () => void;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.4;
  const netLabel = netPayForecastEuro(pay);
  const heroType = width < 360 ? TYPOGRAPHY.hero : TYPOGRAPHY.salaryHero;
  const notice = netPayForecastLabel(pay);
  const title = pensionOmitted ? "Netto vor Zusatzversorgung" : "Voraussichtliches Netto";
  return (
    <>
      <SalarySectionCard title="Netto-Prognose">
        <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
          <Text
            accessible
            accessibilityLabel={`${title}: ${netLabel}`}
            selectable
            style={{
              ...heroType,
              fontVariant: ["tabular-nums"],
              color: palette.text,
            }}
          >
            {netLabel.replaceAll("\u00a0", " ")}
          </Text>
          {caption ? (
            <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>{caption}</Text>
          ) : null}
          {notice ? <NetPayText>{notice}</NetPayText> : null}
          {pensionOmitted ? <NetPayText>Zusatzversorgung offen</NetPayText> : null}
          <View
            style={{
              flexDirection: "row",
              flexWrap: stacked ? "wrap" : "nowrap",
              gap: SPACING.lg,
              borderTopWidth: 1,
              borderTopColor: palette.separator,
              paddingTop: SPACING.sm,
            }}
          >
            <NetPaySummaryMetric
              label="Gesamtbrutto"
              displayLabel="Brutto"
              cents={pay.amounts.grossCents}
              onPress={onGross}
              overview
            />
            {!stacked ? <View style={{ width: 1, backgroundColor: palette.separator }} /> : null}
            <NetPaySummaryMetric
              label="Abzüge"
              cents={pay.amounts.grossCents - pay.netCents}
              onPress={onDeductions}
              negative
              overview
            />
          </View>
        </View>
      </SalarySectionCard>
      <SalaryPremiumCard
        totalCents={premiums.paidPremiumCents}
        taxFreeCents={premiums.taxFreeCents}
        onPress={onPremiums}
        grouped
      />
    </>
  );
}
export function NetPaySummaryMetric({
  label,
  displayLabel,
  cents,
  onPress,
  negative = false,
  color,
  large = false,
  expanded,
  overview = false,
}: {
  readonly label: string;
  readonly displayLabel?: string;
  readonly cents: number;
  readonly onPress?: () => void;
  readonly negative?: boolean;
  readonly color?: string;
  readonly large?: boolean;
  readonly expanded?: boolean;
  readonly overview?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.4;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}: ${netPayEuro(negative ? -cents : cents)}`}
      accessibilityHint={onPress ? "Details anzeigen" : undefined}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: stacked ? "100%" : overview ? 0 : "45%",
        minHeight: 48,
        gap: SPACING.xxs,
        paddingVertical: 4,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.xxs }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            color: palette.textMuted,
            ...(overview ? TYPOGRAPHY.small : TYPOGRAPHY.caption),
            flexShrink: 1,
          }}
        >
          {displayLabel ?? label}
        </Text>
        {onPress && !overview ? (
          <Ionicons
            accessibilityElementsHidden
            name={
              expanded === undefined ? "chevron-forward" : expanded ? "chevron-up" : "chevron-down"
            }
            color={palette.textMuted}
            size={16}
          />
        ) : null}
      </View>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{
          color: color ?? palette.text,
          ...(large ? TYPOGRAPHY.hero : overview ? TYPOGRAPHY.value : TYPOGRAPHY.bodyStrong),
          fontVariant: ["tabular-nums"],
        }}
      >
        {netPayEuro(negative ? -cents : cents)}
      </Text>
    </Pressable>
  );
}

export function NetPayDetailAmount({
  label,
  cents,
}: {
  readonly label: string;
  readonly cents: number;
}) {
  return <NetPayAmountRow label={label} value={netPayEuro(cents)} />;
}

export function NetPayDeductionDetails({
  pay,
  pensionOmitted,
  month,
  compact = false,
}: {
  readonly pay: AvailablePay;
  readonly pensionOmitted: boolean;
  readonly month: string;
  readonly compact?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const compactAmount = width < 360 || fontScale >= 1.4;

  const notice = netPayForecastLabel(pay);
  const mainRows = [
    ["Lohnsteuer", pay.tax.wageTaxCents],
    ["Krankenversicherung", pay.socialInsurance.healthCents],
    ["Pflegeversicherung", pay.socialInsurance.careCents],
    ["Rentenversicherung", pay.socialInsurance.pensionCents],
    ["Arbeitslosenversicherung", pay.socialInsurance.unemploymentCents],
  ] as const;
  const extraRows = [
    ["Solidaritätszuschlag", pay.tax.solidarityCents],
    ["Kirchensteuer", pay.tax.churchTaxCents],
    ...(!pensionOmitted && pay.pension && pay.pension.scheme !== "NONE"
      ? [["Zusatzversorgung", pay.pension.employeeCents] as const]
      : []),
    ...(pay.additionalNetDeductionCents
      ? [["Weitere Netto-Abzüge", pay.additionalNetDeductionCents] as const]
      : []),
  ] as const;
  return (
    <View style={{ gap: SPACING.lg }}>
      {compact ? (
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.text, ...TYPOGRAPHY.label }}
        >
          Deine Abzüge
        </Text>
      ) : (
        <SalarySectionCard title="Abzüge insgesamt">
          <Text
            accessible
            accessibilityLabel={`Abzüge insgesamt: ${netPayEuro(pay.amounts.grossCents - pay.netCents)}, ${formatMonthTitle(month)}`}
            selectable
            style={{
              ...(compactAmount ? TYPOGRAPHY.highlightCount : TYPOGRAPHY.highlightValue),
              color: palette.text,
              padding: SPACING.lg,
              fontVariant: ["tabular-nums"],
            }}
          >
            {netPayEuro(pay.amounts.grossCents - pay.netCents).replaceAll("\u00a0", " ")}
          </Text>
        </SalarySectionCard>
      )}
      {notice ? <NetPayText>{notice}</NetPayText> : null}
      <SalarySectionCard title="Steuern und Sozialversicherung">
        {[...mainRows, ...extraRows].map(([label, cents], index) => (
          <View key={label}>
            {index ? <CardSeparator /> : null}
            <SalaryAmountRow label={label} value={netPayEuro(cents)} quiet />
          </View>
        ))}
      </SalarySectionCard>
      <SalarySectionCard title="Berechnungsgrundlagen">
        <SalaryAmountRow
          label="Steuerbrutto"
          value={netPayEuro(pay.amounts.taxableGrossCents)}
          quiet
        />
        <CardSeparator />
        <SalaryAmountRow
          label="SV-Brutto"
          value={netPayEuro(pay.amounts.socialInsuranceGrossCents)}
          quiet
        />
        {notice ? (
          <>
            <CardSeparator />
            <SalaryAmountRow
              label="Netto rechnerisch (vorläufig)"
              value={netPayEuro(pay.netCents)}
              quiet
            />
          </>
        ) : null}
        <CardSeparator />
        <View style={{ padding: SPACING.lg, gap: SPACING.sm }}>
          <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
            Krankenversicherung einschließlich Zusatzbeitrag.
          </Text>
          <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
            Geschätzte Abzüge · Die tatsächliche Auszahlung kann abweichen.
          </Text>
        </View>
      </SalarySectionCard>
      {pensionOmitted ? (
        <NetPayText>
          Beiträge zur Zusatzversorgung und ihre Auswirkungen auf Steuern und Sozialversicherung
          fehlen noch.
        </NetPayText>
      ) : null}
    </View>
  );
}
