import type { ComplianceIssue } from "@/domain/types";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";
import {
  PLANNING_WEEKEND_POLICY,
  type PlanningWeekendAssessment,
} from "@/domain/planning-weekend-policy";
import { PLANNING_NIGHT_POLICY, type PlanningNightSequence } from "@/domain/planning-night-policy";

interface PlanningHintSource {
  readonly title: string;
  readonly url: string;
  readonly context: string;
}

const nightSources: readonly PlanningHintSource[] = PLANNING_NIGHT_POLICY.sources.map(
  (source, index) => ({
    ...source,
    context:
      index === 0
        ? "Empfehlung zur Anzahl aufeinanderfolgender Nachtdienste."
        : index === 1
          ? "Empfehlung zur freien Zeit nach einer Nachtphase."
          : "Forschungsempfehlungen zu Anzahl und Dauer von Nachtschichten.",
  }),
);
const bauaHandbook: PlanningHintSource = {
  title: "BAuA: Arbeitszeitgestaltung – Handbuch zur Gefährdungsbeurteilung",
  url: "https://www.baua.de/DE/Themen/Arbeitsgestaltung/Gefaehrdungsbeurteilung/Handbuch-Gefaehrdungsbeurteilung/Expertenwissen/Arbeitszeitgestaltung/Arbeitszeitgestaltung?view=pdfViewExt",
  context: "Kapitel 10.2.5: Prüfliste zur Schichtarbeit; Herausgeberjahr 2023.",
};

export interface PlanningHintPresentation {
  readonly compactTitle?: string;
  readonly compactSummary?: string;
  readonly title: string;
  readonly summary: readonly string[];
  readonly explanation: string;
  readonly recommendation: string | null;
  readonly recoveryNote: string | null;
  readonly scientificNight: boolean;
  readonly sources: readonly PlanningHintSource[];
  readonly policyNote?: string;
  readonly weekendPeriod?: { readonly from: string; readonly until: string };
  readonly weekendAssessment?: PlanningWeekendAssessment;
}

function freeTime(minutes: number): string {
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return (
    [hours ? `${hours} Std.` : "", rest ? `${rest} Min.` : ""].filter(Boolean).join(" ") || "0 Min."
  );
}

function recoveryObservation(sequence: PlanningNightSequence): string {
  if (sequence.restMinutes !== null) return `Danach ${freeTime(sequence.restMinutes)} frei.`;
  return sequence.recoveryStatus === "open"
    ? "Die freie Zeit danach ist noch offen."
    : "Die freie Zeit danach ist noch unklar.";
}

/** Presentation only: keep the finding, thresholds, counts and export text intact. */
export function planningHintPresentation(
  issue: ComplianceIssue,
  fallbackTitle = issue.title,
): PlanningHintPresentation {
  const facts = validComplianceIssueFacts(issue.facts, issue.rule);
  if (facts?.rule === "PLANNING_NIGHT_SERIES" || facts?.rule === "PLANNING_NIGHT_RECOVERY") {
    const sequence = facts.nightSequence;
    if (sequence) {
      const minimum = sequence.recoveryStatus === "under24";
      const shortRecovery = minimum || sequence.recoveryStatus === "under48";
      const longSeries = facts.rule === "PLANNING_NIGHT_SERIES";
      const title = longSeries
        ? `${sequence.countIsMinimum ? "Mindestens " : ""}${facts.count} Nächte in Folge`
        : `Erholung nach ${sequence.countIsMinimum ? "mindestens " : ""}${facts.count} Nächten`;
      const observation = recoveryObservation(sequence);
      return {
        title,
        compactTitle: title,
        compactSummary: observation,
        summary: [observation],
        explanation:
          !longSeries && sequence.restMinutes !== null
            ? `Bis zum nächsten Dienst sind ${freeTime(sequence.restMinutes)} frei.`
            : observation,
        recommendation: longSeries
          ? `Empfohlen sind höchstens 3 Nächte in Folge${shortRecovery ? ` und danach ${minimum ? "mindestens 24" : "möglichst 48"} Stunden frei` : ""}.`
          : `Empfohlen sind ${minimum ? "mindestens 24" : "möglichst 48"} Stunden freie Zeit.`,
        recoveryNote: null,
        policyNote:
          "Die Prüfung nutzt deine erfassten Dienstzeiten. Sie sagt nicht, wie erholt du persönlich bist.",
        scientificNight: true,
        sources: longSeries ? nightSources : nightSources.filter((_, index) => index === 1),
      };
    }
  }
  if (facts?.rule === "PLANNING_WEEKEND_RECOVERY") {
    const assessment = facts.assessment;
    const affected = assessment.windows.filter(
      (window) =>
        window.assessmentComplete &&
        window.unknownCount === 0 &&
        window.freeCount < PLANNING_WEEKEND_POLICY.minimumFreeWeekends,
    );
    if (affected.length) {
      const selected = [...affected].sort(
        (a, b) =>
          a.freeCount - b.freeCount ||
          b.until.localeCompare(a.until) ||
          b.from.localeCompare(a.from),
      )[0]!;
      const free = selected.freeCount;
      const title =
        free === 1 ? "1 freies Wochenende in 4 Wochen" : "Kein freies Wochenende in 4 Wochen";
      return {
        title,
        compactTitle: title,
        compactSummary: "Empfohlen sind mindestens 2 freie Wochenenden.",
        summary: ["Empfohlen sind mindestens 2 freie Wochenenden in 4 Wochen."],
        explanation:
          free === 1
            ? "In diesem Zeitraum ist 1 Wochenende frei."
            : "In diesem Zeitraum ist kein Wochenende frei.",
        recommendation: "Empfohlen sind mindestens 2 freie Wochenenden in 4 Wochen.",
        recoveryNote: null,
        scientificNight: false,
        policyNote:
          "Ein freies Wochenende umfasst Samstag und Sonntag. Gezählt werden vier volle Wochen von Montag bis Sonntag; dies ist keine gesetzliche Mindestgrenze. Unvollständige Zeiträume lösen keinen Befund aus.",
        sources: [PLANNING_WEEKEND_POLICY.source],
        weekendAssessment: assessment,
        weekendPeriod: { from: selected.from, until: selected.until },
      };
    }
  }
  if (facts?.rule === "PLANNING_7_DAYS")
    return {
      title: `${facts.count} Diensttage in Folge`,
      compactTitle: `${facts.count} Diensttage in Folge`,
      compactSummary: "Empfohlen: höchstens 5 Diensttage in Folge.",
      summary: ["Empfohlen sind höchstens 5 Diensttage in Folge."],
      explanation: `Du hast ${facts.count} Diensttage in Folge eingetragen.`,
      recommendation: "Empfohlen sind höchstens 5 Diensttage in Folge.",
      policyNote:
        "Gezählt werden Tage, an denen ein Dienst beginnt. Diese Empfehlung ist keine gesetzliche oder tarifliche Grenze.",
      recoveryNote: null,
      scientificNight: false,
      sources: [bauaHandbook],
    };
  if (issue.rule === "PLANNING_LATE_EARLY")
    return {
      title: "Spät- und Frühdienst direkt nacheinander",
      ...(facts?.rule === "PLANNING_LATE_EARLY"
        ? {
            compactTitle: "Spät- und Frühdienst direkt nacheinander",
            compactSummary: "Empfohlen: Vorwärtswechsel Früh–Spät–Nacht.",
          }
        : {}),
      summary: ["Die BGW empfiehlt die Schichtfolge Früh–Spät–Nacht."],
      explanation: "Auf den Spätdienst folgt am nächsten Tag ein Frühdienst.",
      recommendation: "Empfohlen ist die Reihenfolge Früh–Spät–Nacht.",
      policyNote: "Die freie Zeit zwischen den Diensten wird zusätzlich gesetzlich geprüft.",
      recoveryNote: null,
      scientificNight: false,
      sources: [
        {
          ...nightSources[0],
          context: "Empfehlung zu kurzen Vorwärtswechseln zwischen den Schichtarten.",
        },
      ],
    };
  return {
    title: fallbackTitle,
    summary: [],
    explanation: issue.description,
    recommendation: null,
    recoveryNote: null,
    scientificNight: false,
    sources: [],
  };
}
