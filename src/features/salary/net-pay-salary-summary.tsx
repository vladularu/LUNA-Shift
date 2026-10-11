import { useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import type { NetPayResult } from "@/domain/net-pay";
import { formatMonthTitle } from "@/engine/calendar";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { RowButton, SurfaceCard } from "@/ui/design-system";
import { NetPayText } from "./net-pay-controls";
import { netPayEuro, netPayForecastEuro, netPayForecastLabel } from "./net-pay-format";
import { NetPayWorkflowAmount, NetPayWorkflowLink } from "./net-pay-workflow-controls";
import { NetPayAmountRow } from "./net-pay-amount-row";

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
  onServices,
  grossExpanded = false,
  grossDetails,
  deductionsExpanded = false,
  deductionDetails,
  premiumsExpanded = false,
  premiumDetails,
  servicesExpanded = false,
  serviceDetails,
}: {
  readonly pay: AvailablePay;
  readonly pensionOmitted: boolean;
  readonly premiums: Premiums;
  readonly caption?: string;
  readonly onGross: () => void;
  readonly onDeductions: () => void;
  readonly onPremiums: () => void;
  readonly onServices: () => void;
  readonly grossExpanded?: boolean;
  readonly grossDetails?: ReactNode;
  readonly deductionsExpanded?: boolean;
  readonly deductionDetails?: ReactNode;
  readonly premiumsExpanded?: boolean;
  readonly premiumDetails?: ReactNode;
  readonly servicesExpanded?: boolean;
  readonly serviceDetails?: ReactNode;
}) {
  const palette = usePalette();
  const title = pensionOmitted ? "Netto vor Zusatzversorgung" : "Netto-Prognose";
  const notice = netPayForecastLabel(pay);
  return (
    <>
      <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.md }}>
        <NetPayWorkflowAmount
          title={title}
          value={netPayForecastEuro(pay)}
          prefix="ca."
          caption={caption}
          large
        />
        {notice ? (
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: SPACING.sm,
              paddingVertical: 5,
              borderRadius: RADII.small,
              backgroundColor: palette.tertiarySoft,
              color: palette.warning,
              ...TYPOGRAPHY.caption,
            }}
          >
            {notice}
          </Text>
        ) : null}
        {pensionOmitted ? (
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: SPACING.sm,
              paddingVertical: 5,
              borderRadius: RADII.small,
              backgroundColor: palette.tertiarySoft,
              color: palette.warning,
              ...TYPOGRAPHY.caption,
            }}
          >
            Zusatzversorgung offen
          </Text>
        ) : null}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 16,
            borderTopWidth: 1,
            borderTopColor: palette.separator,
            paddingTop: 12,
          }}
        >
          <NetPaySummaryMetric
            label="Gesamtbrutto"
            cents={pay.amounts.grossCents}
            onPress={onGross}
            expanded={grossExpanded}
          />
          <NetPaySummaryMetric
            label="Abzüge"
            cents={pay.amounts.grossCents - pay.netCents}
            onPress={onDeductions}
            expanded={deductionsExpanded}
            negative
          />
        </View>
        {grossDetails}
        {deductionDetails}
      </SurfaceCard>
      <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.sm }}>
        <NetPayAmountRow label="Zeitzuschläge" value={netPayEuro(premiums.paidPremiumCents)} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          <NetPaySummaryMetric
            label="Steuerfrei"
            cents={premiums.taxFreeCents}
            color={palette.success}
          />
          <NetPaySummaryMetric
            label="Steuerpflichtig"
            cents={premiums.paidPremiumCents - premiums.taxFreeCents}
          />
        </View>
        <NetPayWorkflowLink onPress={onPremiums} expanded={premiumsExpanded}>
          Aufschlüsseln
        </NetPayWorkflowLink>
        {premiumDetails}
        <View
          style={{
            marginHorizontal: -SPACING.lg,
            borderTopWidth: 1,
            borderTopColor: palette.separator,
          }}
        >
          <RowButton
            title="Einzelne Dienste"
            subtitle="Zuschläge je Schicht ansehen"
            accessibilityLabel="Einzelne Dienste"
            onPress={onServices}
            accessibilityState={{ expanded: servicesExpanded }}
            trailing={
              <Ionicons
                accessibilityElementsHidden
                name={servicesExpanded ? "chevron-up" : "chevron-down"}
                color={palette.textMuted}
                size={18}
              />
            }
          />
        </View>
        {serviceDetails}
      </SurfaceCard>
    </>
  );
}

export function NetPaySummaryMetric({
  label,
  cents,
  onPress,
  negative = false,
  color,
  large = false,
  expanded,
}: {
  readonly label: string;
  readonly cents: number;
  readonly onPress?: () => void;
  readonly negative?: boolean;
  readonly color?: string;
  readonly large?: boolean;
  readonly expanded?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}: ${netPayEuro(cents)}`}
      accessibilityHint={onPress ? "Details anzeigen" : undefined}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: "45%",
        minHeight: 48,
        gap: SPACING.xxs,
        paddingVertical: 4,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.xxs }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
        >
          {label}
        </Text>
        {onPress ? (
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
          ...(large ? TYPOGRAPHY.hero : TYPOGRAPHY.bodyStrong),
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
  const [more, setMore] = useState(false);
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
    <View style={{ gap: SPACING.md }}>
      {compact ? (
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.text, ...TYPOGRAPHY.label }}
        >
          Deine Abzüge
        </Text>
      ) : (
        <NetPayWorkflowAmount
          title="Abzüge insgesamt"
          value={netPayEuro(pay.amounts.grossCents - pay.netCents)}
          caption={formatMonthTitle(month)}
        />
      )}
      {notice ? <NetPayText>{notice}</NetPayText> : null}
      <View>
        {[...mainRows, ...extraRows.filter(([, cents]) => cents !== 0)].map(([label, cents]) => (
          <View
            key={label}
            style={{
              borderBottomWidth: 1,
              borderBottomColor: palette.separator,
            }}
          >
            <NetPayDetailAmount label={label} cents={cents} />
          </View>
        ))}
      </View>
      <NetPayWorkflowLink onPress={() => setMore(!more)} expanded={more}>
        Berechnungsgrundlagen
      </NetPayWorkflowLink>
      {more ? (
        <View style={{ gap: SPACING.xs }}>
          {extraRows
            .filter(([, cents]) => cents === 0)
            .map(([label, cents]) => (
              <NetPayDetailAmount key={label} label={label} cents={cents} />
            ))}
          <NetPayDetailAmount label="Steuerbrutto" cents={pay.amounts.taxableGrossCents} />
          <NetPayDetailAmount label="SV-Brutto" cents={pay.amounts.socialInsuranceGrossCents} />
          <NetPayText>Krankenversicherung einschließlich Zusatzbeitrag.</NetPayText>
          {notice ? (
            <NetPayDetailAmount label="Netto rechnerisch (vorläufig)" cents={pay.netCents} />
          ) : null}
          <NetPayText>Geschätzte Abzüge · Die tatsächliche Auszahlung kann abweichen.</NetPayText>
        </View>
      ) : null}
      {pensionOmitted ? (
        <NetPayText>
          Beiträge zur Zusatzversorgung und ihre Auswirkungen auf Steuern und Sozialversicherung
          fehlen noch.
        </NetPayText>
      ) : null}
    </View>
  );
}
