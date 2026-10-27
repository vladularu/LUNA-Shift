import { describe, expect, it, vi } from "vitest";
import type { CalendarEntry, ShiftEntry, UserProfile } from "@/domain/types";
import { bundledRuleResolver, RuleResolutionError, type RuleResolver } from "@/rules/rule-resolver";
import { buildReportSteps, type ReportInput } from "./report-data";
import {
  appendReportData,
  type ReportDocument,
  type ReportEntry,
  type ReportRow,
} from "./report-document";
import { reportEntries } from "./report-entry-data";
import { reportToCsv, reportToHtml } from "./report-formats";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { MonthlyNetPaySettings, SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { calculateMonthlyAnalysis } from "@/features/analysis/monthly-analysis";
import { annualSalaryForecast } from "@/features/salary/annual-salary-forecast";
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
  it("includes the unsaved tariff forecast consistently in monthly gross, net and the annual total", () => {
    const base = input({
      profile: forecastProfile,
      entries: [],
      period: "2026-11",
      netPayTimeline: [savedNet(automatedSettings("2026-01"))],
    });
    const annual = annualSalaryForecast(2026, base.profile, {
      ...base,
      resolver: base.ruleResolver,
    });
    const monthly = build(base);
    const yearly = build({ ...base, period: "2026" });
    const bonus = String(annual.proposal!.grossCents / 100).replace(".", ",");
    expect(value(monthly, "Gehaltsprognose", "annualPaymentAmount", "2026-11")).toBe(bonus);
    expect(value(yearly, "Gehaltsprognose", "annualPaymentAmount", "2026-11")).toBe(bonus);
    expect(value(yearly, "Jahresauswertung", "annualPaymentAmount", "2026")).toBe(bonus);
    expect(value(monthly, "Netto-Prognose", "annualPayment.netIncluded", "2026-11")).toBe("Ja");
    expect(reportToHtml(monthly)).toContain("Jahressonderzahlung");
    expect(value(yearly, "Gehaltsprognose", "annualPaymentAmount", "2026-12")).toBeUndefined();
  });

  it.each<readonly [string, UserProfile, number]>([
    [
      "TVAöD",
      {
        ...forecastProfile,
        tariff: null,
        nursingTrainingTariff: { trainingYear: 3, sector: "BT_K", tariffRegion: "OTHER" },
      },
      148804,
    ],
    [
      "TVA-L",
      {
        ...forecastProfile,
        tariff: null,
        tvalPflegeTariff: {
          trainingYear: 3,
          universityRegion: "WEST",
          employerScope: "SECTION_43",
        },
      },
      153235,
    ],
  ])(
    "uses the corrected automatic %s amount in monthly and annual exports after clearing own pay",
    (_, selected, expected) => {
      const initial = automatedSettings("2026-01");
      const base = input({
        profile: selected,
        entries: [],
        period: "2026-11",
        netPayTimeline: [savedNet(initial)],
      });
      const monthly = build(base),
        yearly = build({ ...base, period: "2026" });
      const valueText = String(expected / 100).replace(".", ",");
      expect(value(monthly, "Gehaltsprognose", "annualPaymentAmount", "2026-11")).toBe(valueText);
      expect(value(yearly, "Jahresauswertung", "annualPaymentAmount", "2026")).toBe(valueText);
      expect(value(monthly, "Netto-Prognose", "annualPayment.netIncluded", "2026-11")).toBe("Ja");
      expect(reportToHtml(monthly)).not.toContain("3.818,16");
      expect(reportToHtml(yearly)).not.toContain("3.818,16");
    },
  );
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
    expect(reportToCsv(report)).not.toContain('"Netto-Prognose"');
    expect(reportToHtml(report)).toContain("Netto geschätzt");
    expect(reportToHtml(report)).toContain("Steuern");
  });
  it("enthält bestätigte Sonderzahlungen im Monatsbrutto und kennzeichnet fehlende Jahresgrundlagen im PDF", () => {
    const initial = automatedSettings(period);
    const withBonus = {
      ...initial,
      automation: {
        ...initial.automation!,
        annualPayments: [{ revision: 1, payoutMonth: period, grossCents: 360_000, netBasis: null }],
      },
    };
    const baseline = build(netInput);
    const data = { ...netInput, netPayTimeline: [savedNet(withBonus)] };
    const actual = build(data);
    const gross = (document: ReportDocument) =>
      Number(value(document, "Gehaltsprognose", "estimatedGrossAmount", period)?.replace(",", "."));
    expect(Math.round((gross(actual) - gross(baseline)) * 100)).toBe(360_000);
    expect(reportToHtml(actual)).toContain("Netto ohne Sonderzahlung");
    expect(reportToHtml(actual)).toContain("Jahresgrundlagen ergänzen");
    expect(
      value(
        build({ ...data, period: "2026" }),
        "Jahresauswertung",
        "availableNetMonthCount",
        "2026",
      ),
    ).toBe("5");
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
  const entry: ReportEntry = {
    date: "2026-08-03",
    title: 'Übung; "Team"\nZeile 2',
    kind: "APPOINTMENT",
    typeLabel: "Termin",
    color: "#123456",
    allDay: false,
    startTime: "08:00",
    endTime: "16:00",
    nextDay: false,
    breakMinutes: null,
    durationMinutes: 480,
    creditMinutes: null,
  };
  const report: ReportDocument = {
    period: "2026-08",
    createdAt: "2026-08-15",
    rows,
    entries: [entry],
  };
  it("nutzt BOM, Semikolon, CRLF, deutsche Zahlen und korrektes Quoting", () => {
    const csv = reportToCsv(report);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Übung; ""Team""\nZeile 2"');
    expect(csv).toContain('"8,00"');
    expect(csv).toContain("\r\n");
    expect(csv).not.toContain("Nicht hinterlegt");
    expect(csv).not.toContain("Schlüssel");
  });
  it.each(["=1+1", "+SUM(1)", "@SUM(1)", "-cmd", "\t=1", "\r@SUM(1)"])(
    "neutralisiert Excel-Formeln %s",
    (text) => {
      const dangerous: ReportRow[] = [];
      appendReportData(dangerous, text, "2026-08", text, { note: text });
      expect(
        reportToCsv({ ...report, rows: dangerous, entries: [{ ...entry, title: text }] }),
      ).toContain(`"'${text}"`);
    },
  );
  it("escaped sämtliche Nutzereingaben im offlinefähigen PDF-HTML", () => {
    const output = reportToHtml({
      ...report,
      entries: [{ ...entry, title: '<script>alert("x")</script>' }, entry],
    });
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>");
    expect(output).toContain("Übung; &quot;Team&quot;");
    expect(output).not.toContain("Schlüssel");
    expect(output).toContain("Nicht verfügbar");
    expect(output).toContain("Keine Lohnabrechnung");
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
  it("grenzt Standard, Kompakt und Gehalt ab, ohne technische oder abgeschaltete Daten auszugeben", () => {
    const report = build();
    const standard = reportToHtml(report);
    const compact = reportToHtml(report, { layout: "compact", includeSalary: true });
    const privateReport = reportToHtml(report, { layout: "standard", includeSalary: false });
    expect(standard.match(/<article /g)).toHaveLength(2);
    expect(compact.match(/<article /g)).toHaveLength(1);
    expect(compact).toContain("Dein Monatsplan");
    expect(privateReport).not.toContain("Gehaltsprognose");
    expect(privateReport).not.toContain("5.000,00");
    expect(privateReport).not.toContain("Grundgehalt");
    expect(standard).not.toContain("createdAt");
    expect(standard).not.toContain("shiftBreakdowns");
    expect(standard).not.toContain("Übergabe; Zimmer 2");
  });
  it("exportiert eine CSV-Zeile pro Eintrag und trennt Urlaubsgutschriften von Dienstzeiten", () => {
    const report = build({
      entries: [
        shift("work", "2026-08-03"),
        shift("vacation", "2026-08-05", {
          type: "VACATION",
          startTime: null,
          endTime: null,
          breakMinutes: 0,
        }),
      ],
    });
    const csv = reportToCsv(report);
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    expect(report.entries?.find((entry) => entry.date === "2026-08-05")?.creditMinutes).toBe(462);
    expect(csv).toContain('"7,50";""');
    expect(csv).toContain('"";"7,70"');
    expect(csv).not.toContain("Netto");
    expect(csv).not.toContain('"revision"');
  });
  it("verwendet die echte Zeitumstellung und kennzeichnet das Ende am Folgetag", () => {
    const entries = reportEntries(
      [shift("night", "2026-10-24", { type: "NIGHT", startTime: "22:00", endTime: "06:00" })],
      profile,
      bundledRuleResolver,
    );
    expect(entries[0].durationMinutes).toBe(510);
    expect(entries[0].nextDay).toBe(true);
    expect(
      reportToCsv({ period: "2026-10", createdAt: "2026-10-12", rows: [], entries }),
    ).toContain('"Ja";"30";"8,50"');
  });
  it("vergibt die Tagesgutschrift bei mehrfachen Abwesenheiten nur einmal", () => {
    const entries = reportEntries(
      [
        shift("vacation", "2026-08-05", { type: "VACATION", startTime: null, endTime: null }),
        shift("sick", "2026-08-05", { type: "SICK", startTime: null, endTime: null }),
        shift("sick2", "2026-08-05", { type: "SICK", startTime: null, endTime: null }),
      ],
      profile,
      bundledRuleResolver,
    );
    expect(entries.map((entry) => entry.creditMinutes)).toEqual([0, 462, 0]);
  });
  it("begrenzt volle Monate auf drei PDF-Seiten und erhält alle CSV-Einträge", () => {
    const report = build();
    const first = report.entries![0];
    const sixty = { ...report, entries: Array.from({ length: 60 }, () => first) };
    expect(reportToHtml(sixty).match(/<article /g)).toHaveLength(3);
    const crowded = { ...report, entries: [...sixty.entries, first] };
    expect(reportToHtml(crowded).match(/<article /g)).toHaveLength(2);
    expect(reportToHtml(crowded)).toContain("PDF tagesweise verdichtet");
    expect(reportToCsv(crowded).trim().split("\r\n")).toHaveLength(62);
  });
  it("zeigt zwölf Monatszeilen und kennzeichnet nur teilweise verfügbare Jahresprognosen", () => {
    const report = build({ period: "2026" });
    const output = reportToHtml(report, { layout: "compact", includeSalary: true });
    expect(output.match(/<article /g)).toHaveLength(1);
    expect(output).toContain("Zwölf Monate im Überblick");
    expect(output).toContain("Brutto: 12/12 Monate verfügbar");
    expect(output).toContain("Netto: 0/12 Monate verfügbar");
    expect(output).toContain("Nicht verfügbar");
    expect(output).not.toContain("Netto-Grundlagen");
  });
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
    expect(output).toContain("Erfasste Kontozeit");
    expect(output).toContain("7:30 h");
    expect(output).not.toContain("<h2>Profil");
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

describe("PDF und App mit gleicher Bedeutung", () => {
  function netPresentationReport(period: string): ReportDocument {
    const rows: ReportRow[] = [];
    const month = period.length === 4 ? `${period}-01` : period;
    const year = Number(period.slice(0, 4));
    appendReportData(rows, "Netto-Prognose", month, "Netto", {
      result: {
        status: "available",
        pay: {
          netCents: 314152,
          calculationBasis: {
            payrollYear: year,
            rulesYear: 2026,
            status: year === 2027 ? "PREVIOUS_YEAR_ESTIMATE" : "VERIFIED",
          },
        },
      },
    });
    if (period.length === 4)
      appendReportData(rows, "Jahresauswertung", period, "Netto", {
        netCents: 314152,
        availableNetMonthCount: 1,
      });
    return { period, rows, createdAt: "2026-10-15", entries: [] };
  }

  it.each(["2027-01", "2027"])(
    "bewahrt Vorläufigkeit, Regelstand und angemessene Netto-Genauigkeit für %s",
    (period) => {
      const report = netPresentationReport(period);
      for (const layout of ["standard", "compact"] as const) {
        const output = reportToHtml(report, { layout, includeSalary: true });
        expect(output).toContain("2027 vorläufig · Abzüge nach Stand 2026");
        expect(output).toContain("3.140 €");
        expect(output).not.toContain("3.141,52");
        expect(reportToHtml(report, { layout, includeSalary: false })).not.toContain(
          "2027 vorläufig",
        );
      }
      expect(value(report, "Netto-Prognose", "result.pay.netCents", "2027-01")).toBe("3141,52");
    },
  );

  it("zeigt ein verifiziertes Netto weiter centgenau ohne Vorjahreshinweis", () => {
    const output = reportToHtml(netPresentationReport("2026-01"));
    expect(output).toContain("3.141,52 €");
    expect(output).not.toContain("vorläufig");
  });

  it.each(["2026-08", "2026"])(
    "trennt fehlende Prüfgrundlagen von Warnungen im Bericht %s",
    (period) => {
      const report = build({
        period,
        profile: { ...profile, allEmploymentWorkRecorded: null },
      });
      const section = period.length === 4 ? "Jahresauswertung" : "Auswertung";
      expect(value(report, section, "warningCount", period)).toBe("0");
      expect(Number(value(report, section, "prerequisiteCount", period))).toBeGreaterThan(0);
      const output = reportToHtml(report);
      expect(output).toContain("Prüfgrundlagen unvollständig");
      expect(output).not.toContain("Arbeitszeiten aus allen Jobs erfasst?");
    },
  );

  it("erhält alle Planungshinweise und macht den vollständigen PDF-Prüfumfang sichtbar", () => {
    const report = build({
      entries: Array.from({ length: 7 }, (_, i) =>
        shift(`day-${i}`, `2026-08-${String(i + 3).padStart(2, "0")}`),
      ),
    });
    expect(
      report.rows.some(
        (row) => /^issues\.\d+\.rule$/.test(row.field) && row.value === "PLANNING_7_DAYS",
      ),
    ).toBe(true);
    expect(reportToHtml(report)).toContain(
      "Arbeitszeitregeln und alle Planungshinweise – auch in der App ausgeblendete.",
    );
  });
});
