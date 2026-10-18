import { describe, expect, it } from "vitest";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { complianceIssueSummary } from "./compliance-issue-summary";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import type { ComplianceIssueFacts } from "@/domain/compliance-issue-facts";

const finding = (rule: string, description: string): ComplianceIssue =>
  Object.freeze({
    id: "finding",
    rule,
    description,
    title: "Prüfhinweis",
    kind: "LEGAL",
    severity: "critical",
    date: "2026-08-05",
    relatedShiftIds: [],
  });

describe("compact compliance information", () => {
  it.each([
    [
      "ARBZG_5_REST_10H",
      "Zwischen den Diensten liegen nur 5.8 h Ruhezeit. Damit wird auch die für Krankenhäuser und Pflegeeinrichtungen mögliche Verkürzung auf 10 Stunden unterschritten.",
      "Nur 5,8 Std. Ruhezeit.",
    ],
    [
      "ARBZG_5_REST_10H",
      "Zwischen den Diensten liegen nur 8.0 h Ruhezeit.",
      "Nur 8 Std. Ruhezeit.",
    ],
    [
      "ARBZG_5_REST_10H",
      "Zwischen den Diensten liegen nur 9,5 h Ruhezeit.",
      "Nur 9,5 Std. Ruhezeit.",
    ],
    [
      "ARBZG_5_REST_11H",
      "Die Ruhezeit beträgt 10.5 h. In den eingetragenen Diensten wurde bis 17.10.2026 keine noch unbenutzte Ruhezeit von mindestens 12 Stunden als Ausgleich erkannt.",
      "Ruhezeit: 10,5 Std. · Ausgleich: mindestens 12 Std. Ruhezeit bis 17.10.2026.",
    ],
    [
      "ARBZG_4_BREAK",
      "Erfasst sind 30 Minuten Pause; erforderlich sind mindestens 45 Minuten.",
      "Pause: 30 Min. · nötig: 45 Min.",
    ],
    [
      "ARBZG_4_BREAK",
      "Erfasst sind 0 Minuten Pause; erforderlich sind mindestens 30 Minuten.",
      "Pause: 0 Min. · nötig: 30 Min.",
    ],
    [
      "ARBZG_4_INTERRUPTION",
      "20 Minuten zwischen Diensten könnten die fehlende Pause abdecken. Bitte die tatsächliche Pausenlage prüfen.",
      "Pausen prüfen: 20 Min. zwischen Diensten.",
    ],
    [
      "ARBZG_3_MAX_10H",
      "10.5 h Nettoarbeitszeit überschreiten die 10-Stunden-Grenze.",
      "10,5 Std. Arbeitszeit · Grenze: 10 Std.",
    ],
    [
      "ARBZG_3_OVER_8H",
      "9.0 h Nettoarbeitszeit erfordern einen zulässigen Ausgleichszeitraum.",
      "9 Std. Arbeitszeit · Ausgleich nötig.",
    ],
    [
      "ARBZG_4_CONTINUOUS",
      "Ein zusammenhängender Arbeitsblock überschreitet sechs Stunden ohne dokumentierte Ruhepause.",
      "Pausen im Arbeitsblock prüfen.",
    ],
    [
      "TIME_PLAUSIBILITY",
      "Die eingetragene Pause ist länger als die gesamte Brutto-Dienstzeit.",
      "Pause und Dienstzeiten prüfen.",
    ],
    [
      "TIME_GROSS_OVER_16H",
      "Die Brutto-Dienstzeit beträgt 17.5 h und sollte auf einen Eingabefehler geprüft werden.",
      "17,5 Std. Dienstzeit · Eingabe prüfen.",
    ],
    [
      "PLANNING_7_DAYS",
      "9 aufeinanderfolgende Arbeitstage wurden erkannt.",
      "9 Arbeitstage in Folge.",
    ],
    [
      "PLANNING_NIGHT_SERIES",
      "4 aufeinanderfolgende Nachtdienste wurden erkannt.",
      "4 Nachtdienste in Folge.",
    ],
    [
      "PLANNING_LATE_EARLY",
      "Die gesetzliche Ruhezeit ist eingehalten; die kurze Vorwärtsrotation sollte dennoch geprüft werden.",
      "Ruhezeit eingehalten · Dienstfolge prüfen.",
    ],
    [
      "PLANNING_WEEKENDS",
      "Prüfen, ob nach der Dienstplanregel jedes zweite Wochenende frei sein sollte.",
      "Prüfen, ob jedes zweite Wochenende frei sein sollte.",
    ],
  ])("keeps facts and actions visible for %s", (rule, description, summary) => {
    const original = finding(rule, description);
    expect(complianceIssueSummary(original)).toBe(summary);
    expect(original.description).toBe(description);
  });

  it.each([
    [
      "ARBZG_5_REST_10H",
      "Zwischen den Diensten liegen nur 5.8 h Ruhezeit. Eine neue wichtige Voraussetzung muss zuerst geklärt werden.",
    ],
    ["FUTURE_RULE", "Kurzer Hinweis. Wichtige neue Voraussetzung und Handlung bleiben sichtbar."],
    ["ARBZG_5_REST_10H", "Ruhezeit ist noch nicht bestimmt. Bitte fehlende Zeiten ergänzen."],
    [
      "ARBZG_5_REST_11H",
      "Die Ruhezeit beträgt 10.5 h. Eine neue Ausgleichsregel muss zuerst bestätigt werden.",
    ],
    [
      "JARBSCHG_UNKNOWN",
      "Erfasste Angaben fehlen. Eine konkrete Jugendregel kann noch nicht geprüft werden.",
    ],
    [
      "PLANNING_7_DAYS",
      "9 aufeinanderfolgende Arbeitstage wurden erkannt. Zusätzliche wichtige Angaben fehlen.",
    ],
  ])("preserves unfamiliar or extended text in full for %s", (rule, description) => {
    expect(complianceIssueSummary(finding(rule, description))).toBe(description);
  });
});

describe("structured compliance facts", () => {
  const cases = [
    [
      "ARBZG_5_REST_10H",
      "Zwischen den Diensten liegen nur 5.8 h Ruhezeit.",
      { restMinutes: 348, minimumRestMinutes: 600 },
    ],
    [
      "ARBZG_5_REST_11H",
      "Die Ruhezeit beträgt 10.5 h. In den eingetragenen Diensten wurde bis 17.10.2026 keine noch unbenutzte Ruhezeit von mindestens 12 Stunden als Ausgleich erkannt.",
      { restMinutes: 630, compensationMinutes: 720, compensationDeadline: "2026-10-17" },
    ],
    [
      "ARBZG_4_BREAK",
      "Erfasst sind 30 Minuten Pause; erforderlich sind mindestens 45 Minuten.",
      { recordedBreakMinutes: 30, requiredBreakMinutes: 45 },
    ],
    [
      "ARBZG_4_INTERRUPTION",
      "20 Minuten zwischen Diensten könnten die fehlende Pause abdecken. Bitte die tatsächliche Pausenlage prüfen.",
      { interruptionMinutes: 20 },
    ],
    [
      "ARBZG_3_MAX_10H",
      "10.5 h Nettoarbeitszeit überschreiten die 10-Stunden-Grenze.",
      { netMinutes: 630, maximumMinutes: 600 },
    ],
    [
      "ARBZG_3_OVER_8H",
      "9.0 h Nettoarbeitszeit erfordern einen zulässigen Ausgleichszeitraum.",
      { netMinutes: 540 },
    ],
    [
      "ARBZG_4_CONTINUOUS",
      "Ein zusammenhängender Arbeitsblock überschreitet sechs Stunden ohne dokumentierte Ruhepause.",
      { maximumContinuousMinutes: 360 },
    ],
    [
      "TIME_PLAUSIBILITY",
      "Die eingetragene Pause ist länger als die gesamte Brutto-Dienstzeit.",
      { breakMinutes: 90, grossMinutes: 60 },
    ],
    [
      "TIME_GROSS_OVER_16H",
      "Die Brutto-Dienstzeit beträgt 17.5 h und sollte auf einen Eingabefehler geprüft werden.",
      { grossMinutes: 1050 },
    ],
    ["PLANNING_7_DAYS", "9 aufeinanderfolgende Arbeitstage wurden erkannt.", { count: 9 }],
    ["PLANNING_NIGHT_SERIES", "4 aufeinanderfolgende Nachtdienste wurden erkannt.", { count: 4 }],
    [
      "PLANNING_LATE_EARLY",
      "Die gesetzliche Ruhezeit ist eingehalten; die kurze Vorwärtsrotation sollte dennoch geprüft werden.",
      {},
    ],
    [
      "PLANNING_WEEKENDS",
      "Prüfen, ob nach der Dienstplanregel jedes zweite Wochenende frei sein sollte.",
      {},
    ],
  ] as const;

  it.each(cases)(
    "keeps canonical display for %s independently of wording",
    (rule, description, values) => {
      const canonical = finding(rule, description);
      const reworded = Object.freeze({
        ...canonical,
        title: "Neu formulierter Titel",
        description: "Neu formulierter Erklärungstext.",
        facts: { rule, ...values } as ComplianceIssueFacts,
      });
      expect(complianceIssueSummary(reworded)).toBe(complianceIssueSummary(canonical));
      expect(reworded.description).toBe("Neu formulierter Erklärungstext.");
    },
  );

  it.each([
    0, 1, 2, 3, 4, 5, 6, 29, 30, 31, 59, 60, 61, 62, 63, 64, 65, 348, 599, 600, 629, 630, 631,
  ])("matches legacy rounding for %s raw minutes", (restMinutes) => {
    const canonical = finding(
      "ARBZG_5_REST_10H",
      `Zwischen den Diensten liegen nur ${Math.round((restMinutes / 60) * 100) / 100} h Ruhezeit.`,
    );
    const structured = {
      ...canonical,
      description: "Wortlaut wurde geändert.",
      facts: { rule: "ARBZG_5_REST_10H" as const, restMinutes, minimumRestMinutes: 600 },
    };
    expect(complianceIssueSummary(structured)).toBe(complianceIssueSummary(canonical));
  });

  it.each([
    null,
    {},
    { rule: "ARBZG_5_REST_10H", restMinutes: -1, minimumRestMinutes: 600 },
    { rule: "ARBZG_5_REST_10H", restMinutes: Number.NaN, minimumRestMinutes: 600 },
    { rule: "ARBZG_5_REST_10H", restMinutes: Number.POSITIVE_INFINITY, minimumRestMinutes: 600 },
    { rule: "ARBZG_5_REST_10H", restMinutes: "348", minimumRestMinutes: 600 },
    { rule: "ARBZG_5_REST_10H", restMinutes: 348 },
    { rule: "PLANNING_7_DAYS", count: 9 },
  ])("keeps the entire description when present facts are invalid: %j", (facts) => {
    const canonical = finding(
      "ARBZG_5_REST_10H",
      "Zwischen den Diensten liegen nur 5.8 h Ruhezeit.",
    );
    const invalid = { ...canonical, facts };
    expect(complianceIssueSummary(invalid as unknown as ComplianceIssue)).toBe(
      canonical.description,
    );
  });

  it("uses actual engine facts after both title and description are reworded", () => {
    const shift: ShiftEntry = {
      kind: "SHIFT",
      id: "long",
      templateId: null,
      date: "2026-07-01",
      title: "Dienst",
      type: "DAY",
      startTime: "07:00",
      endTime: "18:00",
      breakMinutes: 15,
      color: "#123456",
      symbol: "D",
      note: null,
      overtimeMinutes: 0,
      holidayPremiumMode: "WITH_TIME_OFF",
      revision: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
    };
    const issue = calculateMonthlyCompliance("2026-07", [shift], "Europe/Berlin").issues.find(
      (item) => item.rule === "ARBZG_4_BREAK",
    )!;
    const reworded = { ...issue, title: "Pause prüfen", description: "Neue kurze Erklärung." };
    expect(complianceIssueSummary(reworded)).toBe("Pause: 15 Min. · nötig: 45 Min.");
    expect(issue.description).toBe(
      "Erfasst sind 15 Minuten Pause; erforderlich sind mindestens 45 Minuten.",
    );
  });
});
