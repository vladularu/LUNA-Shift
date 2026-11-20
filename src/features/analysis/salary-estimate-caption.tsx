import { Text } from "@/ui/text";

import type { MonthlyPayEstimate } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { provisionalTariffCaption } from "@/features/salary/provisional-tariff-caption";

export function SalaryEstimateCaption({ pay }: { readonly pay: MonthlyPayEstimate }) {
  const palette = usePalette();
  const provisional = provisionalTariffCaption(pay.provisionalTariffMonths);
  return (
    <Text
      maxFontSizeMultiplier={TEXT_MAX_SCALE}
      selectable
      style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
    >
      {pay.tariffLabel}
      {provisional ? `\n${provisional}` : ""}
      {pay.confirmedAllowance === null && pay.assessment.estimateNote
        ? `\n${pay.assessment.estimateNote}`
        : ""}
    </Text>
  );
}
