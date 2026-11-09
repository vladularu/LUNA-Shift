import { describe, expect, it } from "vitest";
import type { ComplianceIssue } from "@/domain/types";
import { legalCheckPresentation } from "./legal-check-presentation";

const issue = (change: Partial<ComplianceIssue> = {}): ComplianceIssue => ({
  id: "finding",
  date: "2026-11-02",
  kind: "LEGAL",
  severity: "warning",
  rule: "ARBZG_5_REST_10H",
  title: "Ruhezeit prüfen",
  description: "Unveränderte Originalbeschreibung",
  relatedShiftIds: [],
  ...change,
});
describe("fixed legal detail sources", () => {
  it("provides the reviewed law link for the actual rule identifier", () => {
    expect(legalCheckPresentation(issue()).sources).toEqual([
      {
        title: "Arbeitszeitgesetz · § 5 Ruhezeit",
        url: "https://www.gesetze-im-internet.de/arbzg/__5.html",
      },
    ]);
  });
  it.each([
    "DATA_DUPLICATE",
    "SHIFT_OVERLAP",
    "TIME_PLAUSIBILITY",
    "UNREVIEWED",
    "__proto__",
    "constructor",
    "javascript:run()",
  ])("does not invent a law source for %s", (rule) => {
    expect(
      legalCheckPresentation(issue({ rule, description: "§ 5 https://untrusted.example/" }))
        .sources,
    ).toEqual([]);
  });
  it("shows recorded and assessed values without discarding units", () => {
    const value = legalCheckPresentation(
      issue({
        rule: "ARBZG_3_MAX_10H",
        facts: { rule: "ARBZG_3_MAX_10H", netMinutes: 645, maximumMinutes: 600 },
      }),
    );
    expect(value.summary).toContain("10:45 h netto");
    expect(value.summary).toContain("10:00 h");
    expect(value.sources[0].url).toBe("https://www.gesetze-im-internet.de/arbzg/__3.html");
  });
  it("keeps pause amounts and the actual rest value explicit", () => {
    expect(
      legalCheckPresentation(
        issue({
          rule: "ARBZG_4_BREAK",
          facts: { rule: "ARBZG_4_BREAK", recordedBreakMinutes: 15, requiredBreakMinutes: 30 },
        }),
      ).summary,
    ).toContain("15 Min. Pause · Prüfmaßstab: 30 Min.");
    expect(
      legalCheckPresentation(
        issue({ facts: { rule: "ARBZG_5_REST_10H", restMinutes: 570, minimumRestMinutes: 600 } }),
      ).summary,
    ).toContain("9:30 h Ruhezeit · Prüfmaßstab: 10:00 h");
  });
  it("never presents mismatched or invalid cached facts as actual numeric observations", () => {
    const value = legalCheckPresentation(
      issue({ facts: { rule: "ARBZG_3_MAX_10H", netMinutes: 645, maximumMinutes: 600 } }),
    );
    expect(value.summary).toBe("Einordnung in den Details prüfen.");
  });
  it.each([
    ["JARBSCHG_18_HOLIDAY", "https://www.gesetze-im-internet.de/jarbschg/BJNR009650976.html"],
    ["§ 18 Abs. 3 JArbSchG", "https://www.gesetze-im-internet.de/jarbschg/BJNR009650976.html"],
    ["§ 15 BBiG", "https://www.gesetze-im-internet.de/bbig_2005/__15.html"],
    ["§§ 18, 63 PflBG", "https://www.gesetze-im-internet.de/pflbg/__18.html"],
  ])("keeps %s on its own confirmed legal basis", (rule, url) => {
    expect(legalCheckPresentation(issue({ rule })).sources[0]?.url).toBe(url);
  });
});
