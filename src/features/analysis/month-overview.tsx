import { router } from "expo-router";
import type { MonthlyComplianceResult, UserProfile } from "@/domain/types";
import { formatMinutes } from "@/engine/working-time";
import { classifyChecks, selectVisibleCompliance } from "./check-visibility";
import type { MonthlyAnalysisCalculation } from "./monthly-analysis";
import { complianceDetailsRoute, salaryRoute } from "@/navigation/routes";
import { AnalysisDashboard, CheckListCard, PayListCard, WorkListCard } from "./dashboard-cards";
import { ShiftAnalysisCard } from "./shift-analysis-card";
import { AnalysisNetPayRow } from "./analysis-net-pay-row";
import { annualSalaryGrossCents, type AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import type { ReactNode } from "react";
import {
  timeAccountActual,
  timeAccountBalance,
  timeAccountCaption,
} from "./special-duty-time-presentation";
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
  const estimate = pay.ok && pay.value.available ? pay.value : null;
  const annualGross = annualSalaryGrossCents(month, annualPayments) / 100;
  return (
    <AnalysisDashboard
      cards={{
        WORK: (
          <WorkListCard
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
                    : summary.value.targetCalculation?.status === "PROVISIONAL"
                      ? "Sollzeit vorläufig · Tippe für die Berechnung"
                      : undefined))
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
        PAY: (
          <PayListCard
            reserveLoadingSpace
            onPress={() => router.push(salaryRoute(month))}
            status={
              !salaryReady
                ? "Gehalt einrichten"
                : salaryError || !estimate
                  ? "Nicht verfügbar"
                  : undefined
            }
            loading={salaryLoading && estimate !== null && !salaryError}
            base={estimate?.personalBaseAmount}
            premiums={estimate?.timePremiumAmount}
            overtime={estimate?.overtimeAmount}
            allowances={
              estimate
                ? estimate.allowanceAmount +
                  estimate.tvoedAllowanceAmount +
                  estimate.careAllowanceAmount
                : undefined
            }
            gross={
              estimate?.estimatedGrossAmount == null
                ? undefined
                : Math.round(estimate.estimatedGrossAmount * 100 + annualGross * 100) / 100
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
                  : manualSalary
                    ? "Manuell hinterlegtes Monatsbrutto"
                    : "Unverbindliche Schätzung"
            }
          />
        ),
        SHIFTS: (
          <ShiftAnalysisCard
            analysis={shiftTypeAnalysis}
            caption={summary.ok ? undefined : "Stunden ohne Abwesenheitsgutschriften."}
          />
        ),
      }}
    />
  );
}
