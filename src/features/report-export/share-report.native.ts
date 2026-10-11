import { Platform, Share } from "react-native";
import { File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import type { ReportDocument } from "./report-document";
import { reportToCsv, reportToHtml } from "./report-formats";
import type { ReportFormat } from "./share-report";

export async function shareReport(report: ReportDocument, format: ReportFormat): Promise<void> {
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
      const result = await printToFileAsync({
        html: reportToHtml(report),
        width: 595,
        height: 842,
        margins: { top: 36, bottom: 36, left: 36, right: 36 },
      });
      printed = new File(result.uri);
      printed.move(file);
    }
    await Share.share({ url: file.uri }, { subject: `LUNA Shift Bericht ${report.period}` });
  } finally {
    if (file?.exists) file.delete();
    if (printed?.exists) printed.delete();
  }
}
