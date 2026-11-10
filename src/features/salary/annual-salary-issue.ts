import { formatMonthTitle } from "@/engine/calendar";
import type { SpecialDutyReview } from "@/domain/special-duty-review";

export type AnnualSalaryIssue =
  | { readonly code: "TARIFF_CHANGE" }
  | { readonly code: "SALARY_BASIS_CONFLICT" }
  | { readonly code: "UNSUPPORTED_YEAR" }
  | { readonly code: "UNSUPPORTED_GROUP" }
  | { readonly code: "NO_TARIFF" }
  | { readonly code: "TEST_DATA" }
  | {
      readonly code: "REFERENCE_MONTH_UNAVAILABLE" | "REFERENCE_MONTH_FAILED";
      readonly month: string;
      readonly duties?: readonly SpecialDutyReview[];
    };

export function annualSalaryIssueLabel(issue?: AnnualSalaryIssue | null): string {
  switch (issue?.code) {
    case "TARIFF_CHANGE":
      return "Tarifwechsel prüfen";
    case "SALARY_BASIS_CONFLICT":
      return "Gehaltsangaben prüfen";
    case "REFERENCE_MONTH_UNAVAILABLE":
      return issue.duties?.length ? "Bereitschaft prüfen" : "Referenzmonat prüfen";
    case "REFERENCE_MONTH_FAILED":
      return "Referenzmonat prüfen";
    case "UNSUPPORTED_GROUP":
    case "UNSUPPORTED_YEAR":
    case "NO_TARIFF":
      return "Betrag ergänzen";
    case "TEST_DATA":
      return "Testdaten aktiv";
    default:
      return "Nicht hinterlegt";
  }
}

export function annualSalaryIssueMessage(issue: AnnualSalaryIssue): string {
  switch (issue.code) {
    case "TARIFF_CHANGE":
      return "Im Anspruchsjahr ändern sich Tarif oder Entgeltgruppe. Prüfe deinen Beschäftigungsverlauf. Waren die bisherigen Angaben falsch, berichtige den gesamten Zeitraum. Bei einem tatsächlichen Wechsel kannst du den bestätigten Bruttobetrag ergänzen.";
    case "SALARY_BASIS_CONFLICT":
      return "Deine gespeicherten Gehaltsangaben widersprechen sich. Prüfe Tarif und Gehalt in deinem Arbeitsprofil.";
    case "REFERENCE_MONTH_UNAVAILABLE":
      if (issue.duties?.length)
        return `Für ${formatMonthTitle(issue.month)} fehlen noch Abrechnungsangaben zur Bereitschaft. Prüfe die betroffenen Dienste, damit die Jahressonderzahlung berechnet werden kann.`;
      return `Für ${formatMonthTitle(issue.month)} fehlt eine vollständige Gehaltsberechnung. Prüfe dort Dienste und Gehaltsangaben oder ergänze den bestätigten Bruttobetrag.`;
    case "REFERENCE_MONTH_FAILED":
      return `Die Gehaltsberechnung für ${formatMonthTitle(issue.month)} ist fehlgeschlagen. Prüfe dort Dienste und Gehaltsangaben und versuche es erneut. Du kannst auch den bestätigten Bruttobetrag ergänzen.`;
    case "UNSUPPORTED_GROUP":
      return "Für diese Tarifgruppe ist noch keine automatische Prognose hinterlegt. Du kannst den bestätigten Bruttobetrag ergänzen.";
    case "UNSUPPORTED_YEAR":
      return "Die automatische Tarifprognose ist bisher nur für 2026 hinterlegt. Für dieses Jahr kannst du den bestätigten Bruttobetrag ergänzen.";
    case "NO_TARIFF":
      return "Für deine Gehaltsgrundlage gibt es keine automatische Tarifprognose. Du kannst den vereinbarten Bruttobetrag ergänzen.";
    case "TEST_DATA":
      return "Solange Testmonate aktiv sind, wird keine persönliche Tarifprognose berechnet. Stelle im Testlabor deine eigenen Daten wieder her.";
  }
}
