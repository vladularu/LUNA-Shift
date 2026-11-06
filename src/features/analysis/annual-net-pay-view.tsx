import { View } from "react-native";
import { router } from "expo-router";
import { annualDetailsRoute } from "@/navigation/routes";
import { formatMonthTitle } from "@/engine/calendar";
import { netPayEuro } from "@/features/salary/net-pay-format";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { ReportScrollView } from "@/ui/report-layout";
import { AnalysisListCard, AnalysisValueRow } from "./analysis-list-card";
import { AnalysisDetailSummaryCard } from "./analysis-detail-layout";
import type { AnnualNetPayState } from "./use-annual-net-pay";

const loading: AnnualNetPayState = { report: null, loading: true, error: null };
function amount(cents: number | null, preliminary: boolean) {
  if (cents === null) return "Nicht verfügbar";
  return netPayEuro(preliminary ? Math.round(cents / 1000) * 1000 : cents);
}
export function AnnualNetPayCard({
  year,
  data = loading,
  detail = false,
}: {
  readonly year: number;
  readonly data?: AnnualNetPayState;
  readonly detail?: boolean;
}) {
  const palette = usePalette();
  const report = data.report;
  const count = report?.availableMonthCount ?? 0;
  return (
    <AnalysisListCard
      title="Netto"
      label="Netto"
      onPress={detail ? undefined : () => router.push(annualDetailsRoute(year, "NET"))}
      caption={
        data.error ??
        (data.loading
          ? "Netto-Prognosen werden berechnet …"
          : count
            ? `${count < 12 ? "Netto-Teilsumme" : "Netto-Schätzung"} · ${count} von 12 Monaten`
            : "Keine unterstützte Monatsprognose verfügbar")
      }
      busy={data.loading}
    >
      <AnalysisValueRow
        first
        label="Voraussichtliches Netto"
        value={
          data.loading
            ? "Wird berechnet …"
            : data.error || !report
              ? "Nicht verfügbar"
              : amount(report.netCents, report.preliminary)
        }
        total={count > 0}
      />
      {report?.notes.map((note) => (
        <Text
          key={note}
          style={{ ...TYPOGRAPHY.small, color: palette.textMuted, paddingBottom: SPACING.sm }}
        >
          {note}
        </Text>
      ))}
    </AnalysisListCard>
  );
}
export function AnnualNetPayDetails({
  year,
  data,
  onSelectMonth,
}: {
  readonly year: number;
  readonly data?: AnnualNetPayState;
  readonly onSelectMonth: (month: string) => void;
}) {
  const palette = usePalette();
  return (
    <ReportScrollView>
      <AnalysisDetailSummaryCard
        title="Netto-Prognose"
        period={String(year)}
        caption="Netto nach Auszahlungsmonaten · unverbindliche Schätzung"
      />
      <AnnualNetPayCard year={year} data={data} detail />
      {data?.report ? (
        <AnalysisListCard title="Nach Monaten">
          {data.report.months.map((month, index) => (
            <View key={month.month}>
              <AnalysisValueRow
                first={index === 0}
                label={formatMonthTitle(month.month)}
                value={
                  month.netCents === null
                    ? (month.status ?? "Nicht verfügbar")
                    : amount(month.netCents, month.preliminary)
                }
                onPress={() => onSelectMonth(month.month)}
              />
              {month.notes.map((note) => (
                <Text
                  key={note}
                  style={{
                    ...TYPOGRAPHY.small,
                    color: palette.textMuted,
                    paddingBottom: SPACING.sm,
                  }}
                >
                  {note}
                </Text>
              ))}
            </View>
          ))}
        </AnalysisListCard>
      ) : null}
    </ReportScrollView>
  );
}
