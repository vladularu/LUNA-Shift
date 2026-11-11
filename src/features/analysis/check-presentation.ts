import type { Palette } from "@/theme/palette-values";
import type { ComplianceIssue } from "@/domain/types";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";
import { PLANNING_GUIDANCE_POLICY } from "@/domain/planning-guidance-policy";
import { PLANNING_NIGHT_POLICY, planningDuration } from "@/domain/planning-night-policy";
import type { PlanningHintPresentation } from "./planning-hint-presentation";

export const PLANNING_TITLE = "Hinweise & Empfehlungen";
export const PLANNING_SUBTITLE =
  "Empfehlungen zu Dienstfolgen, Dienstwechseln und Erholungszeiten.";

export const LEGAL_KIND_LABEL = "Gesetzliche Prüfung";
export const TARIFF_KIND_LABEL = "Tarifliche Prüfung";

export function checkCategory(issue: ComplianceIssue): "planning" | "tariff" | "legal" {
  if (issue.kind === "PLANNING") return "planning";
  return issue.tariff || issue.rule.startsWith("TARIFF_") ? "tariff" : "legal";
}

export function checkCategoryLabel(issue: ComplianceIssue): string {
  const category = checkCategory(issue);
  return category === "planning"
    ? PLANNING_TITLE
    : category === "tariff"
      ? TARIFF_KIND_LABEL
      : LEGAL_KIND_LABEL;
}

export function checkAppearance(issue: ComplianceIssue, palette: Palette) {
  const category = checkCategory(issue);
  return category === "planning"
    ? planningAppearance(palette)
    : {
        cardStyle: {
          borderColor: category === "tariff" ? palette.tariffCheckBorder : palette.legalCheckBorder,
          borderWidth: 1,
        },
        labelColor: palette.textMuted,
      };
}

export function planningAppearance(palette: Palette) {
  return {
    cardStyle: {
      borderWidth: 0,
    },
    labelColor: palette.textMuted,
  };
}

export function planningCardSummary(
  issue: ComplianceIssue,
  hint: PlanningHintPresentation,
): readonly string[] {
  const facts = validComplianceIssueFacts(issue.facts, issue.rule);
  if (issue.rule === "PLANNING_NIGHT_SERIES") {
    const sequence = facts?.rule === "PLANNING_NIGHT_SERIES" ? facts.nightSequence : undefined;
    const summary = [
      `Empfohlen: höchstens ${PLANNING_NIGHT_POLICY.firstNightHint - 1} Nächte in Folge.`,
    ];
    if (sequence?.restMinutes != null && ["under24", "under48"].includes(sequence.recoveryStatus))
      summary.push(`Danach ${planningDuration(sequence.restMinutes)} frei.`);
    return summary;
  }
  if (facts?.rule === "PLANNING_NIGHT_RECOVERY")
    return [
      facts.nightSequence.recoveryStatus === "under24"
        ? "Empfohlen: mindestens 24 Stunden freie Zeit."
        : "Empfohlen: möglichst 48 Stunden freie Zeit.",
    ];
  if (issue.rule === "PLANNING_7_DAYS")
    return [
      `Empfohlen: höchstens ${PLANNING_GUIDANCE_POLICY.maximumWorkSeries} Diensttage in Folge.`,
    ];
  if (issue.rule === "PLANNING_LATE_EARLY") return ["Empfohlen: Vorwärtswechsel Früh–Spät–Nacht."];
  if (issue.rule === "TIME_GROSS_OVER_16H") return ["Dauer und Uhrzeiten prüfen."];
  return hint.summary.length ? hint.summary : ["Einordnung in den Details prüfen."];
}
