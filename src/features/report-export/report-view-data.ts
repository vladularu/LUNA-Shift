import type { ReportDocument, ReportEntry } from "./report-document";

export const REPORT_MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
export const REPORT_WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function reportView(report: ReportDocument) {
  const index = new Map<string, string>();
  for (const row of report.rows) {
    const key = `${row.section}/${row.period}/${row.field}`;
    if (!index.has(key)) index.set(key, row.value);
  }
  const text = (section: string, field: string, period = report.period) =>
    index.get(`${section}/${period}/${field}`) ?? "";
  const number = (section: string, field: string, period = report.period): number | null => {
    const value = text(section, field, period);
    const parsed = value.trim() ? Number(value.replace(",", ".")) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const annual = report.period.length === 4;
  const periods = annual
    ? REPORT_MONTH_NAMES.map((_, i) => `${report.period}-${String(i + 1).padStart(2, "0")}`)
    : [report.period];
  const monthly = periods.map((period) => ({
    period,
    target: number("Arbeitszeit", "targetMinutes", period),
    actual: number("Arbeitszeit", "actualMinutes", period),
    balance: number("Arbeitszeit", "balanceMinutes", period),
    gross: number("Gehaltsprognose", "estimatedGrossAmount", period),
    net:
      number("Netto-Prognose", "result.pay.netCents", period) ??
      number("Netto-Prognose", "netCents", period),
  }));
  const section = annual ? "Jahresauswertung" : "Arbeitszeit";
  const completeTime = !annual || text(section, "worktimeCoverageComplete") !== "Nein";
  const sum = (values: readonly (number | null)[]) =>
    values.every((v) => v !== null)
      ? Math.round(values.reduce<number>((total, v) => total + (v ?? 0), 0) * 100) / 100
      : null;
  const categories = [
    { label: "Dienste", field: "work", credit: false },
    { label: "Schule / Fortbildung", field: "training", credit: false },
    { label: "Urlaub", field: "vacation", credit: true },
    { label: "Krankheit", field: "sick", credit: true },
  ].map((item) => ({
    ...item,
    minutes: sum(periods.map((period) => number("Arbeitszeit", `${item.field}.minutes`, period))),
    count: sum(periods.map((period) => number("Arbeitszeit", `${item.field}.entryCount`, period))),
  }));
  const salarySection = annual ? "Jahresauswertung" : "Gehaltsprognose";
  const warnings = number("Auswertung", "warningCount");
  const critical = number("Auswertung", "criticalCount");
  const issues = report.rows
    .filter(
      (row) =>
        row.section === "Auswertung" &&
        row.period === report.period &&
        /^issues\.\d+\.title$/.test(row.field),
    )
    .slice(0, 2)
    .map((row) => {
      const prefix = row.field.replace(/\.title$/, "");
      const date = text("Auswertung", `${prefix}.date`);
      const kind = text("Auswertung", `${prefix}.kind`);
      return `${date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.: ` : ""}${row.value}${kind === "Planung und Erholung" ? " (Planungshinweis)" : ""}`;
    });
  return {
    annual,
    monthly,
    categories,
    text,
    number,
    title: annual
      ? report.period
      : `${REPORT_MONTH_NAMES[Number(report.period.slice(5, 7)) - 1]} ${report.period.slice(0, 4)}`,
    name: text("Profil", "displayName"),
    employer: text("Profil", "employerName"),
    referenceDate: text("Bericht", "referenceDate") || report.createdAt.slice(0, 10),
    target: completeTime ? number(section, "targetMinutes") : null,
    actual: completeTime ? number(section, "actualMinutes") : null,
    balance: completeTime ? number(section, "balanceMinutes") : null,
    gross: number(salarySection, "estimatedGrossAmount"),
    net: annual ? number("Jahresauswertung", "netCents") : monthly[0].net,
    base: annual ? null : number("Gehaltsprognose", "personalBaseAmount"),
    allowances: annual
      ? null
      : sum(
          ["allowanceAmount", "tvoedAllowanceAmount", "careAllowanceAmount"].map((field) =>
            number("Gehaltsprognose", field),
          ),
        ),
    premiums: number(salarySection, annual ? "premiumAmount" : "timePremiumAmount"),
    overtime: number(salarySection, "overtimeAmount"),
    tax: annual
      ? null
      : sum(
          ["wageTaxCents", "solidarityCents", "churchTaxCents"].map((field) =>
            number("Netto-Prognose", `result.pay.tax.${field}`),
          ),
        ),
    insurance: annual ? null : number("Netto-Prognose", "result.pay.socialInsurance.totalCents"),
    pension: annual ? null : number("Netto-Prognose", "result.pay.pension.employeeCents"),
    pensionOmitted:
      text("Netto-Prognose", "result.pay.pensionOmitted") === "Ja" ||
      text("Netto-Prognose", "pensionOmitted") === "Ja",
    payCount: annual ? (number("Jahresauswertung", "availablePayMonthCount") ?? 0) : 0,
    netCount: annual ? (number("Jahresauswertung", "availableNetMonthCount") ?? 0) : 0,
    testData: report.rows.some(
      (row) =>
        row.section === "Bericht" &&
        row.field.startsWith("testMonths.") &&
        row.value.startsWith(report.period),
    ),
    checks: annual
      ? "Prüfhinweise siehe Auswertung in der App."
      : critical === null || warnings === null
        ? "Prüfung eingeschränkt. Details siehe App."
        : `${critical} kritische Prüfhinweise · ${warnings} weitere Hinweise. Details siehe App.`,
    issues,
    entries: report.entries ?? [],
  };
}

export function reportMinutes(value: number | null, signed = false): string {
  if (value === null) return "Nicht verfügbar";
  const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
  return `${sign}${Math.floor(Math.abs(value) / 60)}:${String(Math.round(Math.abs(value)) % 60).padStart(2, "0")} h`;
}

export function reportMoney(value: number | null): string {
  return value === null
    ? "Nicht verfügbar"
    : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" })
        .format(value)
        .replaceAll("\u00a0", " ");
}

export function reportDate(value: string): string {
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}

export function entryTime(entry: ReportEntry): string {
  return entry.allDay
    ? "Ganztägig"
    : `${entry.startTime ?? "-"} - ${entry.endTime ?? "-"}${entry.nextDay ? " +1" : ""}`;
}

export function escapeReportHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
