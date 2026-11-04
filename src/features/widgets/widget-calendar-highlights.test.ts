import { describe, expect, it } from "vitest";
import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { work } from "@/engine/remuneration-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { widgetCalendarHighlights } from "./widget-calendar-highlights";

const profile = createWorkingTimeCalculationProfile(
  { ...work, federalState: "HE", sundayHolidayWorkEligible: true },
  null,
  [],
);
describe("widget calendar day highlights", () => {
  it("matches statutory and tariff days across the visible year boundary", () => {
    const labels = widgetCalendarHighlights(
      { startDate: "2026-11-30", endDate: "2027-02-07" },
      profile,
      bundledRuleResolver,
    );
    expect(labels.get("2026-12-24")).toBe("Heiligabend (tariflicher Sondertag)");
    expect(labels.get("2026-12-25")).toBe("1. Weihnachtstag");
    expect(labels.get("2026-12-31")).toBe("Silvester (tariflicher Sondertag)");
    expect(labels.get("2027-01-01")).toBe("Neujahr");
    expect(labels.has("2026-12-23")).toBe(false);
  });
  it("respects the work region and does not invent tariff days for missing target inputs", () => {
    const range = { startDate: "2026-12-01", endDate: "2027-01-31" };
    const hessen = widgetCalendarHighlights(range, work, bundledRuleResolver);
    const bayern = widgetCalendarHighlights(
      range,
      { ...work, federalState: "BY" },
      bundledRuleResolver,
    );
    expect(hessen.has("2027-01-06")).toBe(false);
    expect(bayern.get("2027-01-06")).toBe("Heilige Drei Könige");
    expect(hessen.has("2026-12-24")).toBe(false);
  });
  it("omits unavailable tariff classifications and preserves the profile", () => {
    const p = { ...profile, workingTimeTarget: { status: "error" as const, notices: [] } };
    const before = JSON.stringify(p);
    const result = widgetCalendarHighlights(
      { startDate: "2026-12-01", endDate: "2026-12-31" },
      p,
      bundledRuleResolver,
    );
    expect(result.has("2026-12-24")).toBe(false);
    expect(result.get("2026-12-25")).toBe("1. Weihnachtstag");
    expect(JSON.stringify(p)).toBe(before);
  });
});
