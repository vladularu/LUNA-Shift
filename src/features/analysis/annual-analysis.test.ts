import { describe, expect, it } from "vitest";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { createRuleResolver } from "@/rules/rule-resolver";
import {
  annualAnalysisKey,
  prepareAnnualAnalysisSteps,
  readAnnualAnalysis,
  type AnnualAnalysisRequest,
} from "./annual-analysis";
import {
  buildAnnualAvailableReportSteps,
  buildAnnualCoreReport,
  buildAnnualCoreReportSteps,
} from "./annual-core-report";
import { selectAnnualReportInputs } from "./annual-report-inputs";

const drain = <T>(steps: Generator<number, T, void>) => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};
const request = (): AnnualAnalysisRequest => ({
  year: 2026,
  entries: [
    forecastShift({ id: "january", date: "2026-01-05" }),
    forecastShift({ id: "october", date: "2026-10-05" }),
  ],
  profile: forecastProfile,
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  referenceDate: "2026-10-28",
  youthProtection: false,
  ruleResolver: createRuleResolver(),
});
describe("shared annual snapshots", () => {
  it("retains exact complete results across remounts and cloned input objects", () => {
    const input = request(),
      key = annualAnalysisKey(input);
    const result = drain(prepareAnnualAnalysisSteps(input, key, null));
    const cloned = { ...input, entries: JSON.parse(JSON.stringify(input.entries)) };
    expect(annualAnalysisKey(cloned)).toBe(key);
    expect(readAnnualAnalysis(cloned, key, null)).toBe(result);
    const original = drain(
      buildAnnualAvailableReportSteps(
        input.year,
        input.entries,
        input.profile,
        input.tariffDecisions,
        input.workPatternSettings,
        input.referenceDate,
        input.ruleResolver,
        { youthProtection: false },
      ),
    );
    expect(result).toEqual(original);
    expect(result.distribution).toBeInstanceOf(Map);
    expect(
      readAnnualAnalysis({ ...input, ruleResolver: createRuleResolver() }, key, null),
    ).toBeNull();
  });
  it("invalidates same-revision edits, settings, youth checks, dates and employment changes", () => {
    const input = request(),
      key = annualAnalysisKey(input);
    const initial = drain(prepareAnnualAnalysisSteps(input, key, null));
    for (const updated of [
      { ...input, entries: [{ ...input.entries[0]!, endTime: "08:00" }, input.entries[1]!] },
      { ...input, referenceDate: "2026-10-29" },
      { ...input, youthProtection: true },
      { ...input, profile: { ...input.profile, weeklyMinutes: 1800 } },
      {
        ...input,
        workPatternSettings: { ...input.workPatternSettings, updatedAt: "2026-10-28T12:00:00Z" },
      },
    ])
      expect(annualAnalysisKey(updated)).not.toBe(key);
    const edited = {
      ...input,
      entries: [{ ...input.entries[0]!, endTime: "08:00" }, input.entries[1]!],
    };
    const result = drain(prepareAnnualAnalysisSteps(edited, annualAnalysisKey(edited), null));
    expect(result.actualMinutes).not.toBe(initial.actualMinutes);
    expect(readAnnualAnalysis(input, key, null)).toBe(initial);
  });
  it("bounds complete snapshots while retaining the current year", () => {
    const input = request(),
      key = annualAnalysisKey(input);
    const current = drain(prepareAnnualAnalysisSteps(input, key, null));
    for (let year = 2027; year < 2036; year++) {
      const other = { ...input, year };
      drain(prepareAnnualAnalysisSteps(other, annualAnalysisKey(other), null));
    }
    expect(readAnnualAnalysis(input, key, null)).toBe(current);
    const old = { ...input, year: 2027 };
    expect(readAnnualAnalysis(old, annualAnalysisKey(old), null)).toBeNull();
  });
  it("keeps the original yearly core while yielding inside its first month", () => {
    const input = request();
    const generator = buildAnnualCoreReportSteps(input.year, input.entries, input.profile);
    expect(generator.next().done).toBe(false);
    expect(drain(buildAnnualCoreReportSteps(input.year, input.entries, input.profile))).toEqual(
      buildAnnualCoreReport(input.year, input.entries, input.profile),
    );
  });
  it("includes relevant entries beyond year boundaries and ignores unrelated archives", () => {
    const input = request();
    const boundary = forecastShift({ id: "boundary", date: "2025-12-31" });
    const entries = [
      ...input.entries,
      boundary,
      forecastShift({ id: "archive", date: "2010-01-01" }),
    ];
    const selected = selectAnnualReportInputs(
      null,
      input.year,
      entries,
      [],
      input.ruleResolver,
      true,
    );
    expect(selected.entries.some((entry) => entry.id === "boundary")).toBe(true);
    expect(selected.entries.some((entry) => entry.id === "archive")).toBe(false);
  });
});
