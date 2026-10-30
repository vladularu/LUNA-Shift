import { employmentProfileAt, employmentMonthPeriods } from "@/domain/employment-history";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import type {
  WorkingTimeTargetProfile,
  MonthlyWorkingTimeTarget,
} from "@/domain/working-time-target";
import { Temporal } from "@js-temporal/polyfill";
import {
  collectAnnualSalaryPayments,
  resolveNetPaySettings,
  type SavedMonthlyNetPaySettings,
} from "@/domain/net-pay-profile";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import { calculateMonthlyComplianceSteps } from "@/engine/compliance";
import { buildAnnualAvailableReportSteps } from "@/features/analysis/annual-core-report";
import {
  selectAnnualCheckDisplay,
  selectVisibleCompliance,
} from "@/features/analysis/check-visibility";
import { calculateMonthlyAnalysis } from "@/features/analysis/monthly-analysis";
import { RuleResolutionError, type RuleResolver } from "@/rules/rule-resolver";
import { appendReportData, type ReportDocument, type ReportRow } from "./report-document";
import { reportEntries } from "./report-entry-data";
import { withAnnualSalaryPayments } from "@/features/analysis/annual-salary-payments";
import { annualSalaryGrossCents } from "@/domain/annual-salary-payment";
import { annualSalaryForecast } from "@/features/salary/annual-salary-forecast";

export interface ReportInput {
  readonly period: string;
  readonly entries: readonly CalendarEntry[];
  readonly profile: UserProfile & WorkingTimeTargetProfile;
  readonly tariffDecisions: readonly MonthlyTariffDecision[];
  readonly workPatternSettings: TvoedWorkPatternSettings;
  readonly ruleResolver: RuleResolver;
  readonly createdAt: string;
  readonly referenceDate: string;
  readonly youthProtection: boolean;
  readonly testMonths: readonly string[];
  readonly netPayTimeline?: readonly SavedMonthlyNetPaySettings[];
}

function reportMonths(period: string): readonly string[] {
  if (!/^\d{4}(-\d{2})?$/.test(period)) throw new Error("Ungültiger Berichtszeitraum.");
  const year = Number(period.slice(0, 4));
  if (year < 1900 || year > 4099) throw new Error("Ungültiger Berichtszeitraum.");
  if (period.length === 7) {
    Temporal.PlainDate.from(`${period}-01`);
    return [period];
  }
  return Array.from(
    { length: 12 },
    (_, index) => `${period}-${String(index + 1).padStart(2, "0")}`,
  );
}

/** Internal tax traces are calculation evidence, not user-facing report fields. */
function reportPayrollValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reportPayrollValues);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "payrollTrace" && key !== "payrollTraces")
        .map(([key, item]) => [key, reportPayrollValues(item)]),
    );
  return value;
}

export function* buildReportSteps(input: ReportInput): Generator<void, ReportDocument, void> {
  const months = reportMonths(input.period);
  const annualPayments = annualSalaryForecast(
    Number(input.period.slice(0, 4)),
    input.profile,
    {
      entries: input.entries,
      tariffDecisions: input.tariffDecisions,
      workPatternSettings: input.workPatternSettings,
      resolver: input.ruleResolver,
      testMonths: input.testMonths,
    },
    collectAnnualSalaryPayments(input.netPayTimeline ?? []),
  ).payments;
  const rows: ReportRow[] = [];
  const workingTimeTargets: MonthlyWorkingTimeTarget[] = [];
  const readableEntries: NonNullable<ReportDocument["entries"]>[number][] = [];
  let availableNetMonthCount = 0;
  let annualNetCents = 0;
  const add = (section: string, period: string, record: string, data: unknown) =>
    appendReportData(
      rows,
      section,
      period,
      record,
      section === "Gehaltsprognose" ? reportPayrollValues(data) : data,
    );
  add("Bericht", input.period, "Grundlagen", {
    createdAt: input.createdAt,
    referenceDate: input.referenceDate,
    testMonths: input.testMonths.filter((month) => months.includes(month)),
    youthProtection: input.youthProtection,
    reason:
      "Gehaltsprognose: unverbindliche Brutto-/Nettoschätzung, keine Lohnabrechnung. Bei regulären Diensten setzt die Prognose Pausen ohne Zeitangabe mittig an. Bei Bereitschaftsdiensten können weitere Pausenangaben nötig sein. Automatische Prüfhinweise sind keine Rechtsberatung.",
  });
  const {
    workingTimeTarget: _calculationInput,
    employmentTimeline: _history,
    ...savedProfile
  } = employmentProfileAt(input.profile, months[0] + "-01");
  add("Profil", input.period, "Berechnungsgrundlagen", savedProfile);
  add("Profil", input.period, "Arbeitsmuster", input.workPatternSettings);
  if (input.profile.employmentTimeline?.some((item) => item.employment))
    for (const month of months) {
      for (const period of employmentMonthPeriods(input.profile, month, month + "-31")) {
        const {
          employmentTimeline: _timeline,
          workingTimeTarget: _target,
          ...p
        } = period.profile as typeof input.profile;
        add("Profil", month, "Beschäftigung ab " + period.from, p);
      }
    }
  yield;
  if (months.length === 12) {
    const steps = buildAnnualAvailableReportSteps(
      Number(input.period),
      input.entries,
      input.profile,
      input.tariffDecisions,
      input.workPatternSettings,
      input.referenceDate,
      input.ruleResolver,
      { youthProtection: input.youthProtection },
    );
    let step = steps.next();
    while (!step.done) {
      yield;
      step = steps.next();
    }
    const annual = withAnnualSalaryPayments(
      selectAnnualCheckDisplay(step.value, true),
      input.netPayTimeline ?? [],
      annualPayments,
    );
    add("Jahresauswertung", input.period, "Jahresübersicht", {
      ...annual,
      premiumAmount: annual.availablePayMonthCount === 0 ? null : annual.premiumAmount,
      overtimeAmount: annual.availablePayMonthCount === 0 ? null : annual.overtimeAmount,
      allowanceAmount: annual.availablePayMonthCount === 0 ? null : annual.allowanceAmount,
      criticalCount: annual.complianceCoverageComplete ? annual.criticalCount : null,
      warningCount: annual.complianceCoverageComplete ? annual.warningCount : null,
      infoCount: annual.complianceCoverageComplete ? annual.infoCount : null,
      prerequisiteCount: annual.complianceCoverageComplete ? (annual.prerequisiteCount ?? 0) : null,
      months: annual.months.map((item) => ({
        ...item,
        premiumAmount: item.estimatedGrossAmount === null ? null : item.premiumAmount,
        criticalCount: item.complianceComplete === false ? null : item.criticalCount,
        warningCount: item.complianceComplete === false ? null : item.warningCount,
        infoCount: item.complianceComplete === false ? null : item.infoCount,
        prerequisiteCount: item.complianceComplete === false ? null : (item.prerequisiteCount ?? 0),
      })),
      estimatedGrossAmount:
        annual.availablePayMonthCount === 0 ? null : annual.estimatedGrossAmount,
      reason: `Gehaltsprognose für ${annual.availablePayMonthCount} von 12 Monaten verfügbar; die Summe umfasst ausschließlich diese Monate.`,
    });
    yield;
  }
  for (const month of months) {
    if (input.profile.workingTimeTarget)
      workingTimeTargets.push(
        calculateMonthlyWorkingTimeTarget(month, input.profile, input.ruleResolver),
      );
    const calculation = calculateMonthlyAnalysis(
      month,
      input.entries,
      input.profile,
      input.tariffDecisions,
      input.workPatternSettings,
      input.ruleResolver,
    );
    add(
      "Arbeitszeit",
      month,
      "Monatsübersicht",
      calculation.summary.ok
        ? {
            ...calculation.summary.value,
            ...(calculation.summary.value.specialDutyNotes?.length
              ? { balanceMinutes: null, status: "Zeitgutschrift der Bereitschaften noch offen" }
              : {}),
          }
        : { status: "Nicht verfügbar", reason: calculation.summary.error.message },
    );
    add("Schichtstatistik", month, "Verteilung", calculation.shiftTypeAnalysis);
    const pay = calculation.pay;
    const savedNet = resolveNetPaySettings(month, input.netPayTimeline ?? []);
    const annualGross = annualSalaryGrossCents(month, annualPayments);
    add(
      "Gehaltsprognose",
      month,
      "Bruttoschätzung",
      pay.ok
        ? pay.value.available
          ? {
              ...pay.value,
              estimatedGrossAmount:
                pay.value.estimatedGrossAmount === null
                  ? null
                  : Math.round(pay.value.estimatedGrossAmount * 100 + annualGross) / 100,
              ...(annualGross ? { annualPaymentAmount: annualGross / 100 } : {}),
            }
          : {
              ...pay.value,
              timePremiumAmount: null,
              overtimeAmount: null,
              allowanceAmount: null,
              tvoedAllowanceAmount: null,
              careAllowanceAmount: null,
              status: "Nicht verfügbar",
            }
        : { status: "Nicht verfügbar", reason: pay.error.message },
    );
    const decision = input.tariffDecisions.find((item) => item.month === month);
    if (savedNet) add("Netto-Grundlagen", month, "Gespeicherte Angaben", savedNet);
    if (savedNet && pay.ok) {
      const forecast = calculateAutomaticNetPayForecast(
        {
          month,
          profile: input.profile,
          settings: savedNet.settings.automation
            ? {
                ...savedNet.settings,
                automation: { ...savedNet.settings.automation, annualPayments },
              }
            : savedNet.settings,
          shifts: calculation.monthShifts,
          pay: pay.value,
        },
        input.ruleResolver,
      );
      add("Netto-Prognose", month, "Berechnung und Abzüge", forecast);
      if (
        forecast.result.status === "available" &&
        (!forecast.annualPayment || forecast.annualPayment.netIncluded)
      ) {
        availableNetMonthCount += 1;
        annualNetCents += forecast.result.pay.netCents;
      } else {
        add("Netto-Prognose", month, "Ergebnis", { netCents: null });
      }
    } else {
      add("Netto-Prognose", month, "Ergebnis", {
        status: "Nicht verfügbar",
        netCents: null,
        reason: savedNet
          ? "Die Brutto-Berechnungsgrundlagen sind nicht verfügbar."
          : "Für diesen Monat sind keine Netto-Angaben eingerichtet.",
      });
    }
    add("Tarifbestätigung", month, "Zulagen", decision ?? null);
    yield;
    const selected = calculation.complianceShifts;
    if (!selected.ok) {
      add("Auswertung", month, "Arbeitszeitprüfung", {
        status: "Nicht verfügbar",
        reason: selected.error.message,
      });
    } else {
      try {
        const steps = calculateMonthlyComplianceSteps(
          month,
          selected.value,
          input.profile.timeZone,
          {
            federalState: input.profile.federalState,
            holidayRegion: input.profile.holidayRegion,
            weeklyMinutes: input.profile.weeklyMinutes,
            referenceDate: input.referenceDate,
            regularRotatingNightWork: input.profile.regularRotatingNightWork,
            sundayHolidayWorkEligible: input.profile.sundayHolidayWorkEligible,
            allEmploymentWorkRecorded: input.profile.allEmploymentWorkRecorded,
            youthProtection: input.youthProtection,
            ruleResolver: input.ruleResolver,
          },
        );
        let step = steps.next();
        while (!step.done) {
          yield;
          step = steps.next();
        }
        const compliance = selectVisibleCompliance(step.value, true);
        add("Auswertung", month, "Arbeitszeitrecht und Planung/Erholung", {
          ...compliance,
          prerequisiteCount: compliance.prerequisiteCount ?? 0,
        });
      } catch (error) {
        if (!(error instanceof RuleResolutionError)) throw error;
        add("Auswertung", month, "Arbeitszeitprüfung", {
          status: "Nicht verfügbar",
          reason: error.message,
        });
      }
    }
    yield;
    const entries = input.entries
      .filter((entry) => entry.deletedAt === null && entry.date.startsWith(`${month}-`))
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          (left.startTime ?? "").localeCompare(right.startTime ?? "") ||
          left.id.localeCompare(right.id),
      );
    if (entries.length === 0)
      add("Kalendereinträge", month, "Tagesliste", { status: "Keine Einträge" });
    readableEntries.push(...reportEntries(entries, input.profile, input.ruleResolver));
    for (const entry of entries) {
      add(
        entry.kind === "SHIFT" ? "Dienste und Abwesenheiten" : "Termine",
        month,
        `${entry.date} · ${entry.title} · ${entry.id}`,
        entry,
      );
      yield;
    }
  }
  if (months.length === 12)
    add("Jahresauswertung", input.period, "Netto-Prognose", {
      netCents: availableNetMonthCount === 0 ? null : annualNetCents,
      availableNetMonthCount,
      reason: `Netto-Prognose für ${availableNetMonthCount} von 12 Monaten verfügbar; die Summe umfasst ausschließlich diese Monate.`,
    });
  return {
    period: input.period,
    createdAt: input.createdAt,
    rows,
    entries: readableEntries,
    ...(workingTimeTargets.length ? { workingTimeTargets } : {}),
  };
}
