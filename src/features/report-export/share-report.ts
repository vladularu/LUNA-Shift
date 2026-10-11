import type { ReportDocument } from "./report-document";
export type ReportFormat = "PDF" | "CSV";
export async function shareReport(_report: ReportDocument, _format: ReportFormat): Promise<void> {
  throw new Error("Berichtsexport wird zunächst auf dem iPhone unterstützt.");
}
