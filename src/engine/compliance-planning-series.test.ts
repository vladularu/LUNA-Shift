import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";
import type { ShiftEntry } from "@/domain/types";
import { bundledRuleResolver, requireResolvedPackage } from "@/rules/rule-resolver";
import { checkPlanningSeries } from "./compliance-planning-series";
import type { ComplianceInterval } from "./compliance-sequences";

const rules = requireResolvedPackage(bundledRuleResolver.resolveLegal("2026-07-01")).rules;

function nightSeries(from = "2026-07-01"): ComplianceInterval[] {
  return Array.from({ length: 9 }, (_, index) => {
    const date = Temporal.PlainDate.from(from).add({ days: index });
    const start = date.toZonedDateTime({ timeZone: "Europe/Berlin", plainTime: "21:00" });
    const end = date.add({ days: 1 }).toZonedDateTime({
      timeZone: "Europe/Berlin",
      plainTime: "07:00",
    });
    const shift: ShiftEntry = {
      kind: "SHIFT",
      id: `series-${index}`,
      date: date.toString(),
      templateId: null,
      title: "Nacht",
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:00",
      breakMinutes: 45,
      color: "#345678",
      symbol: "N",
      note: null,
      overtimeMinutes: 0,
      holidayPremiumMode: "WITH_TIME_OFF",
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    };
    const grossMinutes = (end.epochMilliseconds - start.epochMilliseconds) / 60_000;
    return { shift, start, end, grossMinutes, netMinutes: grossMinutes - 45 };
  });
}

describe("planning series without unused legacy night work", () => {
  it("does not resolve night clocks when legacy night findings are disabled", () => {
    const intervals = nightSeries();
    const original = intervals[0];
    const readStart = vi.fn(() => original.start);
    intervals[0] = {
      ...original,
      get start() {
        return readStart();
      },
    };

    const findings = checkPlanningSeries(intervals, rules, false);

    expect(findings.some((finding) => finding.rule === "PLANNING_7_DAYS")).toBe(true);
    expect(readStart).not.toHaveBeenCalled();
  });

  it("retains legacy night findings by default and when explicitly enabled", () => {
    const intervals = nightSeries();
    const defaults = checkPlanningSeries(intervals, rules);
    expect(defaults.some((finding) => finding.rule === "PLANNING_NIGHT_SERIES")).toBe(true);
    expect(checkPlanningSeries(intervals, rules, true)).toEqual(defaults);
  });

  it.each(["2026-07-01", "2026-03-26", "2026-10-22"])(
    "preserves every work-series finding across %s when legacy night findings are disabled",
    (from) => {
      const intervals = nightSeries(from);
      const legacy = checkPlanningSeries(intervals, rules, true);
      expect(checkPlanningSeries(intervals, rules, false)).toEqual(
        legacy.filter((finding) => finding.rule !== "PLANNING_NIGHT_SERIES"),
      );
    },
  );

  it("keeps empty input empty in both modes", () => {
    expect(checkPlanningSeries([], rules, false)).toEqual([]);
    expect(checkPlanningSeries([], rules)).toEqual([]);
  });
});
