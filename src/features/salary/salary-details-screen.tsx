import { router, useLocalSearchParams } from "expo-router";
import { Temporal } from "@js-temporal/polyfill";
import { Text } from "@/ui/text";
import { View } from "react-native";
import { formatMonthTitle } from "@/engine/calendar";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { useActiveMonthCoordinator } from "@/navigation/active-month";
import { salaryDetailsRoute, type SalaryDetailSection } from "@/navigation/routes";
import { CardSeparator, SurfaceCard } from "@/ui/design-system";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { RuleComputationNotice } from "@/features/analysis/rule-computation";
import { buildPremiumBreakdown } from "@/features/analysis/premium-breakdown";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { useSalaryReport } from "./use-salary-report";
import { useNetPayProfile } from "./use-net-pay-profile";
import { useAutomaticNetPay } from "./use-automatic-net-pay";
import {
  SalaryPage,
  SalaryAmountRow,
  SalaryPremiumCard,
  SalaryMonthNavigator,
  SalarySectionCard,
  SalaryNavigationRow,
} from "./salary-ui";
import { selectionFeedback } from "@/ui/haptics";
import { SalaryComponentsView, SalaryBasisView } from "./salary-detail-views";
import { NetPayDeductionDetails } from "./net-pay-salary-summary";
import { NetPayPremiumDetails } from "./net-pay-premium-details";
import { NetPayServiceDetails } from "./net-pay-service-details";
import { netPayEuro, netPayForecastLabel } from "./net-pay-format";
import { SecondaryButton } from "@/ui/form-controls";
import { FormStatus } from "@/ui/form-layout";

export const SALARY_DETAIL_TITLES: Readonly<Record<SalaryDetailSection, string>> = {
  components: "Gehaltsbestandteile",
  deductions: "Abzüge",
  premiums: "Zeitzuschläge",
  services: "Zuschläge je Dienst",
  basis: "Berechnungsgrundlagen",
};

export function SalaryDetailsScreen() {
  const coordinator = useActiveMonthCoordinator();
  const params = useLocalSearchParams<{ month?: RouteParam; section?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const section =
    typeof params.section === "string" && Object.hasOwn(SALARY_DETAIL_TITLES, params.section)
      ? (params.section as SalaryDetailSection)
      : null;
  const valid = parsed.status === "valid" && section !== null;
  const month = parsed.status === "valid" ? parsed.value : "1970-01";
  const report = useSalaryReport(month, valid);
  const blocked = report.testMonths.includes(month);
  const data = useNetPayProfile(month, valid && !blocked);
  const settings = data.saved?.settings ?? null;
  const forecast = useAutomaticNetPay(
    month,
    settings,
    valid && !blocked && data.status === "ready" && settings?.version === 2,
  );
  const available = forecast?.result.status === "available" ? forecast.result : null;
  const palette = usePalette();
  if (!valid || !section)
    return (
      <SalaryPage title="Gehalt">
        <LoadFailureView
          title="Gehaltsdetails können nicht geöffnet werden"
          message="Der Link enthält keinen gültigen Monat oder Bereich."
          actionLabel="Schließen"
          onRetry={() => router.back()}
        />
      </SalaryPage>
    );
  const heading = SALARY_DETAIL_TITLES[section];
  const caption = formatMonthTitle(month);
  const pageProps = {
    title: heading,
    month: section === "components" ? undefined : caption,
  };
  function moveMonth(delta: number) {
    const next = Temporal.PlainDate.from(`${month}-01`)
      .add({ months: delta })
      .toString()
      .slice(0, 7);
    coordinator.setMonth(next);
    router.setParams({ month: next });
    selectionFeedback();
  }
  const navigation =
    section === "components" ? (
      <SalaryMonthNavigator
        label={caption}
        onPrevious={() => moveMonth(-1)}
        onNext={() => moveMonth(1)}
      />
    ) : null;
  if (report.ready && report.error)
    return (
      <SalaryPage {...pageProps}>
        {navigation}
        <LoadFailureView message={report.error} onRetry={() => void report.reload()} />
      </SalaryPage>
    );
  if (report.calculation !== null && !report.calculation.ok)
    return (
      <SalaryPage {...pageProps}>
        {navigation}
        <RuleComputationNotice
          failure={report.calculation}
          title="Gehaltsdetails nicht verfügbar"
          onRetry={report.retryRules}
        />
      </SalaryPage>
    );
  if (!report.ready || !report.profile || !report.calculation)
    return (
      <SalaryPage {...pageProps}>
        {navigation}
        <LoadingView />
      </SalaryPage>
    );
  const { pay, monthShifts } = report.calculation.value;
  const unavailable = (
    <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.sm }}>
      <Text style={{ ...TYPOGRAPHY.bodyStrong, color: palette.text }}>
        Netto-Aufteilung nicht verfügbar
      </Text>
      <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
        {blocked
          ? "In einem aktiven Testmonat ist die persönliche Netto-Prognose gesperrt."
          : forecast?.result.status === "unavailable"
            ? forecast.result.reason
            : data.status === "loading"
              ? "Netto-Angaben werden geladen …"
              : "Richte deine Netto-Angaben in der Gehaltsübersicht ein."}
      </Text>
      {data.status === "error" ? (
        <>
          <FormStatus error={data.error} />
          <SecondaryButton onPress={data.reload}>Erneut laden</SecondaryButton>
        </>
      ) : null}
    </SurfaceCard>
  );
  const basis = () => router.push(salaryDetailsRoute(month, "basis"));
  let content;
  if (section === "components")
    content = (
      <SalaryComponentsView
        month={month}
        profile={report.profile}
        pay={pay}
        net={available?.pay ?? null}
        settings={settings}
        pensionOmitted={forecast?.pensionOmitted ?? false}
      />
    );
  else if (section === "deductions")
    content = available ? (
      <NetPayDeductionDetails
        pay={available.pay}
        month={month}
        pensionOmitted={forecast?.pensionOmitted ?? false}
      />
    ) : (
      unavailable
    );
  else if (section === "basis")
    content = (
      <SalaryBasisView
        net={available?.pay ?? null}
        classification={available?.classification ?? null}
        pensionOmitted={forecast?.pensionOmitted ?? false}
        nightMinutes={pay.nightCompensatoryMinutes ?? 0}
      />
    );
  else if (!pay.available)
    content = (
      <SurfaceCard style={{ padding: SPACING.lg }}>
        <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>
          Für diesen Zeitraum liegt kein unterstützter Tarifstand vor.
        </Text>
      </SurfaceCard>
    );
  else if (section === "services")
    content = (
      <>
        <SalaryPremiumCard
          totalCents={
            available?.classification.paidPremiumCents ?? Math.round(pay.timePremiumAmount * 100)
          }
          taxFreeCents={available?.classification.taxFreeCents ?? null}
        />
        <NetPayServiceDetails
          key={month}
          classification={available?.classification ?? null}
          pay={pay}
          shifts={monthShifts}
        />
        {(pay.nightCompensatoryMinutes ?? 0) > 0 ? (
          <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
            Zusätzlich{" "}
            {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(
              pay.nightCompensatoryMinutes!,
            )}{" "}
            Min. Freizeitausgleich für Nachtarbeit.
          </Text>
        ) : null}
      </>
    );
  else if (available)
    content = (
      <NetPayPremiumDetails
        classification={available.classification}
        onServices={() => router.push(salaryDetailsRoute(month, "services"))}
        onBasis={basis}
      />
    );
  else {
    const categories = buildPremiumBreakdown(
      pay.shiftBreakdowns,
      monthShifts,
      null,
    ).categories.filter((row) => row.amount > 0);
    content = (
      <>
        <SalaryPremiumCard
          totalCents={Math.round(pay.timePremiumAmount * 100)}
          taxFreeCents={null}
        />
        <SalarySectionCard title="Aufteilung">
          {categories.map((row, index) => (
            <View key={row.key}>
              {index ? <CardSeparator /> : null}
              <SalaryAmountRow
                label={row.label}
                value={netPayEuro(Math.round(row.amount * 100))}
                quiet
              />
            </View>
          ))}
          {!categories.length ? (
            <Text style={{ ...TYPOGRAPHY.body, padding: SPACING.lg, color: palette.textMuted }}>
              Keine Zeitzuschläge in diesem Monat.
            </Text>
          ) : null}
        </SalarySectionCard>
        {unavailable}
        <SalarySectionCard title="Details">
          <SalaryNavigationRow title="Berechnung der Zuschläge" onPress={basis} />
        </SalarySectionCard>
      </>
    );
  }
  return (
    <SalaryPage {...pageProps}>
      {navigation}
      {available &&
      (section === "premiums" || section === "services") &&
      netPayForecastLabel(available.pay) ? (
        <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
          {netPayForecastLabel(available.pay)}
        </Text>
      ) : null}
      {content}
    </SalaryPage>
  );
}
