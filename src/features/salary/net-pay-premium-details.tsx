import { useState } from "react";
import { Text, View } from "react-native";
import type { SfnClassificationResult, SfnPremiumCategory } from "@/domain/net-pay-sfn";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { RowButton } from "@/ui/design-system";
import { netPayEuro } from "./net-pay-format";
import { NetPayWorkflowAmount, NetPayWorkflowLink } from "./net-pay-workflow-controls";

const CATEGORIES: readonly { category: SfnPremiumCategory; label: string }[] = [
  { category: "NIGHT", label: "Nacht" },
  { category: "SUNDAY", label: "Sonntag" },
  { category: "HOLIDAY", label: "Feiertag" },
  { category: "SATURDAY", label: "Samstag" },
  { category: "OTHER", label: "Weitere" },
];

export function NetPayPremiumDetails({
  classification,
  onServices,
  compact = false,
}: {
  readonly classification: Extract<SfnClassificationResult, { status: "available" }>;
  readonly onServices?: () => void;
  readonly compact?: boolean;
}) {
  const palette = usePalette();
  const [help, setHelp] = useState(false);
  const rows = CATEGORIES.map(({ category, label }) => {
    const items = classification.shifts
      .flatMap((shift) => shift.premiumBreakdown)
      .filter((row) => row.category === category);
    return {
      category,
      label,
      paid: items.reduce((sum, row) => sum + row.paidPremiumCents, 0),
      free: items.reduce((sum, row) => sum + row.taxFreeCents, 0),
    };
  }).filter((row) => row.category !== "OTHER" || row.paid > 0);
  return (
    <View style={{ gap: SPACING.md }}>
      {!compact ? (
        <NetPayWorkflowAmount
          title="Zeitzuschläge insgesamt"
          value={netPayEuro(classification.paidPremiumCents)}
          caption="Aus geplanten Diensten"
        />
      ) : null}
      {onServices ? (
        <View style={{ marginHorizontal: -SPACING.lg }}>
          <RowButton
            title="Einzelne Dienste"
            subtitle="Zuschläge je Schicht ansehen"
            accessibilityLabel="Einzelne Dienste"
            onPress={onServices}
          />
        </View>
      ) : null}
      <View testID="net-pay-premium-table">
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel="Zuschlag, steuerfrei, steuerpflichtig"
          style={{ flexDirection: "row", gap: SPACING.sm, paddingBottom: SPACING.sm }}
        >
          {["Zuschlag", "Steuerfrei", "Steuerpflichtig"].map((title, index) => (
            <Text
              key={title}
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{
                flex: 1,
                textAlign: index ? "right" : "left",
                color: palette.textMuted,
                ...TYPOGRAPHY.footnote,
              }}
            >
              {title}
            </Text>
          ))}
        </View>
        {rows.map((row) => (
          <View
            key={row.category}
            accessible
            accessibilityLabel={`${row.label}: steuerfrei ${netPayEuro(row.free)}, steuerpflichtig ${netPayEuro(row.paid - row.free)}`}
            style={{
              flexDirection: "row",
              gap: SPACING.sm,
              alignItems: "center",
              minHeight: 44,
              paddingVertical: SPACING.sm,
              borderBottomWidth: 1,
              borderBottomColor: palette.separator,
            }}
          >
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{ flex: 1, color: palette.text, ...TYPOGRAPHY.caption }}
            >
              {row.label}
            </Text>
            <Text
              selectable
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{
                flex: 1,
                textAlign: "right",
                color: row.free ? palette.success : palette.text,
                ...TYPOGRAPHY.caption,
                fontVariant: ["tabular-nums"],
              }}
            >
              {netPayEuro(row.free)}
            </Text>
            <Text
              selectable
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{
                flex: 1,
                textAlign: "right",
                color: palette.text,
                ...TYPOGRAPHY.caption,
                fontVariant: ["tabular-nums"],
              }}
            >
              {netPayEuro(row.paid - row.free)}
            </Text>
          </View>
        ))}
      </View>
      <NetPayWorkflowLink onPress={() => setHelp(!help)} expanded={help}>
        {help ? "Aufteilung schließen" : "Wie werden sie aufgeteilt?"}
      </NetPayWorkflowLink>
      {help ? (
        <View style={{ gap: SPACING.sm }}>
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ color: palette.textMuted, ...TYPOGRAPHY.footnote }}
          >
            Die Aufteilung folgt den geplanten Arbeitszeiten und den SFN-Grenzen. Nacht-, Sonn- und
            Feiertagszuschläge können steuerfrei sein. Samstagszuschläge, bezahlte Pausen und
            Beträge oberhalb der Grenzen bleiben steuerpflichtig.
          </Text>
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ color: palette.textMuted, ...TYPOGRAPHY.footnote }}
          >
            Sozialversicherungsfrei: {netPayEuro(classification.socialInsuranceFreeCents)}. Dafür
            gelten eigene Höchstgrenzen.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
