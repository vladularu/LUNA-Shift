import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_VIEW, moveAnalysisCard, parseAnalysisView } from "./analysis-view";

describe("separate earned-premium and payout cards", () => {
  it("inserts the earned card before pay when loading a saved four-card layout", () => {
    const stored = {
      version: 1,
      order: ["SHIFTS", "PAY", "WORK", "CHECK"],
      hidden: ["CHECK"],
      shiftMetric: "COUNT",
    };
    expect(parseAnalysisView(JSON.stringify(stored))).toEqual({
      ...stored,
      order: ["SHIFTS", "PREMIUM", "PAY", "NET", "WORK", "CHECK"],
    });
  });

  it("preserves hiding the previous pay area during layout migration", () => {
    const migrated = parseAnalysisView(
      JSON.stringify({
        version: 1,
        order: ["WORK", "CHECK", "PAY", "SHIFTS"],
        hidden: ["PAY"],
        shiftMetric: "HOURS",
      }),
    );
    expect(migrated.hidden).toEqual(["PAY", "PREMIUM", "NET"]);
  });

  it("round-trips independent placement and visibility of the new cards", () => {
    const moved = moveAnalysisCard(DEFAULT_ANALYSIS_VIEW, "PREMIUM", -1);
    const saved = { ...moved, hidden: ["PREMIUM"] };
    expect(parseAnalysisView(JSON.stringify(saved))).toEqual(saved);
    expect(saved.order.indexOf("PREMIUM")).not.toBe(saved.order.indexOf("PAY"));
  });

  it("still rejects damaged layouts instead of treating them as old layouts", () => {
    expect(() =>
      parseAnalysisView(JSON.stringify({ ...DEFAULT_ANALYSIS_VIEW, order: ["WORK", "PAY"] })),
    ).toThrow();
    expect(() =>
      parseAnalysisView(
        JSON.stringify({ ...DEFAULT_ANALYSIS_VIEW, order: ["WORK", "CHECK", "PAY", "PAY"] }),
      ),
    ).toThrow();
  });
});

describe("independent net layout migration", () => {
  it.each([{ hidden: [] as string[] }, { hidden: ["PAY"] }, { hidden: ["CHECK", "PAY"] }])(
    "extends a five-card layout without losing order or visibility: %j",
    ({ hidden }) => {
      const stored = {
        version: 1,
        order: ["SHIFTS", "PAY", "WORK", "CHECK", "PREMIUM"],
        hidden,
        shiftMetric: "HOURS",
      };
      const result = parseAnalysisView(JSON.stringify(stored));
      expect(result.order).toEqual(["SHIFTS", "PAY", "NET", "WORK", "CHECK", "PREMIUM"]);
      expect(result.hidden).toEqual(hidden.includes("PAY") ? [...hidden, "NET"] : hidden);
      expect(parseAnalysisView(JSON.stringify(result))).toEqual(result);
    },
  );
  it.each([
    { hidden: ["PAY"] },
    { hidden: ["NET"] },
    { hidden: ["PAY", "NET"] },
    { hidden: [] as string[] },
  ])("keeps new six-card visibility independent: %j", ({ hidden }) => {
    const stored = {
      ...DEFAULT_ANALYSIS_VIEW,
      order: ["NET", "WORK", "CHECK", "PREMIUM", "PAY", "SHIFTS"],
      hidden,
    };
    expect(parseAnalysisView(JSON.stringify(stored))).toEqual(stored);
  });
  it("rejects incomplete or inconsistent legacy layouts", () => {
    for (const order of [
      ["WORK", "CHECK", "PAY", "NET"],
      ["WORK", "CHECK", "PAY", "NET", "SHIFTS"],
      ["WORK", "CHECK", "PAY", "PAY", "SHIFTS"],
    ])
      expect(() =>
        parseAnalysisView(JSON.stringify({ ...DEFAULT_ANALYSIS_VIEW, order })),
      ).toThrow();
    expect(() =>
      parseAnalysisView(
        JSON.stringify({
          ...DEFAULT_ANALYSIS_VIEW,
          order: ["WORK", "CHECK", "PREMIUM", "PAY", "SHIFTS"],
          hidden: ["NET"],
        }),
      ),
    ).toThrow();
  });
});
