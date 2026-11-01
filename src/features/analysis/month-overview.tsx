import { targetCalculationCaption } from "./target-calculation-caption";
import { router } from "expo-router";
import type { MonthlyComplianceResult, UserProfile } from "@/domain/types";
import { formatMinutes } from "@/engine/working-time";
import { classifyChecks, selectVisibleCompliance } from "./check-visibility";
import type { MonthlyAnalysisCalculation } from "./monthly-analysis";
import { complianceDetailsRoute, salaryRoute } from "@/navigation/routes";
import { AnalysisDashboard, CheckListCard, PayListCard, WorkListCard } from "./dashboard-cards";
import { EarnedPremiumsCard } from "./salary-overview-cards";
import { ShiftAnalysisCard } from "./shift-analysis-card";
import { AnalysisNetPayRow } from "./analysis-net-pay-row";
import { annualSalaryGrossCents, type AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import type { ReactNode } from "react";
import {
  timeAccountActual,
  timeAccountBalance,
  timeAccountCaption,
} from "./special-duty-time-presentation";
import type { SalaryPaymentProjection } from "@/domain/salary-payment";
import { salaryPaymentHint } from "@/features/salary/salary-composition";
import { annualPayoutMonths, salaryAnnualFamily } from "@/domain/salary-annual-schedule";

export function MonthOverview({
  month,
  data,
  profile,
  compliance,
  checkError,
  showPlanning,
  annualPayments,
  salaryLoading = false,
  salaryError,
  netPay,
  projection,
  projectionPending = false,
  additionalRecurringGrossCents = 0,
}: {
  readonly month: string;
  readonly data: MonthlyAnalysisCalculation;
  readonly profile: UserProfile;
  readonly compliance: MonthlyComplianceResult | null;
  readonly checkError: string | null;
  readonly showPlanning: boolean;
  readonly annualPayments?: readonly AnnualSalaryPayment[];
  readonly salaryLoading?: boolean;
  readonly salaryError?: string | null;
  readonly netPay?: ReactNode;
  readonly projection?: SalaryPaymentProjection;
  readonly projectionPending?: boolean;
  readonly additionalRecurringGrossCents?: number;
}) {
  const { summary, pay, shiftTypeAnalysis } = data;
  const visible = compliance === null ? null : selectVisibleCompliance(compliance, showPlanning);
  const emptyMonth = data.monthShifts.length === 0;
  const emptyHorizon = data.complianceShifts.ok && data.complianceShifts.value.length === 0;
  const noFindings =
    visible !== null &&
    visible.criticalCount +
      visible.warningCount +
      visible.infoCount +
      (visible.prerequisiteCount ?? 0) ===
      0;
  const status =
    !data.complianceShifts.ok || checkError
      ? "Nicht verfügbar"
      : emptyMonth && (noFindings || (emptyHorizon && !visible))
        ? "Keine Dienste eingetragen"
        : !visible
          ? "Wird geprüft …"
          : undefined;
  const manualSalary =
    profile.tariff === null &&
    profile.nursingTrainingTariff == null &&
    profile.vkaETariff == null &&
    profile.tvlKrTariff == null &&
    profile.tvUkNursingTariff == null &&
    profile.tvhKrTariff == null &&
    profile.tvalPflegeTariff == null &&
    profile.manualMonthlyGrossCents != null;
  const salaryReady =
    profile.tariff !== null ||
    profile.nursingTrainingTariff != null ||
    profile.vkaETariff != null ||
    profile.tvlKrTariff != null ||
    profile.tvUkNursingTariff != null ||
    profile.tvhKrTariff != null ||
    profile.tvalPflegeTariff != null ||
    profile.manualMonthlyGrossCents != null;
  const estimate = projectionPending
    ? null
    : projection
      ? projection.pay.available
        ? projection.pay
        : null
      : pay.ok && pay.value.available
        ? pay.value
        : null;
  const paymentHint = projection ? salaryPaymentHint(projection) : null;
  const annualGross = annualSalaryGrossCents(month, annualPayments) / 100;
  const hasAccount = summary.ok && summary.value.timeAccountMinutes !== undefined;
  return (
    <AnalysisDashboard
      cards={{
        WORK: (
          <WorkListCard
            actualLabel={hasAccount ? "Zeitkonto" : undefined}
            onPress={() =>
              router.push({
                pathname: "/working-time-profile",
                params: { origin: "analysis", month },
              })
            }
            actual={
              summary.ok
                ? timeAccountActual(summary.value) +
                  (summary.value.timeAccountMinutes === null ? "" : " h")
                : formatMinutes(shiftTypeAnalysis.totalMinutes) + " h"
            }
            target={
              summary.ok ? formatMinutes(summary.value.targetMinutes) + " h" : "Nicht verfügbar"
            }
            balance={
              summary.ok
                ? summary.value.specialDutyNotes?.length
                  ? "Noch offen"
                  : timeAccountBalance(summary.value) + " h"
                : "Nicht verfügbar"
            }
            caption={
              summary.ok
                ? (timeAccountCaption(summary.value) ??
                  (summary.value.specialDutyNotes?.length
                    ? "Bereitschaften: Zeitgutschrift noch offen"
                    : targetCalculationCaption(summary.value.targetCalculation)))
                : "Soll und Zeitgutschriften sind noch offen. Tippe für die Berechnungsgrundlagen."
            }
          />
        ),
        CHECK: (
          <CheckListCard
            reserveLoadingSpace
            counts={visible ?? { criticalCount: 0, warningCount: 0, infoCount: 0 }}
            categories={visible && compliance ? classifyChecks(compliance.issues) : undefined}
            status={status}
            loading={status === "Wird geprüft …"}
            showPlanning={showPlanning}
            onPress={() => router.push(complianceDetailsRoute(month))}
            caption={
              !data.complianceShifts.ok
                ? "Für die Prüfung fehlen Berechnungsdaten."
                : (checkError ??
                  (emptyMonth
                    ? emptyHorizon
                      ? "Bei neuen Einträgen wird die Prüfung automatisch aktualisiert."
                      : "Die Prüfung berücksichtigt auch Einflüsse anderer Monate."
                    : undefined))
            }
          />
        ),
        PREMIUM: (
          <EarnedPremiumsCard
            month={month}
            amount={pay.ok && pay.value.available ? pay.value.timePremiumAmount : null}
            specialDutyAmount={pay.ok && pay.value.available ? pay.value.specialDutyAmount : 0}
            status={
              !salaryReady
                ? "Tarif hinterlegen"
                : !pay.ok || !pay.value.available
                  ? "Nicht verfügbar"
                  : undefined
            }
          />
        ),
        PAY: (
          <PayListCard
            reserveLoadingSpace
            onPress={() => router.push(salaryRoute(month))}
            status={
              !salaryReady
                ? "Gehalt einrichten"
                : projectionPending
                  ? "Wird berechnet …"
                  : salaryError || !estimate
                    ? "Nicht verfügbar"
                    : undefined
            }
            loading={salaryLoading && estimate !== null && !salaryError}
            base={
              estimate?.personalBaseAmount == null
                ? estimate?.personalBaseAmount
                : estimate.personalBaseAmount +
                  (manualSalary ? additionalRecurringGrossCents / 100 : 0)
            }
            premiums={estimate?.timePremiumAmount}
            overtime={estimate?.overtimeAmount}
            allowances={
              estimate
                ? estimate.allowanceAmount +
                  estimate.tvoedAllowanceAmount +
                  estimate.careAllowanceAmount +
                  (estimate.specialDutyAmount ?? 0) +
                  (manualSalary ? 0 : additionalRecurringGrossCents / 100)
                : undefined
            }
            gross={
              estimate?.estimatedGrossAmount == null
                ? null
                : Math.round(
                    estimate.estimatedGrossAmount * 100 +
                      annualGross * 100 +
                      additionalRecurringGrossCents,
                  ) / 100
            }
            annualPayments={annualGross}
            annualPaymentPresent={annualPayments?.some((payment) => payment.payoutMonth === month)}
            annualPaymentExpected={annualPayoutMonths(
              salaryAnnualFamily(profile),
              Number(month.slice(0, 4)),
            ).includes(month)}
            manual={manualSalary}
            netRow={netPay ?? <AnalysisNetPayRow month={month} />}
            caption={
              salaryError
                ? salaryError
                : !salaryReady
                  ? "Tarif oder Monatsbrutto hinterlegen"
                  : paymentHint
                    ? paymentHint
                    : manualSalary
                      ? "Manuell hinterlegtes Monatsbrutto"
                      : "Unverbindliche Schätzung"
            }
          />
        ),
        SHIFTS: (
          <ShiftAnalysisCard
            analysis={shiftTypeAnalysis}
            creditsAvailable={summary.ok}
            timeCredits={summary.ok ? summary.value.specialDutyTimeCredits : undefined}
            caption={summary.ok ? undefined : "Stunden ohne Abwesenheitsgutschriften."}
          />
        ),
      }}
    />
  );
}
