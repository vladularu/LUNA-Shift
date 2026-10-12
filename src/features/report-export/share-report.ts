import { DEFAULT_REPORT_OPTIONS, type ReportDocument, type ReportOptions } from "./report-document";
export type ReportFormat = "PDF" | "CSV";
export async function shareReport(
  _report: ReportDocument,
  _format: ReportFormat,
  _options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): Promise<void> {
  throw new Error("Berichtsexport wird zunächst auf dem iPhone unterstützt.");
}
