import { Temporal } from "@js-temporal/polyfill";
import { resolveNetPaySettings, type SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import { calculateMonthlyComplianceSteps } from "@/engine/compliance";
import { buildAnnualAvailableReportSteps } from "@/features/analysis/annual-core-report";
import { calculateMonthlyAnalysis } from "@/features/analysis/monthly-analysis";
import { RuleResolutionError, type RuleResolver } from "@/rules/rule-resolver";
import { appendReportData, type ReportDocument, type ReportRow } from "./report-document";

export interface ReportInput {
  readonly period: string;
  readonly entries: readonly CalendarEntry[];
  readonly profile: UserProfile;
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

export function* buildReportSteps(input: ReportInput): Generator<void, ReportDocument, void> {
  const months = reportMonths(input.period);
  const rows: ReportRow[] = [];
  let availableNetMonthCount = 0;
  let annualNetCents = 0;
  const add = (section: string, period: string, record: string, data: unknown) =>
    appendReportData(rows, section, period, record, data);
  add("Bericht", input.period, "Grundlagen", {
    createdAt: input.createdAt,
    referenceDate: input.referenceDate,
    testMonths: input.testMonths.filter((month) => months.includes(month)),
    youthProtection: input.youthProtection,
    reason:
      "Gehaltsprognose: unverbindliche Brutto-/Nettoschätzung, keine Lohnabrechnung. Pausen werden mangels Lageangabe mittig angesetzt. Automatische Prüfhinweise sind keine Rechtsberatung.",
  });
  add("Profil", input.period, "Berechnungsgrundlagen", input.profile);
  add("Profil", input.period, "Arbeitsmuster", input.workPatternSettings);
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
    const annual = step.value;
    add("Jahresauswertung", input.period, "Jahresübersicht", {
      ...annual,
      premiumAmount: annual.availablePayMonthCount === 0 ? null : annual.premiumAmount,
      overtimeAmount: annual.availablePayMonthCount === 0 ? null : annual.overtimeAmount,
      allowanceAmount: annual.availablePayMonthCount === 0 ? null : annual.allowanceAmount,
      criticalCount: annual.complianceCoverageComplete ? annual.criticalCount : null,
      warningCount: annual.complianceCoverageComplete ? annual.warningCount : null,
      months: annual.months.map((item) => ({
        ...item,
        premiumAmount: item.estimatedGrossAmount === null ? null : item.premiumAmount,
        criticalCount: item.complianceComplete === false ? null : item.criticalCount,
        warningCount: item.complianceComplete === false ? null : item.warningCount,
        infoCount: item.complianceComplete === false ? null : item.infoCount,
      })),
      estimatedGrossAmount:
        annual.availablePayMonthCount === 0 ? null : annual.estimatedGrossAmount,
      reason: `Gehaltsprognose für ${annual.availablePayMonthCount} von 12 Monaten verfügbar; die Summe umfasst ausschließlich diese Monate.`,
    });
    yield;
  }
  for (const month of months) {
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
        ? calculation.summary.value
        : { status: "Nicht verfügbar", reason: calculation.summary.error.message },
    );
    add("Schichtstatistik", month, "Verteilung", calculation.shiftTypeAnalysis);
    const pay = calculation.pay;
    add(
      "Gehaltsprognose",
      month,
      "Bruttoschätzung",
      pay.ok
        ? pay.value.available
          ? pay.value
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
    const savedNet = resolveNetPaySettings(month, input.netPayTimeline ?? []);
    if (savedNet) add("Netto-Grundlagen", month, "Gespeicherte Angaben", savedNet);
    if (savedNet && pay.ok) {
      const forecast = calculateAutomaticNetPayForecast(
        {
          month,
          profile: input.profile,
          settings: savedNet.settings,
          shifts: calculation.monthShifts,
          pay: pay.value,
        },
        input.ruleResolver,
      );
      add("Netto-Prognose", month, "Berechnung und Abzüge", forecast);
      if (forecast.result.status === "available") {
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
        add("Auswertung", month, "Arbeitszeitrecht und Planung/Erholung", step.value);
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
  return { period: input.period, createdAt: input.createdAt, rows };
}
