import { describe, expect, it } from "vitest";

import type { ShiftEntry } from "@/domain/types";
import {
  selectAnalysisEntryWindow,
  selectComplianceShifts,
} from "@/features/analysis/analysis-data";

function shift(id: string, date: string): ShiftEntry {
  return {
    id,
    kind: "SHIFT",
    date,
    templateId: null,
    title: "Dienst",
    type: "DAY",
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 30,
    color: "#207A68",
    symbol: "D",
    note: "",
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("selectAnalysisEntryWindow", () => {
  it("loads the full January weekend lookback plus carried special duties", () => {
    const entries = [
      shift("carried", "2026-11-23"),
      shift("window", "2026-12-07"),
      shift("before", "2026-11-22"),
    ];
    expect(selectComplianceShifts(entries, "2027-01").map((entry) => entry.id)).toContain(
      "carried",
    );
  });
  it("does not resurrect an older active revision when its tombstone is newer", () => {
    const old = shift("duplicate", "2026-11-07");
    const deleted = { ...old, revision: 2, deletedAt: "2026-11-08T00:00:00Z" };
    expect(selectComplianceShifts([old, deleted], "2026-11")).toEqual([]);
  });
  it("preserves conflicting equal revisions for conservative engine assessment", () => {
    const old = shift("duplicate", "2026-11-07");
    const moved = { ...old, date: "2026-11-09" };
    expect(selectComplianceShifts([old, moved], "2026-11")).toHaveLength(2);
  });
  it("keeps the selected month small while loading the legal qualification year", () => {
    const result = selectAnalysisEntryWindow(
      [
        shift("previous-year", "2025-12-31"),
        shift("year-start", "2026-01-01"),
        shift("too-old", "2026-04-30"),
        shift("two-month-lookback", "2026-05-01"),
        shift("outside", "2026-06-22"),
        shift("lookback", "2026-06-23"),
        shift("month", "2026-07-15"),
        shift("after", "2026-08-01"),
        shift("after-window", "2026-08-29"),
        shift("year-end", "2026-12-31"),
        shift("next-year", "2027-01-01"),
        shift("long-window-end", "2027-01-31"),
        shift("after-long-window", "2027-02-01"),
      ],
      "2026-07",
    );

    expect(result.monthEntries.map((entry) => entry.id)).toEqual(["month"]);
    expect(result.monthShifts.map((entry) => entry.id)).toEqual(["month"]);
    expect(result.complianceShifts.map((entry) => entry.id)).toEqual([
      "year-start",
      "too-old",
      "two-month-lookback",
      "outside",
      "lookback",
      "month",
      "after",
      "after-window",
      "year-end",
      "next-year",
      "long-window-end",
    ]);
    expect(result.allowanceShifts.map((entry) => entry.id)).toEqual([
      "two-month-lookback",
      "outside",
      "lookback",
      "month",
    ]);
  });
});
