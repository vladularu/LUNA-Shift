import { router } from "expo-router";
import { formatMonthTitle } from "@/engine/calendar";
import { premiumDetailsRoute } from "@/navigation/routes";
import { AnalysisListCard, AnalysisValueRow } from "./analysis-list-card";
import { formatEuro } from "./salary-summary-card";

export function EarnedPremiumsCard({
  month,
  amount,
  specialDutyAmount = 0,
  status,
}: {
  readonly month: string;
  readonly amount: number | null;
  readonly specialDutyAmount?: number;
  readonly status?: string;
}) {
  return (
    <AnalysisListCard
      title="Zuschläge erarbeitet"
      label={`Zuschläge erarbeitet, ${status ?? formatEuro(amount === null ? null : amount + specialDutyAmount)}`}
      onPress={() => router.push(premiumDetailsRoute(month))}
      caption={`Für Dienste im ${formatMonthTitle(month)}`}
    >
      <AnalysisValueRow
        first
        label={status ? "Status" : "Zeitzuschläge · brutto"}
        value={status ?? formatEuro(amount)}
      />
      {!status && specialDutyAmount > 0 ? (
        <AnalysisValueRow
          total
          label="Bereitschaftsvergütung · brutto"
          value={formatEuro(specialDutyAmount)}
        />
      ) : null}
    </AnalysisListCard>
  );
}
