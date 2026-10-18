import { Text } from "@/ui/text";
import { View } from "react-native";
import type { SfnClassificationResult, SfnPremiumCategory } from "@/domain/net-pay-sfn";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator } from "@/ui/design-system";
import { netPayEuro } from "./net-pay-format";
import {
  SalaryAmountRow,
  SalaryPremiumCard,
  SalarySectionCard,
  SalaryNavigationRow,
} from "./salary-ui";

export const SALARY_PREMIUM_CATEGORIES: readonly { category: SfnPremiumCategory; label: string }[] =
  [
    { category: "NIGHT", label: "Nacht" },
    { category: "SUNDAY", label: "Sonntag" },
    { category: "HOLIDAY", label: "Feiertag" },
    { category: "SATURDAY", label: "Samstag" },
    { category: "OTHER", label: "Weitere" },
  ];

export function NetPayPremiumExplanation({
  classification,
}: {
  readonly classification: Extract<SfnClassificationResult, { status: "available" }>;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: SPACING.sm }}>
      <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
        Die Aufteilung nutzt deine geplanten Zeiten. Nacht-, Sonn- und Feiertagszuschläge können
        steuerfrei sein. Samstagszuschläge, bezahlte Pausen und Beträge über den Grenzen bleiben
        steuerpflichtig.
      </Text>
      <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
        Sozialversicherungsfrei: {netPayEuro(classification.socialInsuranceFreeCents)}. Dafür gelten
        eigene Höchstgrenzen.
      </Text>
    </View>
  );
}

export function NetPayPremiumDetails({
  classification,
  onServices,
  onBasis,
  compact = false,
}: {
  readonly classification: Extract<SfnClassificationResult, { status: "available" }>;
  readonly onServices?: () => void;
  readonly onBasis?: () => void;
  readonly compact?: boolean;
}) {
  const palette = usePalette();
  const rows = SALARY_PREMIUM_CATEGORIES.map(({ category, label }) => {
    const items = classification.shifts
      .flatMap((shift) => shift.premiumBreakdown)
      .filter((row) => row.category === category);
    return {
      category,
      label,
      paid: items.reduce((sum, row) => sum + row.paidPremiumCents, 0),
      free: items.reduce((sum, row) => sum + row.taxFreeCents, 0),
    };
  });
  const relevant = rows.filter((row) => row.paid > 0);
  return (
    <View style={{ gap: SPACING.lg }}>
      {!compact ? (
        <SalaryPremiumCard
          totalCents={classification.paidPremiumCents}
          taxFreeCents={classification.taxFreeCents}
        />
      ) : null}
      <SalarySectionCard title="Aufteilung">
        {relevant.length === 0 ? (
          <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted, padding: SPACING.lg }}>
            Keine Zeitzuschläge in diesem Monat.
          </Text>
        ) : (
          relevant.map((row, index) => (
            <View key={row.category}>
              {index ? <CardSeparator /> : null}
              <SalaryAmountRow
                quiet
                label={row.label}
                value={netPayEuro(row.paid)}
                subtitle={[
                  row.free > 0 ? `Steuerfrei ${netPayEuro(row.free)}` : null,
                  row.paid - row.free > 0
                    ? `Steuerpflichtig ${netPayEuro(row.paid - row.free)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </View>
          ))
        )}
      </SalarySectionCard>
      <SalarySectionCard title="Sozialversicherung">
        <SalaryAmountRow
          quiet
          label="Sozialversicherungsfrei"
          value={netPayEuro(classification.socialInsuranceFreeCents)}
        />
        <CardSeparator />
        <SalaryAmountRow
          quiet
          label="Beitragspflichtige Zuschläge"
          value={netPayEuro(
            classification.paidPremiumCents - classification.socialInsuranceFreeCents,
          )}
        />
      </SalarySectionCard>
      {onServices || onBasis ? (
        <SalarySectionCard title="Details">
          {onServices ? (
            <SalaryNavigationRow title="Zuschläge je Dienst" onPress={onServices} />
          ) : null}
          {onServices && onBasis ? <CardSeparator /> : null}
          {onBasis ? (
            <SalaryNavigationRow title="Berechnung der Zuschläge" onPress={onBasis} />
          ) : null}
        </SalarySectionCard>
      ) : null}
      {!onBasis ? <NetPayPremiumExplanation classification={classification} /> : null}
      <Text style={{ ...TYPOGRAPHY.footnote, color: palette.textMuted }}>
        Ohne Zuschläge:{" "}
        {rows
          .filter((row) => row.paid === 0)
          .map((row) => row.label)
          .join(", ") || "keine weiteren Arten"}
        .
      </Text>
    </View>
  );
}
