import { Temporal } from "@js-temporal/polyfill";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import {
  DEFAULT_REPORT_OPTIONS,
  REPORT_CHECK_SCOPE,
  type ReportDocument,
  type ReportEntry,
  type ReportOptions,
} from "./report-document";
import {
  escapeReportHtml as html,
  entryTime,
  reportDate,
  reportMinutes,
  reportMoney,
  reportView,
  REPORT_MONTH_NAMES,
  REPORT_WEEKDAYS,
} from "./report-view-data";

type View = ReturnType<typeof reportView>;
const short = (value: string, max = 54) =>
  value.length > max ? value.slice(0, max - 1) + "…" : value;
const color = (entry: ReportEntry) =>
  /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : LIGHT_PALETTE.textMuted;
const row = (label: string, value: string) =>
  `<tr><td>${html(label)}</td><td class="number">${html(value)}</td></tr>`;

function header(view: View, subtitle: string): string {
  return `<header><div class="brand">LUNA SHIFT <span>${html(subtitle)}</span></div><h1>${html(view.title)}</h1><div class="meta"><span>${html(short([view.name, view.employer].filter(Boolean).join(" · "), 64))}</span><span>Planstand ${html(reportDate(view.referenceDate))}</span></div></header>`;
}

function kpis(view: View): string {
  const conditionalReferences = [
    ...new Set(
      view.workingTimeTargets.flatMap((item) =>
        item.notices
          .filter((notice) =>
            ["CONDITIONAL_ROSTER_FREE_FORECAST", "TARGET_RULE_FORECAST"].includes(notice.code),
          )
          .map((notice) => notice.message),
      ),
    ),
  ];
  const targetNote = conditionalReferences.length
    ? "Sollzeit vorläufig. " + conditionalReferences.join(" ")
    : view.workingTimeTargets.some((item) => item.status !== "FINAL")
      ? "Sollzeit vorläufig oder unvollständig. Offene Voraussetzungen sind nicht als bestätigter Anspruch berücksichtigt."
      : "";
  return `<div class="metrics">${[
    ["Sollzeit", reportMinutes(view.target)],
    ["Erfasste Kontozeit", reportMinutes(view.actual)],
    ["Saldo", reportMinutes(view.balance, true)],
  ]
    .map(
      ([label, value]) =>
        `<div><small>${label}</small><strong class="${value === "Nicht verfügbar" ? "unavailable" : ""}">${html(value)}</strong></div>`,
    )
    .join("")}</div>${targetNote ? `<p class="muted">${html(targetNote)}</p>` : ""}`;
}

function salary(view: View, details: boolean): string {
  const coverage = view.annual
    ? `<p class="muted">Brutto: ${view.payCount}/12 Monate verfügbar. Netto: ${view.netCount}/12 Monate verfügbar. Summen enthalten nur verfügbare Monate.</p>`
    : "";
  return `<section><h2>Gehaltsprognose</h2><div class="salary metrics"><div><small>Brutto geschätzt${view.annual ? " (Teilwert möglich)" : ""}</small><strong class="${view.gross === null ? "unavailable" : ""}">${html(reportMoney(view.gross))}</strong></div><div class="net"><small>${html(view.netLabel)}${view.annual ? " (Teilwert möglich)" : ""}</small><strong class="${view.net === null ? "unavailable" : ""}">${html(view.netDisplay)}</strong></div></div>${view.netBasisNote ? `<p class="muted">${html(view.netBasisNote)}</p>` : ""}${coverage}${details && !view.annual ? `<div class="columns"><div><h3>Brutto setzt sich zusammen aus</h3><table>${row("Grundgehalt", reportMoney(view.base))}${row("Zulagen", reportMoney(view.allowances))}${row("Zeitzuschläge", reportMoney(view.premiums))}${view.overtime ? row("Überstunden", reportMoney(view.overtime)) : ""}${view.annualPaymentAmount ? row("Jahressonderzahlung", reportMoney(view.annualPaymentAmount)) : ""}</table></div><div><h3>Berücksichtigte Abzüge</h3><table>${row("Steuern", reportMoney(view.tax))}${row("Sozialversicherung", reportMoney(view.insurance))}${row("Zusatzversorgung", reportMoney(view.pension))}</table></div></div>` : ""}${view.annualPaymentNote ? `<p class="muted">${html(view.annualPaymentNote)}</p>` : ""}<p class="muted">Schätzung aus den eingetragenen Monatseinträgen. Keine Lohnabrechnung.${view.pensionOmitted ? " Zusatzversorgung nicht berücksichtigt." : ""}</p></section>`;
}

function notice(view: View): string {
  return `<aside><b>${view.testData ? "Enthält Testdaten · " : ""}Prüfhinweise</b><p>${html(view.checks)}${view.checkPrerequisites ? `<br>${html(view.checkPrerequisites)}` : ""}<br>${html(REPORT_CHECK_SCOPE)}</p>${view.issues.map((issue) => `<p>${html(short(issue, 120))}</p>`).join("")}</aside>`;
}

function monthCalendar(view: View): string {
  const first = Temporal.PlainDate.from(`${view.monthly[0].period}-01`);
  const start = first.subtract({ days: first.dayOfWeek - 1 });
  const weekCount = Math.ceil((first.dayOfWeek - 1 + first.daysInMonth) / 7);
  const dates = new Map<string, ReportEntry[]>();
  for (const entry of view.entries)
    dates.set(entry.date, [...(dates.get(entry.date) ?? []), entry]);
  const cells = Array.from({ length: weekCount * 7 }, (_, i) => {
    const day = start.add({ days: i });
    const entries = dates.get(day.toString()) ?? [];
    const shown = entries.slice(0, 1);
    return `<td class="${day.month !== first.month ? "outside" : ""}"><b>${day.day}</b>${shown.map((entry) => `<div class="event" style="border-left-color:${color(entry)}"><span>${html(short(entry.title, 15))}</span><small>${entry.allDay ? "Ganztägig" : html(entry.startTime ?? "")}</small></div>`).join("")}${entries.length > shown.length ? `<small>+${entries.length - shown.length} weitere</small>` : ""}</td>`;
  });
  return `<section><h2>Dein Monatsplan</h2><table class="calendar weeks-${weekCount}"><thead><tr>${REPORT_WEEKDAYS.map((day) => `<th>${day}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: weekCount }, (_, i) => `<tr>${cells.slice(i * 7, i * 7 + 7).join("")}</tr>`).join("")}</tbody></table><p class="muted">Leere Tage: kein Eintrag. Kontozeit inkl. Abwesenheitsgutschriften.${Array.from(dates.values()).some((entries) => entries.length > 1) ? " Weitere Einträge siehe Standard-Bericht oder CSV." : ""}</p></section>`;
}

function annualTable(view: View, includeSalary: boolean): string {
  return `<section><h2>Zwölf Monate im Überblick</h2><table class="annual"><thead><tr><th>Monat</th><th>Soll</th><th>Kontozeit</th><th>Saldo</th>${includeSalary ? "<th>Brutto</th><th>Netto</th>" : ""}</tr></thead><tbody>${view.monthly.map((month, i) => `<tr><td>${REPORT_MONTH_NAMES[i]}</td><td>${html(reportMinutes(month.target))}</td><td>${html(reportMinutes(month.actual))}</td><td>${html(reportMinutes(month.balance, true))}</td>${includeSalary ? `<td>${html(reportMoney(month.gross))}</td><td>${html(month.netDisplay)}</td>` : ""}</tr>`).join("")}</tbody></table>${includeSalary && view.netBasisNote ? `<p class="muted">${html(view.netBasisNote)}</p>` : ""}<p class="muted">Vollständige tägliche Einzelliste im CSV-Export.</p></section>`;
}

function categories(view: View): string {
  return `<section><h2>Zeitkonto im Überblick</h2><table>${view.categories
    .filter((item) => item.count !== 0 || item.minutes !== 0)
    .map((item) =>
      row(
        `${item.label}${item.count === null ? "" : ` · ${item.count} Einträge`}`,
        `${reportMinutes(item.minutes)}${item.credit ? " Gutschrift" : ""}`,
      ),
    )
    .join(
      "",
    )}</table><p class="muted">Kontozeit enthält Urlaub und Krankheit als Gutschriften. Der Saldo ist keine Überstundenabrechnung.</p></section>`;
}

function entryRows(entries: readonly ReportEntry[]): string {
  return entries
    .map((entry) => {
      const credit = entry.creditMinutes;
      const time =
        entry.kind === "APPOINTMENT"
          ? entry.allDay
            ? "-"
            : reportMinutes(entry.durationMinutes)
          : entry.durationMinutes !== null
            ? reportMinutes(entry.durationMinutes)
            : credit === null
              ? "Nicht verfügbar"
              : credit > 0
                ? `${reportMinutes(credit)} *`
                : "-";
      return `<tr><td>${html(reportDate(entry.date).slice(0, 5))}</td><td><span class="dot" style="background:${color(entry)}"></span>${html(short(entry.title, 30))}${entry.kind === "APPOINTMENT" ? " <small>(Termin)</small>" : ""}</td><td>${html(entryTime(entry))}</td><td>${entry.breakMinutes === null ? "-" : `${entry.breakMinutes} min`}</td><td class="number">${html(time)}</td></tr>`;
    })
    .join("");
}

function listPages(view: View): string[] {
  if (view.entries.length <= 60) {
    const pages =
      view.entries.length <= 30
        ? [view.entries]
        : [view.entries.slice(0, 30), view.entries.slice(30)];
    return pages.map(
      (entries, i) =>
        `<h2>Dienste, Abwesenheiten & Termine${i ? " · Fortsetzung" : ""}</h2><p class="muted">${view.entries.length} Einträge im Monat. Dienstzeiten ohne unbezahlte Pause.</p><table class="entries ${entries.length > 24 ? "dense" : ""}"><thead><tr><th>Datum</th><th>Dienst / Termin</th><th>Beginn - Ende</th><th>Pause</th><th>Zeit</th></tr></thead><tbody>${entryRows(entries)}</tbody></table><p class="muted">+1: Ende am Folgetag. *: Zeitgutschrift, keine Dienstzeit.<br>Terminzeiten zählen nicht zum Zeitkonto. Überschneidungen werden im Zeitkonto nur einmal berücksichtigt.</p>`,
    );
  }
  const dates = new Map<string, ReportEntry[]>();
  for (const entry of view.entries)
    dates.set(entry.date, [...(dates.get(entry.date) ?? []), entry]);
  return [
    `<h2>Tagesübersicht</h2><p class="muted">${view.entries.length} Einträge: PDF tagesweise verdichtet. Vollständige Einzelliste im CSV.</p><table class="entries dense"><thead><tr><th>Datum</th><th>Dienste / Termine</th><th>Einträge</th></tr></thead><tbody>${Array.from(dates, ([date, entries]) => `<tr><td>${html(reportDate(date).slice(0, 5))}</td><td>${html(short([...new Set(entries.map((entry) => entry.title))].join(", "), 65))}</td><td class="number">${entries.length}</td></tr>`).join("")}</tbody></table>`,
  ];
}

export function reportToHtml(
  report: ReportDocument,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): string {
  const view = reportView(report);
  const compact = options.layout === "compact";
  const overview = `${kpis(view)}${compact ? (view.annual ? annualTable(view, options.includeSalary) : monthCalendar(view)) : categories(view)}${options.includeSalary ? salary(view, !compact) : ""}${notice(view)}`;
  const pages = [
    overview,
    ...(compact ? [] : view.annual ? [annualTable(view, options.includeSalary)] : listPages(view)),
  ];
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LUNA Shift Bericht ${html(view.title)}</title><style>
  @page{size:A4;margin:36pt}*{box-sizing:border-box}body{margin:0;font:10pt -apple-system,BlinkMacSystemFont,Arial,sans-serif;color:${LIGHT_PALETTE.text};background:white} .page{height:768pt;position:relative;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}header{border-bottom:1px solid ${LIGHT_PALETTE.separator};padding-bottom:15pt;margin-bottom:18pt}.brand{font-size:8pt;font-weight:700;letter-spacing:1pt}.brand span{float:right;font-size:7pt;font-weight:400;color:${LIGHT_PALETTE.textMuted};letter-spacing:.2pt}h1{font-size:26pt;margin:15pt 0 7pt;font-weight:700}h2{font-size:13pt;margin:0 0 11pt}h3{font-size:8pt;color:${LIGHT_PALETTE.textMuted};font-weight:400;margin:15pt 0 7pt}.meta{display:flex;justify-content:space-between;gap:12pt;font-size:9pt;color:${LIGHT_PALETTE.textMuted}}.meta span:last-child{font-size:8pt;white-space:nowrap}section{margin-top:21pt}.metrics{display:flex;gap:10pt}.metrics>div{flex:1;background:${LIGHT_PALETTE.groupedBackground};border-radius:13pt;padding:13pt}.metrics small{display:block;font-size:8pt;color:${LIGHT_PALETTE.textMuted};margin-bottom:10pt}.metrics strong{display:block;font-size:21pt;font-weight:700;white-space:nowrap}.metrics strong.unavailable{font-size:11pt;padding:6pt 0}.metrics.salary strong{font-size:22pt}.metrics.salary strong.unavailable{font-size:11pt}.metrics .net{background:${LIGHT_PALETTE.groupedBackground};color:${LIGHT_PALETTE.text}}.metrics .net strong{color:${LIGHT_PALETTE.text}}.metrics .net small{color:${LIGHT_PALETTE.textMuted}}.muted{font-size:8pt;line-height:1.5;color:${LIGHT_PALETTE.textMuted};margin:9pt 0 0}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{padding:7pt 0;border-bottom:1px solid ${LIGHT_PALETTE.separator};text-align:left;overflow-wrap:anywhere}td:first-child{width:65%}.number{text-align:right;white-space:nowrap}.columns{display:flex;gap:16pt}.columns>div{flex:1}.columns td{font-size:9pt}.columns td:first-child{width:56%}thead{display:table-header-group}tr{break-inside:avoid}aside{margin-top:19pt;padding:12pt;background:${LIGHT_PALETTE.groupedBackground};border-radius:11pt;font-size:8pt}aside p{margin:5pt 0 0;font-size:8pt;line-height:1.4}aside b{font-size:9pt}footer{margin-top:16pt;border-top:1px solid ${LIGHT_PALETTE.separator};padding-top:8pt;font-size:7pt;color:${LIGHT_PALETTE.textMuted}}footer span{float:right}.calendar th{text-align:center;border:0;font-size:8pt;color:${LIGHT_PALETTE.textMuted};padding:0 0 7pt}.calendar td{width:14.285%;height:50pt;vertical-align:top;padding:4pt;border-bottom:1px solid ${LIGHT_PALETTE.separator};font-size:9pt}.calendar.weeks-6 td{height:43pt}.calendar .outside>b{color:${LIGHT_PALETTE.textMuted}}.calendar td small{font-size:6.5pt;color:${LIGHT_PALETTE.textMuted}}.event{background:${LIGHT_PALETTE.groupedBackground};border-left:2pt solid;border-radius:3pt;padding:2pt 3pt;margin-top:3pt}.event span,.event small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:7pt}.calendar .event:nth-of-type(2){margin-top:2pt}.compact .calendar td{height:54pt}.compact .calendar.weeks-6 td{height:46pt}.compact section{margin-top:16pt}.compact aside{padding:8pt;margin-top:12pt}.compact aside p:not(:first-of-type){display:none}.compact .metrics.salary{margin-top:0}.compact .metrics.salary>div{padding:11pt}.compact .metrics.salary strong{font-size:21pt}.compact .metrics.salary small{margin-bottom:7pt}.compact h1{font-size:25pt}.compact header{margin-bottom:15pt;padding-bottom:12pt}.compact .metrics>div{padding:12pt}.annual{font-size:8pt}.annual th,.annual td{padding:7pt 3pt}.annual td:first-child{width:auto}.annual th:first-child{width:18%}.annual td:not(:first-child){text-align:right}.annual th:not(:first-child){text-align:right}.annual td{font-size:9pt}.compact .annual td,.compact .annual th{padding:6pt 3pt}.entries{font-size:9pt}.entries th{font-size:8pt;background:${LIGHT_PALETTE.groupedBackground}}.entries th,.entries td{padding:6.5pt 5pt;height:20pt}.entries th:first-child{width:11%}.entries th:nth-child(2){width:30%}.entries th:nth-child(3){width:26%}.entries th:nth-child(4){width:12%}.entries th:last-child{width:21%;text-align:right}.entries td:first-child{width:auto}.entries td{font-size:9pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.entries tr:nth-child(even){background:${LIGHT_PALETTE.surfaceMuted}}.entries small{font-size:7pt}.dot{display:inline-block;width:5pt;height:5pt;border-radius:50%;margin-right:6pt}
  .entries.dense th,.entries.dense td{padding:4pt 5pt;height:18pt;font-size:8pt}.compact .metrics.salary strong.unavailable{font-size:11pt}</style></head><body>${pages.map((body, i) => `<article class="page ${compact ? "compact" : "standard"}">${header(view, i === 0 ? (compact ? "KOMPAKT" : "STANDARD") : view.annual ? "MONATSÜBERSICHT" : "DIENSTLISTE")}${body}<footer>LUNA Shift · ${html(view.title)}${view.testData ? " · Testdaten" : ""}<span>${i + 1} / ${pages.length}</span></footer></article>`).join("")}</body></html>`;
}
