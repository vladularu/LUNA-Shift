import { describe, expect, it } from "vitest";
import { PLANNING_WEEKEND_POLICY, planningWeekendCoverageStart } from "./planning-weekend-policy";

describe("four complete calendar weeks weekend policy", () => {
  it("records the source-specific two complete weekends in four weeks criterion", () => {
    expect(PLANNING_WEEKEND_POLICY).toMatchObject({
      version: "2026-11-09-four-weeks",
      windowWeeks: 4,
      minimumFreeWeekends: 2,
      source: { context: expect.stringContaining("Frage 42") },
    });
  });
  it("loads preceding weeks and the maximum fourteen-day carried duty before January", () => {
    expect(planningWeekendCoverageStart("2027-01")).toBe("2026-11-23");
  });
});
