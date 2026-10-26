import { router } from "expo-router";
import type { MonthlyComplianceResult, UserProfile } from "@/domain/types";
import { formatMinutes, formatSignedMinutes } from "@/engine/working-time";
import { classifyChecks, selectVisibleCompliance } from "./check-visibility";
import type { MonthlyAnalysisCalculation } from "./monthly-analysis";
import { complianceDetailsRoute, salaryRoute } from "@/navigation/routes";
import { AnalysisDashboard, CheckListCard, PayListCard, WorkListCard } from "./dashboard-cards";
import { ShiftAnalysisCard } from "./shift-analysis-card";
import { AnalysisNetPayRow } from "./analysis-net-pay-row";
import { annualSalaryGrossCents, type AnnualSalaryPayment } from "@/domain/annual-salary-payment";

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
}) {
  const { summary, pay, shiftTypeAnalysis } = data;
  const visible = compliance === null ? null : selectVisibleCompliance(compliance, showPlanning);
  const status =
    !data.complianceShifts.ok || checkError
      ? "Nicht verfügbar"
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
              formatMinutes(
                summary.ok ? summary.value.actualMinutes : shiftTypeAnalysis.totalMinutes,
              ) + " h"
            }
            target={
              summary.ok ? formatMinutes(summary.value.targetMinutes) + " h" : "Nicht verfügbar"
            }
            balance={
              summary.ok
                ? formatSignedMinutes(summary.value.balanceMinutes) + " h"
                : "Nicht verfügbar"
            }
            caption={
              summary.ok
                ? summary.value.targetCalculation?.status === "PROVISIONAL"
                  ? "Sollzeit vorläufig · Tippe für die Berechnung"
                  : undefined
                : "Soll und Zeitgutschriften sind noch offen. Tippe für die Berechnungsgrundlagen."
            }
          />
        ),
        CHECK: (
          <CheckListCard
            counts={visible ?? { criticalCount: 0, warningCount: 0, infoCount: 0 }}
            categories={visible && compliance ? classifyChecks(compliance.issues) : undefined}
            status={status}
            showPlanning={showPlanning}
            onPress={() => router.push(complianceDetailsRoute(month))}
            caption={
              !data.complianceShifts.ok
                ? "Für die Prüfung fehlen Berechnungsdaten."
                : (checkError ?? undefined)
            }
          />
        ),
        PAY: (
          <PayListCard
            onPress={() => router.push(salaryRoute(month))}
            status={
              !salaryReady
                ? "Gehalt einrichten"
                : salaryLoading
                  ? "Wird berechnet …"
                  : salaryError || !estimate
                    ? "Nicht verfügbar"
                    : undefined
            }
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
            manual={manualSalary}
            netRow={<AnalysisNetPayRow month={month} />}
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
