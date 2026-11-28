import { router } from "expo-router";
import { formatMonthTitle } from "@/engine/calendar";
import { premiumDetailsRoute } from "@/navigation/routes";
import { AnalysisListCard, AnalysisValueRow } from "./analysis-list-card";
import { formatEuro } from "./salary-summary-card";

export function EarnedPremiumsCard({
  month,
  amount,
  specialDutyAmount = 0,
  absenceAmount,
  absencePending = false,
  status,
}: {
  readonly month: string;
  readonly amount: number | null;
  readonly specialDutyAmount?: number;
  readonly absenceAmount?: number;
  readonly absencePending?: boolean;
  readonly status?: string;
}) {
  const absenceValue = absencePending
    ? absenceAmount
      ? formatEuro(absenceAmount) + " · teilweise offen"
      : "Noch offen"
    : formatEuro(absenceAmount ?? 0);
  return (
    <AnalysisListCard
      title="Zuschläge erarbeitet"
      label={`Zuschläge erarbeitet, ${status ?? formatEuro(amount === null ? null : amount + specialDutyAmount + (absenceAmount ?? 0))}${absencePending ? ", U/K-Aufschlag noch offen" : ""}`}
      onPress={() => router.push(premiumDetailsRoute(month))}
      caption={`Erarbeitet im ${formatMonthTitle(month)}`}
    >
      <AnalysisValueRow
        first
        label={status ? "Status" : "Zeitzuschläge · brutto"}
        value={status ?? formatEuro(amount)}
      />
      {(absenceAmount !== undefined || absencePending) && (
        <AnalysisValueRow label="U/K-Aufschlag · brutto" value={absenceValue} />
      )}
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
