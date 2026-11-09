import { describe, expect, it } from "vitest";
import type { ComplianceIssue } from "@/domain/types";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { colorContrastRatio } from "@/theme/color-contrast";
import { checkAppearance, checkCategoryLabel, planningCardSummary } from "./check-presentation";
import { planningHintPresentation } from "./planning-hint-presentation";

const issue = (change: Partial<ComplianceIssue> = {}): ComplianceIssue => ({
  id: "finding",
  date: "2026-11-02",
  kind: "LEGAL",
  severity: "info",
  rule: "ARBZG_4_BREAK",
  title: "Pause prüfen",
  description: "Originale Einordnung",
  relatedShiftIds: [],
  ...change,
});

describe("check category presentation", () => {
  it.each([
    ["under24", 1380, "24", "48"],
    ["under48", 2850, "48", "24"],
  ] as const)(
    "keeps only the applicable recovery recommendation in the %s fallback",
    (recoveryStatus, restMinutes, included, excluded) => {
      const finding = issue({
        kind: "PLANNING",
        rule: "PLANNING_NIGHT_RECOVERY",
        facts: {
          rule: "PLANNING_NIGHT_RECOVERY",
          count: 3,
          nightSequence: {
            policyVersion: "2026-11-07",
            firstNight: "2026-10-31",
            lastNight: "2026-11-02",
            countIsMinimum: false,
            recoveryStatus,
            restMinutes,
            lastShiftId: "last",
            nextShiftId: "next",
          },
        },
      });
      const summary = planningCardSummary(finding, planningHintPresentation(finding)).join(" ");
      expect(summary).toContain(included);
      expect(summary).not.toContain(excluded);
    },
  );
  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "uses neutral planning and distinct readable category borders",
    (palette) => {
      const planning = issue({ kind: "PLANNING", rule: "PLANNING_7_DAYS" });
      expect(checkAppearance(planning, palette).cardStyle).toEqual({ borderWidth: 0 });
      expect(checkCategoryLabel(planning)).toBe("Hinweise & Empfehlungen");
      expect(checkCategoryLabel(issue())).toBe("Gesetzliche Prüfung");
      expect(checkCategoryLabel(issue({ rule: "TARIFF_WEEK_DAYS" }))).toBe("Tarifliche Prüfung");
      const legal = checkAppearance(issue(), palette).cardStyle;
      const tariff = checkAppearance(issue({ rule: "TARIFF_WEEK_DAYS" }), palette).cardStyle;
      expect(legal).toEqual({ borderWidth: 1, borderColor: palette.legalCheckBorder });
      expect(tariff).toEqual({ borderWidth: 1, borderColor: palette.tariffCheckBorder });
      expect(legal).not.toEqual(tariff);
      for (const border of [palette.legalCheckBorder, palette.tariffCheckBorder])
        for (const surface of [palette.surface, palette.surfaceRaised])
          expect(colorContrastRatio(border, surface)).toBeGreaterThanOrEqual(3);
    },
  );

  it("does not fabricate new guidance for retired weekend metadata", () => {
    const finding = issue({
      kind: "PLANNING",
      rule: "PLANNING_WEEKENDS",
      facts: {
        rule: "PLANNING_WEEKENDS",
        count: 3,
        weekendSeries: {
          policyVersion: "2026-11-08",
          firstSaturday: "2026-11-14",
          lastSunday: "2026-11-29",
        },
      },
    });
    const hint = planningHintPresentation(finding);
    expect(planningCardSummary(finding, hint)).toEqual(["Einordnung in den Details prüfen."]);
    expect(hint.sources).toEqual([]);
    expect(hint.explanation).toBe(finding.description);
  });

  it("preserves the actual shorter recovery as a second observation in the night card", () => {
    const finding = issue({
      kind: "PLANNING",
      rule: "PLANNING_NIGHT_SERIES",
      facts: {
        rule: "PLANNING_NIGHT_SERIES",
        count: 4,
        nightSequence: {
          policyVersion: "2026-11-07",
          firstNight: "2026-10-30",
          lastNight: "2026-11-02",
          countIsMinimum: false,
          recoveryStatus: "under24",
          restMinutes: 1380,
          lastShiftId: "last",
          nextShiftId: "next",
        },
      },
    });
    expect(planningCardSummary(finding, planningHintPresentation(finding))).toEqual([
      "Empfohlen: höchstens 3 Nächte in Folge.",
      "Danach 23:00 h frei.",
    ]);
  });
});
