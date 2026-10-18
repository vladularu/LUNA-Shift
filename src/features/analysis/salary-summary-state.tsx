import { Text } from "@/ui/text";
import { View } from "react-native";

import type { MonthlyPayEstimate } from "@/domain/types";
import type { RuleResolutionFailure } from "@/rules/rule-resolver";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { SPACING } from "@/theme/tokens";

export function formatEuro(value: number | null): string {
  if (value === null) return "–";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

export function salarySummaryPresentation(
  pay: MonthlyPayEstimate | null,
  salaryReady: boolean,
  ruleFailure: RuleResolutionFailure | null | undefined,
): { readonly value: string; readonly visibleSummary: string | undefined } {
  if (!salaryReady) return { value: "Einrichten", visibleSummary: "Gehaltsgrundlage fehlt" };
  if (pay === null) {
    return {
      value: "Nicht verfügbar",
      visibleSummary:
        ruleFailure?.kind === "HOLIDAY"
          ? "Feiertagsdaten für Zuschläge fehlen"
          : "Für diesen Zeitraum fehlen geprüfte Tarifdaten",
    };
  }
  if (!pay.available) {
    return {
      value: "Nicht verfügbar",
      visibleSummary: "Für diesen Monat fehlen Tarifdaten",
    };
  }
  return { value: formatEuro(pay.estimatedGrossAmount), visibleSummary: undefined };
}

export function SalaryRuleUnavailableContent({
  ruleFailure,
}: {
  readonly ruleFailure: RuleResolutionFailure | null | undefined;
}) {
  const palette = usePalette();
  return (
    <View style={{ padding: SPACING.lg }}>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}
      >
        {ruleFailure?.kind === "HOLIDAY"
          ? "Die Arbeitszeit bleibt sichtbar. Feiertagsabhängige Zuschläge sind noch offen."
          : "Die Arbeitszeit bleibt sichtbar. Für die Gehaltsberechnung fehlen geprüfte Tarifdaten."}
      </Text>
    </View>
  );
}
