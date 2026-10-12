import { Temporal } from "@js-temporal/polyfill";
import type { ReportDocument } from "./report-document";
import { reportDate, REPORT_WEEKDAYS } from "./report-view-data";
export { reportToHtml } from "./report-pdf";

function csvCell(value: string): string {
  // Quoting alone does not prevent Excel from evaluating a formula.
  const safe =
    /^[\s\u0000-\u001f]*[=+@-]/.test(value) && !/^-\d+(,\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reportToCsv(report: ReportDocument): string {
  const hours = (minutes: number | null) =>
    minutes === null ? "" : (minutes / 60).toFixed(2).replace(".", ",");
  const lines = [
    [
      "Datum",
      "Wochentag",
      "Art",
      "Dienst / Termin",
      "Beginn",
      "Ende",
      "Ende am Folgetag",
      "Pause (Min)",
      "Dienst- / Terminzeit (h)",
      "Zeitgutschrift (h)",
    ],
    ...(report.entries ?? []).map((entry) => [
      reportDate(entry.date),
      REPORT_WEEKDAYS[Temporal.PlainDate.from(entry.date).dayOfWeek - 1],
      entry.typeLabel,
      entry.title,
      entry.startTime ?? "",
      entry.endTime ?? "",
      entry.allDay ? "" : entry.nextDay ? "Ja" : "Nein",
      entry.breakMinutes === null ? "" : String(entry.breakMinutes),
      hours(entry.durationMinutes),
      entry.kind === "APPOINTMENT"
        ? ""
        : entry.creditMinutes === null
          ? "Nicht verfügbar"
          : entry.creditMinutes === 0
            ? ""
            : hours(entry.creditMinutes),
    ]),
  ];
  return "\uFEFF" + lines.map((line) => line.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
