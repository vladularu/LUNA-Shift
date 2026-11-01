import { describe, expect, it } from "vitest";
import { newSpecialDuty } from "@/domain/special-duty";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { buildMonthlyShiftTypeAnalysis, combineShiftTypeAnalyses } from "./analysis-metrics";

describe("saved shift name groups", () => {
  it("separates names within one technical type without double-counting overlaps", () => {
    const first = forecastShift({
      id: "a",
      date: "2026-07-01",
      type: "CUSTOM",
      title: "Station A",
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 0,
    });
    const second = { ...first, id: "b", title: "Station B", startTime: "12:00", endTime: "18:00" };
    const result = buildMonthlyShiftTypeAnalysis("2026-07", [first, second], forecastProfile);
    expect(result.groups?.map(({ title, count, minutes }) => ({ title, count, minutes }))).toEqual([
      { title: "Station A", count: 1, minutes: 480 },
      { title: "Station B", count: 1, minutes: 120 },
    ]);
    expect(result.totalMinutes).toBe(600);
    expect(result.groups?.reduce((sum, item) => sum + item.minutes, 0)).toBe(result.totalMinutes);
  });

  it("groups matching saved names across technical types and retains differing icons", () => {
    const first = forecastShift({
      id: "a",
      date: "2026-07-01",
      title: "Station",
      symbol: "sunny",
      color: "#339966",
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 0,
    });
    const result = buildMonthlyShiftTypeAnalysis(
      "2026-07",
      [
        first,
        { ...first, id: "b", date: "2026-07-02", type: "CUSTOM" },
        { ...first, id: "c", date: "2026-07-03", symbol: "moon" },
        { ...first, id: "deleted", deletedAt: "2026-07-04" },
      ],
      forecastProfile,
    );
    expect(result.groups).toHaveLength(2);
    expect(result.groups?.[0]).toMatchObject({
      title: "Station",
      symbol: "sunny",
      color: "#339966",
      count: 2,
      minutes: 960,
    });
    expect(result.groups?.[1]).toMatchObject({ symbol: "moon", count: 1, minutes: 480 });
  });

  it("counts a split duty once while adding its sections and preserving its saved appearance", () => {
    const duty = forecastShift({
      id: "split",
      date: "2026-07-07",
      title: "Mein geteilter Dienst",
      type: "CUSTOM",
      symbol: "briefcase",
      startTime: "08:00",
      endTime: "12:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("SPLIT", "08:00", "12:00", "Europe/Berlin"),
        parts: [{ start: 960, end: 1200, breakMinutes: 0 }],
      },
    });
    const result = buildMonthlyShiftTypeAnalysis("2026-07", [duty], forecastProfile);
    expect(result.groups?.[0]).toMatchObject({
      title: duty.title,
      symbol: "briefcase",
      count: 1,
      minutes: 480,
    });
    expect(result.groups?.[0].entries).toEqual([{ id: "split", date: "2026-07-07", minutes: 480 }]);
    expect(result.totalCount).toBe(1);
  });

  it("retains a readiness duty with no callouts and no invented worked hours", () => {
    const duty = forecastShift({
      id: "on-call",
      date: "2026-07-08",
      title: "Rufbereitschaft",
      type: "CUSTOM",
      startTime: "08:00",
      endTime: "16:00",
      specialDuty: newSpecialDuty("ON_CALL", "08:00", "16:00", "Europe/Berlin"),
    });
    const result = buildMonthlyShiftTypeAnalysis("2026-07", [duty], forecastProfile);
    expect(result.groups?.[0]).toMatchObject({ count: 1, minutes: 0 });
    expect(result.totalCount).toBe(1);
  });

  it("allocates one absence credit once and combines saved groups across months", () => {
    const first = forecastShift({
      id: "v1",
      date: "2026-07-01",
      title: "Urlaub A",
      type: "VACATION",
      startTime: null,
      endTime: null,
    });
    const july = buildMonthlyShiftTypeAnalysis(
      "2026-07",
      [first, { ...first, id: "v2", title: "Urlaub B" }],
      forecastProfile,
    );
    expect(july.groups?.reduce((sum, item) => sum + item.minutes, 0)).toBe(july.totalMinutes);
    expect(july.groups?.filter((item) => item.minutes > 0)).toHaveLength(1);
    const august = buildMonthlyShiftTypeAnalysis(
      "2026-08",
      [{ ...first, id: "v3", date: "2026-08-03" }],
      forecastProfile,
    );
    const annual = combineShiftTypeAnalyses([july, august]);
    expect(annual.groups?.find((item) => item.title === "Urlaub A")?.count).toBe(2);
    expect(annual.groups?.reduce((sum, item) => sum + item.minutes, 0)).toBe(annual.totalMinutes);
  });
});
