import { Platform, Share } from "react-native";
import { File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { DEFAULT_REPORT_OPTIONS, type ReportDocument, type ReportOptions } from "./report-document";
import { reportToCsv } from "./report-formats";
import { REPORT_PRINT_PAGE, reportToIosHtml } from "./report-print-layout";
import { ReportExportError } from "./report-export-error";
import type { ReportFormat } from "./share-report";

export async function shareReport(
  report: ReportDocument,
  format: ReportFormat,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): Promise<void> {
  if (Platform.OS !== "ios")
    throw new Error("Berichtsexport wird zunächst auf dem iPhone unterstützt.");
  let file: File | null = null;
  let printed: File | null = null;
  try {
    file = new File(
      Paths.cache,
      `LUNA-Shift-Bericht-${report.period}-${randomUUID()}.${format.toLowerCase()}`,
    );
    if (format === "CSV") {
      file.create();
      file.write(reportToCsv(report));
    } else {
      // Load on demand so an older native build can still open reports and export CSV.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { printToFileAsync } = require("expo-print") as typeof import("expo-print");
      const limit = options.layout === "compact" ? 1 : 3;
      // One bounded fitting retry covers small differences between iOS WebKit versions.
      for (const fit of [1, 0.94]) {
        let result;
        try {
          result = await printToFileAsync({
            html: reportToIosHtml(report, options, fit),
            width: REPORT_PRINT_PAGE.width,
            height: REPORT_PRINT_PAGE.height,
            margins: {
              top: REPORT_PRINT_PAGE.margin,
              bottom: REPORT_PRINT_PAGE.margin,
              left: REPORT_PRINT_PAGE.margin,
              right: REPORT_PRINT_PAGE.margin,
            },
          });
        } catch {
          throw new ReportExportError(
            "Die PDF-Erstellung wurde von iOS abgebrochen. Bitte versuche den Export erneut.",
          );
        }
        if (typeof result.uri === "string" && result.uri.length > 0) printed = new File(result.uri);
        if (!printed || !Number.isInteger(result.numberOfPages) || result.numberOfPages < 1)
          throw new ReportExportError(
            "iOS hat keine gültige PDF-Datei erstellt. Bitte versuche den Export erneut.",
          );
        if (result.numberOfPages > limit) {
          if (printed.exists) printed.delete();
          printed = null;
          if (fit === 1) continue;
          throw new ReportExportError(
            `iOS hat ${result.numberOfPages} PDF-Seiten erstellt. Für ${options.layout === "compact" ? "Kompakt ist eine Seite" : "Standard sind höchstens drei Seiten"} vorgesehen. Bitte wähle ${options.layout === "compact" ? "Standard oder CSV" : "CSV"}.`,
          );
        }
        try {
          printed.move(file);
        } catch {
          throw new ReportExportError(
            "Das PDF konnte nicht zum Teilen vorbereitet werden. Bitte versuche den Export erneut.",
          );
        }
        break;
      }
    }
    try {
      await Share.share({ url: file.uri }, { subject: `LUNA Shift Bericht ${report.period}` });
    } catch {
      throw new ReportExportError(
        "Die Datei wurde erstellt, aber der Teilen-Dialog konnte nicht geöffnet werden. Bitte versuche es erneut.",
      );
    }
  } finally {
    if (file?.exists) file.delete();
    if (printed?.exists) printed.delete();
  }
}
