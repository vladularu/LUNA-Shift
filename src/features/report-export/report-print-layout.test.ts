import { describe, expect, it } from "vitest";
import { appendReportData, type ReportDocument, type ReportRow } from "./report-document";
import { reportToHtml } from "./report-pdf";
import { reportToIosHtml } from "./report-print-layout";

const rows: ReportRow[] = [];
appendReportData(rows, "Profil", "2026-10", "Profil", {
  displayName: "Team 768pt",
  employerName: "Klinik",
});
const report: ReportDocument = { period: "2026-10", createdAt: "2026-10-12", rows, entries: [] };

describe("native iOS PDF geometry", () => {
  it.each(["standard", "compact"] as const)(
    "uses native pixels inside the printable rectangle for %s",
    (layout) => {
      const html = reportToIosHtml(report, { layout, includeSalary: true });
      const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
      expect(style).toContain("height:768px");
      expect(style).toContain("width:523px");
      expect(style).toContain("@page{size:A4;margin:0}");
      expect(style).not.toMatch(/\dpt\b/);
      expect(html).toContain("Team 768pt");
      expect(html.match(/<article /g)).toHaveLength(layout === "compact" ? 1 : 2);
    },
  );
  it("retains the physical A4 geometry in the browser preview", () => {
    expect(reportToHtml(report)).toContain("height:768pt");
    expect(reportToHtml(report)).toContain("@page{size:A4;margin:36pt}");
  });
  it("bounds the adjustment without modifying user data", () => {
    const html = reportToIosHtml(report, { layout: "standard", includeSalary: false }, 0.94);
    expect(html).toContain("height:721.92px");
    expect(html).toContain("width:523px");
    expect(html).toContain("Team 768pt");
    expect(html).not.toContain("Gehaltsprognose");
  });
});
