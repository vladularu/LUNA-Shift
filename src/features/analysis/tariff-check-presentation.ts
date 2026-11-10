import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import {
  TARIFF_SCOPE_SOURCE,
  TARIFF_TIME_POLICIES,
  TARIFF_WEEKLY_CHECK_ASSUMPTION,
} from "@/domain/tariff-time-policy";

export interface TariffCheckPresentation {
  readonly title: string;
  readonly summary: string;
  readonly limitation: string;
  readonly status: "observation" | "planned" | "unavailable" | "deviation";
  readonly constraints: readonly string[];
  readonly originalRequirements: readonly string[];
  readonly originalDescription?: string;
}

const regularWork = "Die Wochenprüfung berücksichtigt alle zugehörigen Dienste.";
const scope =
  "Ob die Regel für dich gilt, lässt sich aus deinen gespeicherten Tarifangaben nicht sicher erkennen.";
const fortnight =
  "Verglichen werden die gezeigten zwei Wochen. Ein abweichender betrieblicher Bezugszeitraum kann die Einordnung ändern.";
const regularSundays =
  "In deinem Arbeitsmodell ist Sonn- und Feiertagsarbeit noch nicht hinterlegt.";
const unrecordedFree = "Ein leerer Kalendertag ist kein bestätigter freier Tag.";
const mixed = "Innerhalb des Zeitraums ändert sich die Tarifzuordnung oder eine Prüfgrundlage.";
const insufficient = "Die vorhandenen Angaben reichen für diese Tarifprüfung nicht aus.";
const coverageRequirement =
  "Die Tarifregeln sind für diesen Zeitraum noch nicht in dieser Prüffassung geprüft.";
const translations = new Map<string, readonly string[]>([
  [TARIFF_WEEKLY_CHECK_ASSUMPTION, []],
  [coverageRequirement, ["Für diesen Zeitraum sind die Tarifregeln in LUNA noch nicht geprüft."]],
  [
    "Wähle eine eindeutige Tarifgrundlage für diesen Zeitraum.",
    ["Die Tarifzuordnung für diesen Zeitraum ist widersprüchlich."],
  ],
  [
    "Die Arbeitszeit-Tarifgrundlage wird noch geladen.",
    ["Die Tarifdaten für diesen Zeitraum werden noch geladen."],
  ],
  [
    "Die Arbeitszeit-Tarifgrundlage konnte nicht geladen werden. Bitte prüfe die Arbeitszeitdaten.",
    ["Die Tarifdaten für diesen Zeitraum konnten nicht geladen werden."],
  ],
  [
    "Für die bereitgestellten Arbeitszeitdaten ist kein Tarifzeitraum verfügbar.",
    ["Die gespeicherten Tarifdaten decken diesen Zeitraum nicht ab."],
  ],
  [
    "Die erfassten Dienste liegen außerhalb des hinterlegten Beschäftigungszeitraums.",
    ["Die Dienste liegen außerhalb des gespeicherten Beschäftigungszeitraums."],
  ],
  [
    "Die vorhandenen Arbeitszeit-Tarifzeiträume decken dieses Datum nicht ab.",
    ["Die gespeicherten Tarifzeiträume decken diesen Zeitraum nicht ab."],
  ],
  [
    "Mehrere Arbeitszeit-Tarifzeiträume gelten zugleich. Die Zuordnung ist zu klären.",
    ["Mehrere Tarifzeiträume überschneiden sich hier."],
  ],
  ["Die Tarifzuordnung ist für diesen Zeitraum nicht hinreichend bestimmt.", [insufficient]],
  [
    "Der Beschäftigtentarif des Ausbildenden ist noch zu bestätigen.",
    ["Der Beschäftigtentarif des ausbildenden Betriebs ist nicht bekannt."],
  ],
  [
    "Der Geltungsbereich wurde in den Arbeitszeitdaten ausgeschlossen; die Tarifzuordnung ist zu klären.",
    ["Diese Tarifregel ist in den Arbeitszeitdaten für deinen Bereich ausgeschlossen."],
  ],
  [
    "Alter, Schulzeiten und der Beschäftigtentarif des Ausbildenden sind für die Ausbildungsprüfung zu bestätigen.",
    [
      "Bei Auszubildenden hängt die Anwendung zusätzlich von Alter, Schulzeiten und dem Beschäftigtentarif des Betriebs ab.",
    ],
  ],
  [
    "Die Zuordnung zum Krankenpflegedienst im Justizvollzug und der abschließende ÄTV-25-Abgleich bleiben zu prüfen.",
    [
      "Diese TV-H-Sonderregel betrifft den Krankenpflegedienst des Justizvollzugs.",
      "Der Abgleich späterer Tarifänderungen ist noch nicht abgeschlossen.",
    ],
  ],
  [
    "Die Zuordnung des tariflichen Zweiwochen-Bezugszeitraums ist zu bestätigen; dieses Fenster ist ein Beobachtungszeitraum.",
    [fortnight],
  ],
  [
    "Prüfe, ob regelmäßig Sonn- und Feiertagsarbeit im Sinne der Tarifregel geleistet wird. Die Zulässigkeit von Sonntagsarbeit allein bestätigt diese Regelmäßigkeit nicht.",
    [regularSundays],
  ],
  ["Leere Kalendertage sind kein Nachweis tatsächlich arbeitsfreier Tage.", [unrecordedFree]],
  ["Der persönliche Geltungsbereich dieser Tarifregel ist zu bestätigen.", [scope]],
  ["Der persönliche Geltungsbereich der gewählten Tarifregel ist zu bestätigen.", [scope]],
  ["Ein Tarifwechsel innerhalb des Beobachtungszeitraums muss gesondert geprüft werden.", [mixed]],
  [
    "Innerhalb dieser Woche ändert sich die Tarifzuordnung oder eine Prüfgrundlage. Die Teilzeiträume sind getrennt zu beurteilen.",
    [mixed],
  ],
  [
    "Prüfe, welche erfassten Tätigkeiten regelmäßige Arbeitszeit und welche zusätzliche Arbeit sind.",
    [regularWork],
  ],
  [
    "Bestätige den Zeitraum für den Fünftagedurchschnitt und die notwendigen betrieblichen Gründe für eine Sechstagewoche.",
    [
      "Beim Fünftagedurchschnitt kommt es zusätzlich auf den betrieblichen Ausgleichszeitraum an.",
      "Betriebliche Gründe für einen sechsten Arbeitstag sind nicht automatisch belegt.",
    ],
  ],
  [
    "Die notwendigen betrieblichen oder dienstlichen Gründe für einen sechsten Tag sind zu prüfen.",
    ["Betriebliche Gründe für einen sechsten Arbeitstag sind nicht automatisch belegt."],
  ],
  [
    "Die dringenden betrieblichen oder dienstlichen Gründe für einen sechsten Tag sind zu prüfen.",
    ["Dringende betriebliche Gründe für einen sechsten Arbeitstag sind nicht automatisch belegt."],
  ],
]);
const unavailableCauses = new Set([
  coverageRequirement,
  "Wähle eine eindeutige Tarifgrundlage für diesen Zeitraum.",
  "Die Arbeitszeit-Tarifgrundlage wird noch geladen.",
  "Die Arbeitszeit-Tarifgrundlage konnte nicht geladen werden. Bitte prüfe die Arbeitszeitdaten.",
  "Für die bereitgestellten Arbeitszeitdaten ist kein Tarifzeitraum verfügbar.",
  "Die erfassten Dienste liegen außerhalb des hinterlegten Beschäftigungszeitraums.",
  "Die vorhandenen Arbeitszeit-Tarifzeiträume decken dieses Datum nicht ab.",
  "Mehrere Arbeitszeit-Tarifzeiträume gelten zugleich. Die Zuordnung ist zu klären.",
  "Die Tarifzuordnung ist für diesen Zeitraum nicht hinreichend bestimmt.",
  "Der Beschäftigtentarif des Ausbildenden ist noch zu bestätigen.",
  "Der Geltungsbereich wurde in den Arbeitszeitdaten ausgeschlossen; die Tarifzuordnung ist zu klären.",
]);

/** UI wording only: preserve every rule, raw status, source and recorded value. */
export function tariffCheckPresentation(
  evidence: TariffComplianceEvidence,
  title: string,
  description: string,
): TariffCheckPresentation {
  const sunday = evidence.ruleId === "TARIFF_FREE_SUNDAY";
  const week = evidence.ruleId === "TARIFF_WEEK_DAYS";
  const freeDays = evidence.ruleId === "TARIFF_FREE_DAYS";
  const unavailable =
    evidence.status === "UNAVAILABLE" ||
    evidence.ruleId === "TARIFF_SCOPE" ||
    evidence.source.url === TARIFF_SCOPE_SOURCE.url;
  const planned = evidence.status === "PENDING";
  const count =
    Number.isSafeInteger(evidence.count) &&
    evidence.count! > 0 &&
    evidence.count! <= (week ? 7 : 14)
      ? evidence.count
      : undefined;
  const constraints = [
    ...new Set([
      ...evidence.requirements.flatMap((requirement) => translations.get(requirement) ?? []),
    ]),
  ].filter(
    (constraint) =>
      // Show only conditions relevant to this finding. Selected tariffs are the
      // working basis; genuine scope gaps have their own unavailable result.
      (unavailable || constraint !== scope) &&
      !(!unavailable && (sunday || freeDays) && constraint === fortnight) &&
      !(week && constraint === regularWork) &&
      !(sunday && constraint === unrecordedFree),
  );
  const originalRequirements = evidence.requirements.filter(
    (requirement) => !translations.has(requirement),
  );
  const originalDescription = description.trim() ? description : undefined;
  if (unavailable)
    return {
      title: "Tarifprüfung eingeschränkt",
      summary:
        translations.get(
          evidence.requirements.find((requirement) => unavailableCauses.has(requirement)) ?? "",
        )?.[0] ?? insufficient,
      limitation: "Gesetzliche Prüfungen bleiben davon unabhängig.",
      status: "unavailable",
      constraints,
      originalRequirements,
      originalDescription,
    };
  const shortTitle =
    sunday && count === 2
      ? "2 Sonntage hintereinander mit Dienst"
      : week && count
        ? `${count} Diensttage in einer Kalenderwoche`
        : freeDays && count
          ? `${count} Tage mit Dienst in zwei Wochen`
          : title.trim() || "Tarifhinweis";
  const averageFive = evidence.source.url === TARIFF_TIME_POLICIES.TVUK.source.url;
  const summary = sunday
    ? `${constraints.includes(regularSundays) ? "Bei regelmäßiger Sonn- und Feiertagsarbeit soll von zwei freien Tagen innerhalb von zwei Wochen einer" : "Von zwei freien Tagen innerhalb von zwei Wochen soll einer"} auf einen Sonntag fallen.`
    : week
      ? `Der Tarif sieht ${averageFive ? "durchschnittlich " : ""}fünf Arbeitstage vor, bei betrieblichen Gründen auch sechs.`
      : freeDays
        ? `Bei regelmäßiger Sonn- und Feiertagsarbeit sind in zwei Wochen zwei ${averageFive ? "zusammenhängende " : ""}freie Tage vorgesehen.`
        : "Für diesen Zeitraum ist ein Tarifhinweis hinterlegt.";
  const limitation =
    sunday || freeDays
      ? fortnight
      : week
        ? TARIFF_WEEKLY_CHECK_ASSUMPTION
        : "Für eine genauere Aussage reichen die verfügbaren Tarifangaben nicht aus.";
  return {
    title: shortTitle,
    summary,
    limitation,
    status: planned ? "planned" : evidence.status === "DEVIATION" ? "deviation" : "observation",
    constraints,
    originalRequirements,
    originalDescription,
  };
}
