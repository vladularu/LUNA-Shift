import { Text } from "@/ui/text";
import { WorktimeCard } from "./analysis-report-cards";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import type { AnalysisCardId } from "@/domain/analysis-view";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
import { REPORT_CARD_GAP, SPACING } from "@/theme/tokens";
import { AnalysisListCard, AnalysisValueRow } from "./analysis-list-card";
import { useAnalysisView } from "./analysis-view-preferences";
import { type CheckCounts, type ClassifiedCheckCounts } from "./check-visibility";
import { formatEuro } from "./salary-summary-card";

export function AnalysisDashboard({
  cards,
}: {
  readonly cards: Record<AnalysisCardId, ReactNode>;
}) {
  const { preferences } = useAnalysisView();
  const p = usePalette();
  const shown = preferences.order.filter((id) => !preferences.hidden.includes(id));
  return shown.length ? (
    <View style={{ gap: REPORT_CARD_GAP }}>
      {shown.map((id) => (
        <View key={id}>{cards[id]}</View>
      ))}
    </View>
  ) : (
    <Text style={{ color: p.textMuted, ...TYPOGRAPHY.body }}>
      Deine Karten sind ausgeblendet. Über „Ansicht anpassen“ kannst du sie wieder anzeigen.
    </Text>
  );
}
export function WorkListCard({
  actual,
  target,
  balance,
  onPress,
  caption,
}: {
  readonly actual: string;
  readonly target: string;
  readonly balance: string;
  readonly onPress?: () => void;
  readonly caption?: string;
}) {
  const p = usePalette();
  const withoutUnit = (value: string) => value.replace(/ h$/u, "");
  return (
    <WorktimeCard
      actual={withoutUnit(actual)}
      target={withoutUnit(target)}
      balance={withoutUnit(balance)}
      balanceAccent={
        /[0-9]/u.test(balance)
          ? /^[−-]/u.test(balance)
            ? p.danger
            : /^\+/u.test(balance)
              ? p.positiveBalance
              : p.success
          : p.textMuted
      }
      onPress={onPress}
      caption={caption}
    />
  );
}

export function checkCountLabel(counts: CheckCounts) {
  return (
    [
      counts.criticalCount ? counts.criticalCount + " kritisch" : "",
      counts.warningCount
        ? counts.warningCount + (counts.warningCount === 1 ? " Warnung" : " Warnungen")
        : "",
      counts.infoCount
        ? counts.infoCount + (counts.infoCount === 1 ? " Hinweis" : " Hinweise")
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || (counts.prerequisiteCount ? "Prüfung eingeschränkt" : "Keine Auffälligkeiten")
  );
}
function CheckRow({
  label,
  counts,
  first,
  minimumHeight,
}: {
  readonly label: string;
  readonly counts: CheckCounts;
  readonly first?: boolean;
  readonly minimumHeight?: number;
}) {
  const p = usePalette();
  const total = counts.criticalCount + counts.warningCount + counts.infoCount;
  return (
    <AnalysisValueRow
      minimumHeight={minimumHeight}
      label={label}
      first={first}
      value={checkCountLabel(counts)}
      icon={
        counts.criticalCount || counts.warningCount
          ? "warning-outline"
          : total || counts.prerequisiteCount
            ? "information-circle-outline"
            : "checkmark-circle-outline"
      }
      iconColor={
        counts.criticalCount
          ? p.danger
          : counts.warningCount
            ? p.warning
            : total || counts.prerequisiteCount
              ? p.info
              : p.success
      }
    />
  );
}
export function CheckListCard({
  counts,
  categories,
  showPlanning,
  onPress,
  status,
  caption,
  loading = false,
  reserveLoadingSpace = false,
}: {
  readonly counts: CheckCounts;
  readonly categories?: ClassifiedCheckCounts;
  readonly showPlanning: boolean;
  readonly onPress: () => void;
  readonly status?: string;
  readonly caption?: string;
  readonly loading?: boolean;
  readonly reserveLoadingSpace?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const rowHeight = reserveLoadingSpace
    ? (fontScale >= 1.3 ? 4 : 2) * (TYPOGRAPHY.body.lineHeight ?? 22) * fontScale +
      2 * (SPACING.sm + SPACING.xxs) +
      1 +
      (fontScale >= 1.3 ? SPACING.sm : 0)
    : undefined;
  const total = counts.criticalCount + counts.warningCount + counts.infoCount;
  const label =
    status ??
    (total
      ? total + (total === 1 ? " Meldung" : " Meldungen")
      : counts.prerequisiteCount
        ? "Prüfung eingeschränkt"
        : "Keine sichtbaren Auffälligkeiten");
  return (
    <AnalysisListCard
      title="Prüfung"
      label={"Prüfung, " + label}
      onPress={onPress}
      caption={caption}
      busy={loading}
    >
      {loading ? (
        <>
          <AnalysisValueRow
            minimumHeight={rowHeight}
            first
            label="Gesetzliche Prüfung"
            value="Wird geprüft …"
          />
          {showPlanning ? (
            <AnalysisValueRow
              minimumHeight={rowHeight}
              label="Planungshinweise"
              value="Wird geprüft …"
            />
          ) : null}
        </>
      ) : status ? (
        <AnalysisValueRow first label="Status" value={status} />
      ) : categories ? (
        <>
          <CheckRow
            minimumHeight={rowHeight}
            first
            label="Gesetzliche Prüfung"
            counts={categories.legal}
          />
          {categories.legal.prerequisiteCount ? (
            <AnalysisValueRow
              label="Prüfgrundlage"
              value="Angaben ergänzen"
              icon="information-circle-outline"
            />
          ) : null}
          {showPlanning ? (
            <CheckRow
              minimumHeight={rowHeight}
              label="Planungshinweise"
              counts={categories.planning}
            />
          ) : null}
        </>
      ) : (
        <CheckRow first label="Meldungen" counts={counts} />
      )}
    </AnalysisListCard>
  );
}
export function PayListCard({
  onPress,
  base,
  premiums,
  overtime,
  allowances,
  gross,
  manual = false,
  status,
  caption,
  netRow,
  annualPayments,
  annualPaymentPresent = false,
  annualPaymentExpected = false,
  loading = false,
  reserveLoadingSpace = false,
}: {
  readonly onPress: () => void;
  readonly base?: number | null;
  readonly premiums?: number;
  readonly overtime?: number;
  readonly allowances?: number;
  readonly gross?: number | null;
  readonly manual?: boolean;
  readonly status?: string;
  readonly caption: string;
  readonly netRow?: ReactNode;
  readonly annualPayments?: number;
  readonly annualPaymentPresent?: boolean;
  readonly annualPaymentExpected?: boolean;
  readonly loading?: boolean;
  readonly reserveLoadingSpace?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const hasAnnualRow = !!annualPayments || annualPaymentPresent || annualPaymentExpected;
  const annualRow = hasAnnualRow ? (
    <AnalysisValueRow
      reserveDisclosure
      label="Jahressonderzahlung"
      value={
        annualPaymentPresent || !!annualPayments
          ? formatEuro(annualPayments ?? 0)
          : loading
            ? "—"
            : "Nicht hinterlegt"
      }
    />
  ) : null;
  const rows =
    1 +
    (netRow ? 1 : 0) +
    (hasAnnualRow ? 1 : 0) +
    (manual
      ? hasAnnualRow && base != null
        ? 1
        : 0
      : (base != null ? 1 : 0) +
        (premiums != null ? 1 : 0) +
        (overtime ? 1 : 0) +
        (allowances ? 1 : 0));
  return (
    <AnalysisListCard
      title="Gehalt"
      label={"Gehalt, " + (status ?? (loading ? "Wird berechnet …" : formatEuro(gross ?? null)))}
      onPress={onPress}
      caption={caption}
      captionBelowFooter
      busy={loading}
      bodyMinHeight={
        !reserveLoadingSpace || status || fontScale > 1.2
          ? undefined
          : rows * 47 + (hasAnnualRow && netRow ? 32 : 0)
      }
    >
      {status ? (
        <AnalysisValueRow reserveDisclosure first label="Status" value={status} />
      ) : manual ? (
        <>
          {hasAnnualRow && base != null ? (
            <AnalysisValueRow
              reserveDisclosure
              first
              label="Monatsbrutto"
              value={formatEuro(base)}
            />
          ) : null}
          {annualRow}
          <AnalysisValueRow
            reserveDisclosure
            first
            total
            label="Brutto geschätzt"
            value={loading ? "Wird berechnet …" : formatEuro(gross ?? null)}
          />
        </>
      ) : (
        <>
          {base != null ? (
            <AnalysisValueRow
              reserveDisclosure
              first
              label={manual ? "Monatsbrutto" : "Grundgehalt"}
              value={formatEuro(base)}
            />
          ) : null}
          {!manual && premiums != null ? (
            <AnalysisValueRow
              reserveDisclosure
              first={base == null}
              label="Zeitzuschläge"
              value={formatEuro(premiums)}
            />
          ) : null}
          {!manual && !!overtime ? (
            <AnalysisValueRow
              reserveDisclosure
              label="Überstundenvergütung"
              value={formatEuro(overtime)}
            />
          ) : null}
          {!manual && !!allowances ? (
            <AnalysisValueRow
              reserveDisclosure
              label="Weitere Zulagen"
              value={formatEuro(allowances)}
            />
          ) : null}
          {annualRow}
          <AnalysisValueRow
            reserveDisclosure
            first={base == null && premiums == null}
            total
            label="Brutto geschätzt"
            value={loading ? "Wird berechnet …" : formatEuro(gross ?? null)}
          />
        </>
      )}
      {netRow}
    </AnalysisListCard>
  );
}
