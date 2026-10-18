import { SHIFT_TYPE_LABELS, type ShiftType } from "@/domain/types";

export const REPORT_CHECK_SCOPE =
  "Arbeitszeitregeln und alle Planungshinweise – auch in der App ausgeblendete.";

export interface ReportRow {
  readonly section: string;
  readonly period: string;
  readonly record: string;
  readonly field: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
}
export interface ReportDocument {
  readonly period: string;
  readonly createdAt: string;
  readonly rows: readonly ReportRow[];
  readonly entries?: readonly ReportEntry[];
}

export interface ReportEntry {
  readonly date: string;
  readonly title: string;
  readonly kind: "SHIFT" | "APPOINTMENT";
  readonly typeLabel: string;
  readonly color: string;
  readonly allDay: boolean;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly nextDay: boolean;
  readonly breakMinutes: number | null;
  readonly durationMinutes: number | null;
  readonly creditMinutes: number | null;
}

export interface ReportOptions {
  readonly layout: "standard" | "compact";
  readonly includeSalary: boolean;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  layout: "standard",
  includeSalary: true,
};

const LABELS: Readonly<Record<string, string>> = {
  netCents: "Netto-Prognose",
  availableNetMonthCount: "Monate mit verfügbarer Netto-Prognose",
  sourceMonth: "Angaben gültig ab",
  regularGrossCents: "Regelmäßiges Monatsbrutto",
  basicHourlyPayCents: "Grundstundenlohn",
  pensionOmitted: "Zusatzversorgung noch offen und nicht berücksichtigt",
  tax: "Steuern",
  socialInsurance: "Sozialversicherung",
  pension: "Zusatzversorgung",
  wageTaxCents: "Lohnsteuer",
  profile: "Persönliche Angaben",
  settings: "Netto-Einstellungen",
  automation: "Fortlaufende Berechnungsgrundlagen",
  result: "Ergebnis",
  pay: "Nettoberechnung",
  amounts: "Brutto-Grundlagen",
  grossCents: "Brutto",
  taxableGrossCents: "Steuerpflichtiges Brutto",
  socialInsuranceGrossCents: "SV-pflichtiges Brutto",
  regularMonthlySocialInsuranceGrossCents: "Regelmäßiges SV-Brutto",
  taxClass: "Steuerklasse",
  factorPermille: "ELStAM-Faktor",
  churchTaxRatePercent: "Kirchensteuersatz",
  childAllowanceHalfUnits: "Kinderfreibetrag (Halbeinheiten)",
  isParent: "Elterneigenschaft",
  childrenUnder25: "Kinder unter 25 Jahren",
  worksInSaxony: "Arbeitsort Sachsen",
  healthAdditionalRateBps: "GKV-Zusatzbeitrag (Basispunkte)",
  monthlyTaxAllowanceCents: "Monatlicher Steuerfreibetrag",
  additionalRecurringGrossCents: "Weiteres regelmäßiges Brutto",
  pensionScheme: "Zusatzversorgungssystem",
  pensionEmployeeRateBps: "Eigenanteil Zusatzversorgung (Basispunkte)",
  employeeCents: "Eigenanteil Zusatzversorgung",
  contributionBasisCents: "Zusatzversorgungs-Brutto",
  regularContributionBasisCents: "Regelmäßiges Zusatzversorgungs-Brutto",
  healthBasisCents: "Beitragsgrundlage Kranken-/Pflegeversicherung",
  pensionBasisCents: "Beitragsgrundlage Renten-/Arbeitslosenversicherung",
  calculationBasis: "Berechnungsbasis",
  ruleVersion: "Regelversion",
  classification: "Zuschlagszuordnung",
  solidarityCents: "Solidaritätszuschlag",
  churchTaxCents: "Kirchensteuer",
  healthCents: "Krankenversicherung",
  careCents: "Pflegeversicherung",
  pensionCents: "Rentenversicherung",
  unemploymentCents: "Arbeitslosenversicherung",
  totalCents: "Gesamtbetrag",
  additionalNetDeductionCents: "Weitere Netto-Abzüge",
  displayName: "Name",
  employerName: "Arbeitgeber",
  federalState: "Bundesland",
  holidayRegion: "Feiertagsregion",
  weeklyMinutes: "Wochenarbeitszeit",
  timeZone: "Zeitzone",
  industry: "Branche",
  tariff: "TVöD-P",
  nursingTrainingTariff: "Ausbildungstarif",
  vkaETariff: "TVöD VKA",
  tvlKrTariff: "TV-L KR",
  tvUkNursingTariff: "TV-UK",
  tvhKrTariff: "TV-H",
  tvalPflegeTariff: "TVA-L Pflege",
  manualMonthlyGrossCents: "Manuelles Monatsbrutto",
  salaryBasisConflict: "Ungeklärte Gehaltsgrundlage",
  payGroup: "Entgeltgruppe",
  payLevel: "Stufe",
  sector: "Bereich",
  tariffRegion: "Tarifregion",
  fullTimeWeeklyMinutes: "Vollzeit-Wochenarbeitszeit",
  trainingYear: "Ausbildungsjahr",
  regularRotatingNightWork: "Regelmäßige Nachtarbeit",
  sundayHolidayWorkEligible: "Sonn- und Feiertagsarbeit",
  allEmploymentWorkRecorded: "Alle Beschäftigungszeiten erfasst",
  createdAt: "Erstellt am",
  updatedAt: "Geändert am",
  kind: "Art",
  id: "Kennung",
  date: "Datum",
  templateId: "Vorlage",
  title: "Titel",
  type: "Schichtart",
  allDay: "Ganztägig",
  startTime: "Beginn",
  endTime: "Ende",
  breakMinutes: "Pause",
  color: "Farbe",
  symbol: "Symbol",
  note: "Notiz",
  notification: "Erinnerung",
  alarmEnabled: "Wecker",
  location: "Ort",
  latitude: "Breitengrad",
  longitude: "Längengrad",
  address: "Adresse",
  name: "Name",
  overtimeMinutes: "Überstunden",
  tariffOvertimeConfirmed: "Tarifliche Überstunden bestätigt",
  holidayPremiumMode: "Feiertagsausgleich",
  revision: "Version",
  deletedAt: "Gelöscht am",
  recurrence: "Wiederholung",
  frequency: "Häufigkeit",
  interval: "Intervall",
  until: "Bis",
  unit: "Einheit",
  value: "Wert",
  direction: "Richtung",
  reference: "Bezug",
  month: "Monat",
  year: "Jahr",
  targetMinutes: "Sollzeit",
  actualMinutes: "Istzeit",
  balanceMinutes: "Saldo",
  overlapMinutes: "Überschneidungen",
  work: "Arbeit",
  training: "Fortbildung",
  vacation: "Urlaub",
  sick: "Krankheit",
  free: "Frei",
  minutes: "Zeit",
  entryCount: "Einträge",
  count: "Anzahl",
  items: "Schichtarten",
  appearances: "Darstellungen",
  totalCount: "Schichten gesamt",
  totalMinutes: "Zeit gesamt",
  tariffLabel: "Tarifstand",
  available: "Gehalt verfügbar",
  fullTimeTableAmount: "Vollzeit-Tabellenentgelt",
  personalBaseAmount: "Grundentgelt",
  shiftBreakdowns: "Zuschläge je Dienst",
  shiftId: "Dienstkennung",
  netMinutes: "Nettozeit",
  premiumLines: "Zeitzuschlagspositionen",
  key: "Schlüssel",
  label: "Bezeichnung",
  percentage: "Zuschlagssatz",
  hourlyRate: "Stundensatz",
  amount: "Betrag",
  ruleId: "Regelkennung",
  overtimeBaseAmount: "Überstunden-Grundbetrag",
  overtimePremiumAmount: "Überstundenzuschlag",
  totalAmount: "Gesamtbetrag",
  timePremiumAmount: "Zeitzuschläge",
  overtimeAmount: "Überstundenbetrag",
  allowanceAmount: "Schichtzulage",
  tvoedAllowanceAmount: "Tarifzulage",
  careAllowanceAmount: "Pflegezulage",
  estimatedGrossAmount: "Bruttoprognose",
  nightCompensatoryMinutes: "Nächtlicher Zeitausgleich",
  assessment: "Zulagenprüfung",
  estimateNote: "Schätzungsgrenze",
  shiftWork: "Schichtarbeit",
  alternatingShiftWork: "Wechselschichtarbeit",
  suggestedAllowance: "Vorgeschlagene Zulage",
  evidence: "Begründung",
  criteria: "Prüfkriterien",
  detail: "Details",
  state: "Ergebnis",
  requiresConfirmation: "Bestätigung erforderlich",
  confirmedAllowance: "Bestätigte Zulage",
  allowanceStatus: "Zulagenstatus",
  confirmedAt: "Bestätigt am",
  workplaceCoverage: "Betriebszeiten",
  assignment: "Einsatz",
  issues: "Prüfhinweise",
  severity: "Schweregrad",
  rule: "Regel",
  description: "Beschreibung",
  relatedShiftIds: "Betroffene Dienste",
  affectedDates: "Betroffene Tage",
  criticalCount: "Kritische Hinweise",
  warningCount: "Warnungen",
  infoCount: "Informationen",
  assessmentRange: "Prüfzeitraum",
  assessmentRanges: "Prüfzeiträume",
  startDate: "Von",
  endDate: "Bis",
  from: "Von",
  to: "Bis",
  status: "Status",
  reason: "Hinweis",
  months: "Monatsübersicht",
  workMinutes: "Arbeitszeit",
  trainingMinutes: "Fortbildungszeit",
  vacationDays: "Urlaubstage",
  sickDays: "Krankheitstage",
  freeDays: "Freie Tage",
  activeMonthCount: "Monate mit Einträgen",
  availablePayMonthCount: "Monate mit Gehaltsprognose",
  premiumAmount: "Zuschläge und Zulagen",
  distribution: "Schichtverteilung",
  worktimeCoverageComplete: "Arbeitszeit vollständig berechenbar",
  complianceCoverageComplete: "Prüfung vollständig berechenbar",
  complianceComplete: "Prüfung vollständig",
  checkCounts: "Hinweise nach Art",
  legal: "Arbeitszeitrecht",
  planning: "Planung und Erholung",
  info: "Informationen",
  warning: "Warnungen",
  critical: "Kritisch",
  salarySource: "Gehaltsgrundlage",
  shiftTypeAnalysis: "Schichtstatistik",
  testMonths: "Monate mit Testdaten",
  referenceDate: "Prüfstichtag",
  youthProtection: "Jugendarbeitsschutz aktiviert",
  start: "Beginn",
  end: "Ende",
};
const VALUES: Readonly<Record<string, string>> = {
  available: "Verfügbar",
  unavailable: "Nicht verfügbar",
  SHIFT: "Dienst",
  APPOINTMENT: "Termin",
  LEGAL: "Arbeitszeitrecht",
  PLANNING: "Planung und Erholung",
  critical: "Kritisch",
  warning: "Warnung",
  info: "Information",
  DETECTED: "Erkannt",
  NOT_DETECTED: "Nicht erkannt",
  REVIEW: "Prüfen",
  MET: "Erfüllt",
  OPEN: "Offen",
  NOT_MET: "Nicht erfüllt",
  UNKNOWN: "Unbekannt",
  PERMANENT: "Dauerhaft",
  TEMPORARY: "Vorübergehend",
  AROUND_THE_CLOCK: "Rund um die Uhr",
  NOT_AROUND_THE_CLOCK: "Nicht rund um die Uhr",
  NONE: "Keine",
  SHIFT_WORK: "Schichtarbeit",
  ALTERNATING_SHIFT_WORK: "Wechselschichtarbeit",
  WITH_TIME_OFF: "Mit Freizeitausgleich",
  WITHOUT_TIME_OFF: "Ohne Freizeitausgleich",
  MANUAL: "Manuell",
  TARIFF: "Tarif",
  UNSET: "Nicht eingerichtet",
  DAY: "Tag",
  WEEK: "Woche",
  MONTH: "Monat",
  YEAR: "Jahr",
  MINUTE: "Minute",
  HOUR: "Stunde",
  BEFORE: "Vorher",
  AFTER: "Nachher",
  START: "Beginn",
  END: "Ende",
};

const ENUM_FIELDS = new Set([
  "status",
  "kind",
  "severity",
  "state",
  "shiftWork",
  "alternatingShiftWork",
  "suggestedAllowance",
  "confirmedAllowance",
  "allowanceStatus",
  "workplaceCoverage",
  "assignment",
  "holidayPremiumMode",
  "salarySource",
  "frequency",
  "direction",
  "reference",
  "unit",
  "holidayRegion",
]);

export function appendReportData(
  rows: ReportRow[],
  section: string,
  period: string,
  record: string,
  data: unknown,
  path = "",
): void {
  const part = path.split(".").at(-1) ?? "";
  if (data instanceof Map) {
    appendReportData(rows, section, period, record, Object.fromEntries(data), path);
    return;
  }
  if (data !== null && typeof data === "object" && Object.keys(data).length > 0) {
    for (const [key, value] of Object.entries(data)) {
      appendReportData(rows, section, period, record, value, path ? `${path}.${key}` : key);
    }
    return;
  }
  let unit = "";
  let value: string;
  if (data === null || data === undefined)
    value = ["Gehaltsprognose", "Netto-Prognose", "Jahresauswertung", "Arbeitszeit"].includes(
      section,
    )
      ? "Nicht verfügbar"
      : "Nicht hinterlegt";
  else if (typeof data === "boolean") value = data ? "Ja" : "Nein";
  else if (typeof data === "number") {
    const cents = part.endsWith("Cents");
    unit =
      cents ||
      part.endsWith("Amount") ||
      (part === "amount" && !path.startsWith("notification.")) ||
      part === "hourlyRate"
        ? "EUR"
        : part.toLowerCase().endsWith("minutes")
          ? "Minuten"
          : part === "percentage"
            ? "%"
            : "";
    value = Number.isFinite(data)
      ? String(cents ? data / 100 : data).replace(".", ",")
      : "Nicht verfügbar";
  } else if (typeof data === "string") {
    value =
      part === "type"
        ? (SHIFT_TYPE_LABELS[data as ShiftType] ?? data)
        : ENUM_FIELDS.has(part)
          ? (VALUES[data] ?? data)
          : data;
  } else value = "Keine";
  const label = path
    .split(".")
    .map((key) =>
      /^\d+$/.test(key)
        ? String(Number(key) + 1)
        : (LABELS[key] ?? SHIFT_TYPE_LABELS[key as ShiftType] ?? key),
    )
    .join(" · ");
  rows.push({ section, period, record, field: path, label, value, unit });
}
