import {
  validComplianceIssueFacts,
  type ComplianceIssueFacts,
} from "@/domain/compliance-issue-facts";
import type { ComplianceIssue } from "@/domain/types";
import { legacyComplianceIssueSummary } from "./compliance-issue-legacy";

// Match the existing engine's two-decimal display; raw minutes stay unchanged.
export const complianceHours = (minutes: number) =>
  String(Math.round((minutes / 60) * 100) / 100).replace(".", ",");
export const complianceLimitHours = (minutes: number) => String(minutes / 60).replace(".", ",");

export function complianceCompensationSummary(
  facts: Extract<ComplianceIssueFacts, { rule: "ARBZG_5_REST_11H" }>,
): string {
  const [year, month, day] = facts.compensationDeadline.split("-");
  return `Ausgleich: mindestens ${complianceLimitHours(facts.compensationMinutes)} Std. Ruhezeit bis ${day}.${month}.${year}.`;
}

export function complianceIssueSummary(issue: ComplianceIssue): string {
  if (!("facts" in issue)) return legacyComplianceIssueSummary(issue);
  const facts = validComplianceIssueFacts(issue.facts, issue.rule);
  if (!facts) return issue.description;
  switch (facts.rule) {
    case "ARBZG_5_REST_10H":
      return `Nur ${complianceHours(facts.restMinutes)} Std. Ruhezeit.`;
    case "ARBZG_5_REST_11H":
      return `Ruhezeit: ${complianceHours(facts.restMinutes)} Std. · ${complianceCompensationSummary(facts)}`;
    case "ARBZG_4_BREAK":
      return `Pause: ${facts.recordedBreakMinutes} Min. · nötig: ${facts.requiredBreakMinutes} Min.`;
    case "ARBZG_4_INTERRUPTION":
      return `Pausen prüfen: ${facts.interruptionMinutes} Min. zwischen Diensten.`;
    case "ARBZG_3_MAX_10H":
      return `${complianceHours(facts.netMinutes)} Std. Arbeitszeit · Grenze: ${complianceLimitHours(facts.maximumMinutes)} Std.`;
    case "ARBZG_3_OVER_8H":
      return `${complianceHours(facts.netMinutes)} Std. Arbeitszeit · Ausgleich nötig.`;
    case "ARBZG_4_CONTINUOUS":
      return "Pausen im Arbeitsblock prüfen.";
    case "TIME_PLAUSIBILITY":
      return "Pause und Dienstzeiten prüfen.";
    case "TIME_GROSS_OVER_16H":
      return `${complianceHours(facts.grossMinutes)} Std. Dienstzeit · Eingabe prüfen.`;
    case "PLANNING_7_DAYS":
      return `${facts.count} Arbeitstage in Folge.`;
    case "PLANNING_NIGHT_SERIES":
      return `${facts.count} Nachtdienste in Folge.`;
    case "PLANNING_LATE_EARLY":
      return "Ruhezeit eingehalten · Dienstfolge prüfen.";
    case "PLANNING_WEEKENDS":
      return "Prüfen, ob jedes zweite Wochenende frei sein sollte.";
    default:
      return issue.description;
  }
}
