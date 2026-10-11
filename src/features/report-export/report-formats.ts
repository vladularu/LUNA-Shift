import { LIGHT_PALETTE } from "@/theme/palette-values";
import type { ReportDocument } from "./report-document";

function csvCell(value: string): string {
  // Excel interprets even quoted cells as formulas. Neutralize text before quoting.
  const safe =
    /^[\s\u0000-\u001f]*[=+@-]/.test(value) && !/^-\d+(,\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function reportToCsv(report: ReportDocument): string {
  const lines = [
    ["Bereich", "Zeitraum", "Datensatz", "Feld", "Wert", "Einheit", "Schlüssel"],
    ...report.rows.map((row) => [
      row.section,
      row.period,
      row.record,
      row.label,
      row.value,
      row.unit,
      row.field,
    ]),
  ];
  return "\uFEFF" + lines.map((line) => line.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function reportToHtml(report: ReportDocument): string {
  const summarySection = report.period.length === 4 ? "Jahresauswertung" : "Arbeitszeit";
  const summary = [
    "targetMinutes",
    "actualMinutes",
    "balanceMinutes",
    "estimatedGrossAmount",
    "netCents",
  ]
    .map((field) =>
      report.rows.find(
        (row) =>
          row.field ===
            (field === "netCents" && report.period.length !== 4 ? "result.pay.netCents" : field) &&
          row.period === report.period &&
          row.section ===
            (field === "netCents" && report.period.length !== 4
              ? "Netto-Prognose"
              : field === "estimatedGrossAmount" && report.period.length !== 4
                ? "Gehaltsprognose"
                : summarySection),
      ),
    )
    .filter((row) => row !== undefined)
    .map((row) => {
      const minutes = Number(row.value.replace(",", "."));
      const display =
        row.unit === "Minuten" && Number.isFinite(minutes)
          ? `${minutes < 0 ? "−" : ""}${Math.floor(Math.abs(minutes) / 60)}:${String(Math.abs(minutes) % 60).padStart(2, "0")} h`
          : `${row.value} ${row.unit}`.trim();
      return `<tr><td>${html(row.label)}</td><td>${html(display)}</td></tr>`;
    })
    .join("");
  let group = "";
  const body: string[] = [];
  for (const row of report.rows) {
    const key = JSON.stringify([row.section, row.period, row.record]);
    if (key !== group) {
      if (group) body.push("</tbody></table>");
      group = key;
      body.push(
        `<h2>${html(row.section)} · ${html(row.period)}</h2><h3>${html(row.record)}</h3><table><thead><tr><th>Feld</th><th>Wert</th><th>Einheit</th></tr></thead><tbody>`,
      );
    }
    body.push(
      `<tr><td>${html(row.label)}</td><td>${html(row.value)}</td><td>${html(row.unit)}</td></tr>`,
    );
  }
  if (group) body.push("</tbody></table>");
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>LUNA Shift Bericht ${html(report.period)}</title>
<style>@page{size:A4;margin:16mm}body{font:10pt Arial,sans-serif;color:${LIGHT_PALETTE.text}}h1{font-size:22pt}h2{font-size:14pt;margin-top:24pt;break-after:avoid}h3{font-size:11pt;break-after:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:6pt;border-bottom:1px solid ${LIGHT_PALETTE.separator};overflow-wrap:anywhere;white-space:pre-wrap}th:first-child{width:45%}th:last-child{width:12%}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:20pt;color:${LIGHT_PALETTE.textMuted}}</style></head>
<body><h1>LUNA Shift · ${html(report.period)}</h1><p>Vollständiger Bericht · Erstellt: ${html(report.createdAt)}</p>
<p>Gehaltsprognose: unverbindliche Brutto-/Nettoschätzung, keine Lohnabrechnung. Pausen werden mangels Lageangabe mittig angesetzt. Automatische Prüfhinweise sind keine Rechtsberatung. Nicht verfügbare Berechnungen werden ausdrücklich ausgewiesen.</p>
<h2>Zusammenfassung</h2><table><tbody>${summary}</tbody></table>${body.join("")}<footer>LUNA Shift · ${html(report.period)}</footer></body></html>`;
}
