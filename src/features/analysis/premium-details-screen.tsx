import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";

import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { employmentProfileAt } from "@/domain/employment-history";
import { formatMonthTitle } from "@/engine/calendar";
import { prepareAutomaticNetPay } from "@/features/salary/automatic-net-pay-preparation";
import { NetPayServiceDetails } from "@/features/salary/net-pay-service-details";
import { NetPayText } from "@/features/salary/net-pay-controls";
import { salaryMonthInput } from "@/features/salary/salary-month-input";
import { SalaryPage } from "@/features/salary/salary-ui";
import { useNetPayProfile } from "@/features/salary/use-net-pay-profile";
import {
  captureRuleComputation,
  RuleComputationNotice,
} from "@/features/analysis/rule-computation";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { useReportMonth } from "@/navigation/use-report-month";
import { EmptyState } from "@/ui/design-system";

export function PremiumDetailsScreen() {
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const { error, ready, reload } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver } = useRuleCatalogRuntime();
  const [ruleRetryRevision, setRuleRetryRevision] = useState(0);
  const parsedMonth = parseMonthRouteParam(params.month);
  const { month } = useReportMonth(parsedMonth.status === "valid" ? parsedMonth.value : null);
  const valid = parsedMonth.status === "valid";
  const blocked = testMonths.includes(month);
  const enabled = valid && ready && !error && profile !== null && !blocked;
  const data = useNetPayProfile(month, enabled);
  const settings = data.saved?.settings ?? null;
  const context = useMemo(
    () => ({ entries, tariffDecisions, workPatternSettings, resolver, testMonths }),
    [entries, tariffDecisions, workPatternSettings, resolver, testMonths],
  );
  const calculation = useMemo(() => {
    void ruleRetryRevision;
    if (!valid || !ready || error || profile === null) return null;
    return captureRuleComputation(() => ({
      ...salaryMonthInput(month, profile, context),
      profile: employmentProfileAt(profile, `${month}-01`),
    }));
  }, [context, error, month, profile, ready, ruleRetryRevision, valid]);
  const classification = useMemo(() => {
    if (
      !enabled ||
      !profile ||
      !calculation?.ok ||
      !calculation.value.pay.available ||
      data.status !== "ready" ||
      settings?.version !== 2
    )
      return null;
    // Keep original service dates and ignore payment preferences on this earned-month page.
    const forecast = prepareAutomaticNetPay(month, settings, profile, context);
    return forecast.result.status === "available" ? forecast.result.classification : null;
  }, [calculation, context, data.status, enabled, month, profile, settings]);
  const page = (content: ReactNode) => (
    <SalaryPage
      title="Zuschläge je Dienst"
      month={valid ? formatMonthTitle(month) : undefined}
      backLabel="Zurück zur Auswertung"
    >
      {content}
    </SalaryPage>
  );

  if (parsedMonth.status !== "valid") {
    return page(
      <LoadFailureView
        actionLabel="Schließen"
        message="Der Link zu den Zuschlagsdetails enthält keinen gültigen Monat."
        onRetry={() => router.back()}
        title="Zuschlagsdetails können nicht geöffnet werden"
      />,
    );
  }
  if (ready && error) {
    return page(<LoadFailureView message={error} onRetry={() => void reload()} />);
  }
  if (calculation !== null && !calculation.ok) {
    return page(
      <RuleComputationNotice
        failure={calculation}
        onRetry={() => setRuleRetryRevision((value) => value + 1)}
        title="Zuschlagsdetails nicht verfügbar"
      />,
    );
  }
  if (!ready || profile === null || calculation === null) return page(<LoadingView />);

  const { shifts, pay, profile: sourceProfile } = calculation.value;
  if (
    !sourceProfile.tariff &&
    !sourceProfile.nursingTrainingTariff &&
    !sourceProfile.vkaETariff &&
    !sourceProfile.tvlKrTariff &&
    !sourceProfile.tvUkNursingTariff &&
    !sourceProfile.tvhKrTariff &&
    !sourceProfile.tvalPflegeTariff
  )
    return page(
      <EmptyState
        title="Keine tarifliche Berechnung"
        message="Für manuell hinterlegtes Gehalt werden keine Zeitzuschläge berechnet."
      />,
    );
  if (!pay.available) {
    return page(
      <EmptyState
        message="Für diesen Zeitraum fehlen geprüfte Tarifdaten."
        title="Nicht verfügbar"
      />,
    );
  }
  return page(
    <>
      <NetPayServiceDetails
        key={month}
        classification={classification}
        pay={pay}
        shifts={shifts}
        includeSpecialDutyPay
      >
        {blocked ? (
          <NetPayText>Für Testdaten wird keine steuerliche Aufteilung berechnet.</NetPayText>
        ) : data.status === "error" ? (
          <NetPayText>
            Die Angaben für die steuerliche Aufteilung konnten nicht geladen werden.
          </NetPayText>
        ) : null}
      </NetPayServiceDetails>
      {(pay.nightCompensatoryMinutes ?? 0) > 0 ? (
        <NetPayText>
          Zusätzlich{" "}
          {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(
            pay.nightCompensatoryMinutes!,
          )}{" "}
          Min. Freizeitausgleich für Nachtarbeit.
        </NetPayText>
      ) : null}
    </>,
  );
}
