import type { ReportDocument, ReportOptions } from "./report-document";
import { reportToHtml } from "./report-pdf";

export const REPORT_PRINT_PAGE = { width: 595, height: 842, margin: 36 } as const;

// Expo's WKWebView formatter lays out CSS pixels before UIPrintPageRenderer paginates
// into the native printable rectangle. Browser print points cannot be reused here.
export function reportToIosHtml(report: ReportDocument, options: ReportOptions, fit = 1): string {
  return reportToHtml(report, options).replace(
    /<style>([\s\S]*?)<\/style>/,
    (_, source: string) => {
      const style = source
        .replace(/(\d+(?:\.\d+)?)pt\b/g, (_, value: string) => `${Number(value) * fit}px`)
        .replace(/@page\{[^}]*\}/, "@page{size:A4;margin:0}");
      // Let the native formatter fill its printable rectangle. A fixed CSS-pixel
      // width is scaled again by WebKit and leaves an extra right-hand margin.
      return `<style>${style}html,body{width:auto}.page{width:100%}</style>`;
    },
  );
}
