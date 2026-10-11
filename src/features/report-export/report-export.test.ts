import { describe, expect, it, vi } from "vitest";
import type { CalendarEntry, ShiftEntry, UserProfile } from "@/domain/types";
import { bundledRuleResolver, RuleResolutionError, type RuleResolver } from "@/rules/rule-resolver";
import { buildReportSteps, type ReportInput } from "./report-data";
import { appendReportData, type ReportDocument, type ReportRow } from "./report-document";
import { reportToCsv, reportToHtml } from "./report-formats";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { MonthlyNetPaySettings, SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { calculateMonthlyAnalysis } from "@/features/analysis/monthly-analysis";
vi.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (compute: () => unknown) => {
    try {
      return { ok: true, value: compute() };
    } catch (error) {
      if (!(error instanceof RuleResolutionError)) throw error;
      return { ok: false, error, failure: error.failure };
    }
  },
}));

const profile: UserProfile = {
  displayName: "Müller",
  employerName: "Klinik",
  federalState: "NW",
  holidayRegion: "NONE",
  weeklyMinutes: 2310,
  timeZone: "Europe/Berlin",
  regularRotatingNightWork: false,
  sundayHolidayWorkEligible: true,
  allEmploymentWorkRecorded: true,
  tariff: null,
  manualMonthlyGrossCents: 500000,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
function shift(id: string, date: string, extra: Partial<ShiftEntry> = {}): ShiftEntry {
  return {
    kind: "SHIFT",
    id,
    date,
    title: "Frühdienst",
    type: "EARLY",
    templateId: null,
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 30,
    overtimeMinutes: 0,
    color: "#123456",
    symbol: "F",
    note: "Übergabe; Zimmer 2",
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    deletedAt: null,
    ...extra,
  };
}
function input(extra: Partial<ReportInput> = {}): ReportInput {
  return {
    period: "2026-08",
    entries: [shift("a", "2026-08-03")],
    profile,
    tariffDecisions: [],
    workPatternSettings: { assignment: "UNKNOWN", workplaceCoverage: "UNKNOWN", updatedAt: null },
    ruleResolver: bundledRuleResolver,
    createdAt: "2026-08-15T12:00:00+02:00",
    referenceDate: "2026-08-15",
    youthProtection: false,
    testMonths: [],
    ...extra,
  };
}
function build(extra: Partial<ReportInput> = {}): ReportDocument {
  const steps = buildReportSteps(input(extra));
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
function value(report: ReportDocument, section: string, field: string, period = "2026-08") {
  return report.rows.find(
    (row) => row.section === section && row.field === field && row.period === period,
  )?.value;
}

function savedNet(settings: MonthlyNetPaySettings): SavedMonthlyNetPaySettings {
  return { settings, revision: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
}

describe("Netto im gemeinsamen PDF-/CSV-Bericht", () => {
  const period = "2026-07";
  const netInput = {
    period,
    profile: forecastProfile,
    entries: [forecastShift()],
    tariffDecisions: [
      {
        month: period,
        allowanceStatus: "NONE" as const,
        revision: 1,
        confirmedAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    netPayTimeline: [savedNet(automatedSettings(period))],
  };
  it("exportiert identische Netto-Beträge, Steuerabzüge und Zuschlagsdaten wie die App", () => {
    const data = input(netInput);
    const monthly = calculateMonthlyAnalysis(
      period,
      data.entries,
      data.profile,
      data.tariffDecisions,
      data.workPatternSettings,
      data.ruleResolver,
    );
    if (!monthly.pay.ok) throw new Error("Brutto-Basis fehlt");
    const expected = calculateAutomaticNetPayForecast(
      {
        month: period,
        profile: data.profile,
        settings: data.netPayTimeline![0].settings,
        shifts: monthly.monthShifts,
        pay: monthly.pay.value,
      },
      data.ruleResolver,
    );
    if (expected.result.status !== "available") throw new Error(expected.result.reason);
    const report = build(netInput);
    expect(value(report, "Netto-Prognose", "result.pay.netCents", period)).toBe(
      String(expected.result.pay.netCents / 100).replace(".", ","),
    );
    expect(value(report, "Netto-Prognose", "result.pay.tax.wageTaxCents", period)).toBe(
      String(expected.result.pay.tax.wageTaxCents / 100).replace(".", ","),
    );
    expect(value(report, "Netto-Grundlagen", "settings.profile.taxClass", period)).toBe("1");
    expect(reportToCsv(report)).toContain('"Netto-Prognose"');
    expect(reportToHtml(report)).toContain("Netto-Prognose");
    expect(reportToHtml(report)).toContain("Lohnsteuer");
  });
  it("verwendet eine neue datierte Netto-Konfiguration erst ab ihrem Gültigkeitsmonat", () => {
    const first = automatedSettings("2026-01");
    const second = {
      ...automatedSettings("2026-08"),
      profile: { ...first.profile, taxClass: 3 as const },
    };
    const timeline = [savedNet(second), savedNet(first)];
    expect(
      value(
        build({ ...netInput, netPayTimeline: timeline }),
        "Netto-Grundlagen",
        "settings.profile.taxClass",
        period,
      ),
    ).toBe("1");
    expect(
      value(
        build({ ...netInput, period: "2026-08", netPayTimeline: timeline }),
        "Netto-Grundlagen",
        "settings.profile.taxClass",
      ),
    ).toBe("3");
  });
  it("weist fehlende oder nur zukünftige Netto-Angaben ohne Nullbetrag aus", () => {
    for (const netPayTimeline of [[], [savedNet(automatedSettings("2026-09"))]]) {
      const report = build({ ...netInput, netPayTimeline });
      expect(value(report, "Netto-Prognose", "netCents", period)).toBe("Nicht verfügbar");
      expect(value(report, "Netto-Prognose", "status", period)).toBe("Nicht verfügbar");
    }
  });
  it("bewahrt den Grund einer nicht unterstützten Netto-Berechnung", () => {
    const settings = { ...automatedSettings(period), specialCases: ["PRIVATE_INSURANCE" as const] };
    const report = build({ ...netInput, netPayTimeline: [savedNet(settings)] });
    expect(value(report, "Netto-Prognose", "result.status", period)).toBe("Nicht verfügbar");
    expect(value(report, "Netto-Prognose", "result.reason", period)).toBeTruthy();
    expect(value(report, "Netto-Prognose", "netCents", period)).toBe("Nicht verfügbar");
  });
  it("summiert im Jahr nur verfügbare Netto-Monate und nennt die Abdeckung", () => {
    const report = build({ ...netInput, period: "2026" });
    const netRows = report.rows.filter(
      (row) => row.section === "Netto-Prognose" && row.field === "result.pay.netCents",
    );
    expect(netRows).toHaveLength(6);
    expect(value(report, "Jahresauswertung", "availableNetMonthCount", "2026")).toBe("6");
    const expected =
      Math.round(netRows.reduce((sum, row) => sum + Number(row.value.replace(",", ".")), 0) * 100) /
      100;
    expect(value(report, "Jahresauswertung", "netCents", "2026")).toBe(
      String(expected).replace(".", ","),
    );
    expect(
      report.rows.find((row) => row.record === "Netto-Prognose" && row.field === "reason")?.value,
    ).toContain("6 von 12 Monaten");
  });
  it("zeigt bei einem Jahr ohne Netto-Grundlagen keine erfundene Jahressumme", () => {
    const report = build({ ...netInput, period: "2026", netPayTimeline: [] });
    expect(value(report, "Jahresauswertung", "netCents", "2026")).toBe("Nicht verfügbar");
    expect(value(report, "Jahresauswertung", "availableNetMonthCount", "2026")).toBe("0");
  });
});

describe("vollständige Berichtsdaten", () => {
  it("enthält Arbeitszeit, Profil, Prognose und sämtliche gespeicherten Dienstfelder", () => {
    const entry = shift("a", "2026-08-03", {
      location: { name: "Klinik", address: "Straße 2", latitude: 51, longitude: 7 },
    });
    const report = build({ entries: [entry] });
    expect(value(report, "Arbeitszeit", "actualMinutes")).toBe("450");
    expect(value(report, "Gehaltsprognose", "estimatedGrossAmount")).toBe("5000");
    expect(value(report, "Profil", "displayName")).toBe("Müller");
    expect(value(report, "Dienste und Abwesenheiten", "location.address")).toBe("Straße 2");
    expect(value(report, "Dienste und Abwesenheiten", "note")).toBe("Übergabe; Zimmer 2");
    expect(
      report.rows
        .filter((row) => row.section === "Dienste und Abwesenheiten")
        .map((row) => row.field),
    ).toEqual(expect.arrayContaining(Object.keys(entry).filter((key) => key !== "location")));
  });
  it("exportiert Termine und Abwesenheiten, aber keine gelöschten oder fremden Monatseinträge", () => {
    const appointment: CalendarEntry = {
      ...shift("termin", "2026-08-03"),
      kind: "APPOINTMENT",
      allDay: false,
      title: "Besprechung",
      recurrence: { frequency: "WEEK", interval: 1 },
    };
    const report = build({
      entries: [
        shift("deleted", "2026-08-04", { deletedAt: "2026-08-05" }),
        shift("other", "2026-07-31"),
        shift("vacation", "2026-08-05", {
          type: "VACATION",
          startTime: null,
          endTime: null,
          breakMinutes: 0,
        }),
        appointment,
      ],
    });
    expect(value(report, "Termine", "recurrence.frequency")).toBe("Woche");
    expect(value(report, "Dienste und Abwesenheiten", "type")).toBe("Urlaub");
    expect(
      report.rows.some(
        (row) => row.record.endsWith(" · deleted") || row.record.endsWith(" · other"),
      ),
    ).toBe(false);
  });
  it("enthält sämtliche Prüfhinweise auch bei kritischen Schichten", () => {
    const report = build({
      entries: [
        shift("long", "2026-08-03", { startTime: "06:00", endTime: "22:00", breakMinutes: 0 }),
      ],
    });
    expect(Number(value(report, "Auswertung", "criticalCount"))).toBeGreaterThan(0);
    expect(
      report.rows.some(
        (row) =>
          row.section === "Auswertung" &&
          row.field.startsWith("issues.") &&
          row.field.endsWith(".description"),
      ),
    ).toBe(true);
  });
  it("enthält Tarifgrundlagen, Zuschlagspositionen und Zulagenprüfung", () => {
    const report = build({
      profile: {
        ...profile,
        manualMonthlyGrossCents: null,
        tariff: {
          payGroup: "P8",
          payLevel: 4,
          sector: "BT_K",
          tariffRegion: "OTHER",
          fullTimeWeeklyMinutes: 2310,
        },
      },
      entries: [
        shift("night", "2026-08-03", { type: "NIGHT", startTime: "22:00", endTime: "06:00" }),
      ],
    });
    expect(
      Number(value(report, "Gehaltsprognose", "timePremiumAmount")?.replace(",", ".")),
    ).toBeGreaterThan(0);
    expect(report.rows.some((row) => row.field === "shiftBreakdowns.0.premiumLines.0.amount")).toBe(
      true,
    );
    expect(report.rows.some((row) => row.field.startsWith("assessment.criteria."))).toBe(true);
  });
  it("zeigt fehlende Gehaltsgrundlagen explizit statt null Euro", () => {
    const report = build({ profile: { ...profile, manualMonthlyGrossCents: null } });
    expect(value(report, "Gehaltsprognose", "status")).toBe("Nicht verfügbar");
    expect(value(report, "Gehaltsprognose", "estimatedGrossAmount")).toBe("Nicht verfügbar");
  });
  it("bleibt bei fehlenden Regeln exportierbar und kennzeichnet die Grenzen", () => {
    const missing: RuleResolver = {
      ...bundledRuleResolver,
      resolveHoliday: (date) => ({
        ok: false,
        error: {
          code: "RULE_PACKAGE_NOT_FOUND",
          kind: "HOLIDAY",
          packageId: "missing",
          effectiveDate: date,
          message: "Feiertagsstand fehlt",
        },
      }),
    };
    const report = build({ ruleResolver: missing });
    expect(value(report, "Arbeitszeit", "status")).toBe("Nicht verfügbar");
    expect(value(report, "Auswertung", "status")).toBe("Nicht verfügbar");
    expect(value(report, "Dienste und Abwesenheiten", "id")).toBe("a");
    expect(value(report, "Schichtstatistik", "totalMinutes")).toBe("450");
  });
  it("exportiert zwölf Monate mit Jahresübersicht und markiert Testdaten", () => {
    const report = build({ period: "2026", testMonths: ["2026-08", "2025-08"] });
    expect(
      new Set(
        report.rows.filter((row) => row.section === "Gehaltsprognose").map((row) => row.period),
      ).size,
    ).toBe(12);
    expect(value(report, "Jahresauswertung", "estimatedGrossAmount", "2026")).toBe("60000");
    expect(value(report, "Bericht", "testMonths.0", "2026")).toBe("2026-08");
    expect(report.rows.some((row) => row.value === "2025-08")).toBe(false);
  });
  it.each(["2026-00", "2026-13", "2026-08-03", "1899", "abcd"])(
    "weist ungültigen Zeitraum %s zurück",
    (period) => {
      expect(() => build({ period })).toThrow();
    },
  );
});

describe("PDF und CSV aus demselben Datenbestand", () => {
  const rows: ReportRow[] = [];
  appendReportData(rows, "Termine", "2026-08", "Termin", {
    title: 'Übung; "Team"\nZeile 2',
    note: '<script>alert("x")</script>',
    amount: 12.5,
    balanceMinutes: -30,
    special: "=HYPERLINK(1)",
    blank: null,
  });
  const report: ReportDocument = { period: "2026-08", createdAt: "2026-08-15", rows };
  it("nutzt BOM, Semikolon, CRLF, deutsche Zahlen und korrektes Quoting", () => {
    const csv = reportToCsv(report);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Übung; ""Team""\nZeile 2"');
    expect(csv).toContain('"12,5";"EUR"');
    expect(csv).toContain('"-30";"Minuten"');
    expect(csv).toContain("\r\n");
    expect(csv).toContain("Nicht hinterlegt");
  });
  it.each(["=1+1", "+SUM(1)", "@SUM(1)", "-cmd", "\t=1", "\r@SUM(1)"])(
    "neutralisiert Excel-Formeln %s",
    (text) => {
      const dangerous: ReportRow[] = [];
      appendReportData(dangerous, text, "2026-08", text, { note: text });
      expect(reportToCsv({ ...report, rows: dangerous })).toContain(`"'${text}"`);
    },
  );
  it("escaped sämtliche Nutzereingaben im offlinefähigen PDF-HTML", () => {
    const output = reportToHtml(report);
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>");
    expect(output).toContain("Übung; &quot;Team&quot;");
    expect(output).toContain("12,5");
    expect(output).toContain("Nicht hinterlegt");
    expect(output).toContain("keine Lohnabrechnung");
    expect(output).toContain("table-header-group");
    expect(output).not.toContain("https://");
  });
  it("erhält verschachtelte Listen, Karten, leere Listen und Nullwerte", () => {
    const nested: ReportRow[] = [];
    appendReportData(nested, "Details", "2026", "Datensatz", {
      distribution: new Map([["NIGHT", 3]]),
      items: [{ amount: 5.25 }],
      empty: [],
      unknown: null,
    });
    expect(nested.map((row) => [row.field, row.value])).toEqual([
      ["distribution.NIGHT", "3"],
      ["items.0.amount", "5,25"],
      ["empty", "Keine"],
      ["unknown", "Nicht hinterlegt"],
    ]);
  });
});
describe("Grenzen und Vollständigkeit", () => {
  it("kennzeichnet fehlendes Jahresgehalt und Zulagen statt unbekannte Werte auf null Euro zu setzen", () => {
    const report = build({
      period: "2026",
      profile: { ...profile, manualMonthlyGrossCents: null },
    });
    expect(value(report, "Jahresauswertung", "estimatedGrossAmount", "2026")).toBe(
      "Nicht verfügbar",
    );
    expect(value(report, "Jahresauswertung", "premiumAmount", "2026")).toBe("Nicht verfügbar");
    expect(value(report, "Jahresauswertung", "availablePayMonthCount", "2026")).toBe("0");
    expect(value(report, "Gehaltsprognose", "timePremiumAmount")).toBe("Nicht verfügbar");
  });
  it("übersetzt keine Namen, Titel oder Notizen, die zufällig einem internen Schlüssel entsprechen", () => {
    const rows: ReportRow[] = [];
    appendReportData(rows, "Dienste und Abwesenheiten", "2026-08", "Dienst", {
      title: "SHIFT",
      note: "NONE",
      name: "UNKNOWN",
      notification: { amount: 30, unit: "MINUTE", direction: "BEFORE", reference: "START" },
    });
    expect(rows.find((row) => row.field === "title")?.value).toBe("SHIFT");
    expect(rows.find((row) => row.field === "note")?.value).toBe("NONE");
    expect(rows.find((row) => row.field === "name")?.value).toBe("UNKNOWN");
    expect(rows.find((row) => row.field === "notification.amount")?.unit).toBe("");
    expect(rows.find((row) => row.field === "notification.unit")?.value).toBe("Minute");
  });
  it("stellt Arbeitszeiten in der PDF-Zusammenfassung als Stunden und Minuten dar", () => {
    const output = reportToHtml(build());
    expect(output).toContain("<h2>Zusammenfassung</h2>");
    expect(output).toContain("7:30 h");
    expect(output.indexOf("<h2>Zusammenfassung</h2>")).toBeLessThan(output.indexOf("<h2>Profil"));
  });
  it("exportiert Zulagenbestätigungen und leere Monate ohne Einträge zu erfinden", () => {
    const report = build({
      entries: [],
      tariffDecisions: [
        {
          month: "2026-08",
          allowanceStatus: "NONE",
          revision: 1,
          confirmedAt: "2026-08-01",
          updatedAt: "2026-08-01",
        },
      ],
    });
    expect(value(report, "Tarifbestätigung", "allowanceStatus")).toBe("Keine");
    expect(value(report, "Kalendereinträge", "status")).toBe("Keine Einträge");
    expect(value(report, "Gehaltsprognose", "estimatedGrossAmount")).toBe("5000");
  });
});
