import { afterEach, describe, expect, it, vi } from "vitest";
import { captureEmploymentProfile } from "@/domain/employment-history";
import type { CalendarEntry, UserProfile } from "@/domain/types";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { history } from "@/engine/remuneration-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { calculateNumeric } from "../../../modules/luna-rest-pilot/reference";
import type { PilotRequest } from "../../../modules/luna-rest-pilot/protocol";
import type { SharedYearBatch } from "../../../modules/luna-rest-pilot/year-contract";
import { createRuleResolver } from "@/rules/rule-resolver";
import {
  buildAnnualAvailableReportSteps,
  createAnnualAvailableReportCache,
} from "./annual-core-report";
import { buildAnnualNativeReportSteps } from "./annual-native-report";
import type { AnnualRestTransport } from "./annual-rest-transport";
import type { AnalysisWorkYield } from "./analysis-work-queue";
import { annualAnalysisKey, requestAnnualAnalysis, retainAnnualAnalysis } from "./annual-analysis";
import { calendarPerformance } from "@/application/calendar-performance";
import legalValue from "../../../rules/packages/reviewed/de-arbzg-care/2026-01.json";
import holidayValue from "../../../rules/packages/reviewed/de-holidays/2026.json";
import type { RuleHolidayPackage, RuleLegalPackage } from "@/rules/contracts.generated";

const drain = <T>(steps: Generator<number, T, void>) => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};
async function drainAsync<T>(steps: Generator<AnalysisWorkYield, T, void>) {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (typeof step.value !== "number") await step.value;
  }
}
const profile: UserProfile = {
  ...forecastProfile,
  sundayHolidayWorkEligible: true,
  allEmploymentWorkRecorded: true,
};
function data() {
  const values = [];
  for (let month = 1; month <= 12; month++)
    for (const day of [2, 7, 14, 21, 28])
      values.push(
        forecastShift({
          id: `${month}-${day}`,
          date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          type: day === 28 ? "NIGHT" : "DAY",
          startTime: day === 28 ? "21:00" : "08:00",
          endTime: day === 28 ? "07:00" : "16:00",
        }),
      );
  values.push(
    forecastShift({
      id: "year-boundary",
      date: "2025-12-31",
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:00",
    }),
  );
  values.push(
    forecastShift({
      id: "fall-dst",
      date: "2026-10-24",
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:00",
    }),
  );
  return values;
}
function nativeReply(payload: string) {
  const batch = JSON.parse(payload) as SharedYearBatch;
  return {
    schemaVersion: 2,
    engineVersion: "luna-rest-year-v1",
    requestId: batch.requestId,
    parseMs: 0,
    validationMs: 0,
    kernelMs: 0,
    results: batch.requests.map((r) => {
      const request: PilotRequest = {
        ...r,
        days: r.days.map((i) => batch.days[i]),
        shifts: r.shifts.map((i) => batch.shifts[i]),
        intervals: r.intervals.map((i) => batch.intervals[i]),
      };
      return { id: r.id, result: calculateNumeric(request) };
    }),
  };
}
function transport(
  change?: (reply: ReturnType<typeof nativeReply>) => void,
): AnnualRestTransport & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (payload: string) => {
      const reply = nativeReply(payload);
      change?.(reply);
      return { payload: JSON.stringify(reply), nativeMs: 0 };
    }),
  };
}
function args(entries: readonly CalendarEntry[] = data(), work: UserProfile = profile) {
  return [
    2026,
    entries,
    work,
    [],
    DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    "2027-01-10",
    createRuleResolver(),
  ] as const;
}
const events = () =>
  calendarPerformance.report().events.filter((e) => e.kind === "analysis-native-rest");
afterEach(() => {
  calendarPerformance.clear();
  vi.useRealTimers();
});

describe("native annual integration", () => {
  it("preserves the full report with an incomplete neighboring-year holiday catalog", async () => {
    calendarPerformance.start(true);
    const input = args(data(), { ...profile, tariff: null });
    const resolver = createRuleResolver(
      {
        tariff: [],
        legal: [legalValue as RuleLegalPackage],
        holiday: [holidayValue as RuleHolidayPackage],
      },
      { tariff: "tvoed-vka-bt-k", legal: "de-arbzg-care", holiday: "de-holidays" },
    );
    const custom = [input[0], input[1], input[2], input[3], input[4], input[5], resolver] as const;
    const run = transport();
    expect(await drainAsync(buildAnnualNativeReportSteps(...custom, {}, () => true, run))).toEqual(
      drain(buildAnnualAvailableReportSteps(...custom)),
    );
    expect(events().some((e) => e.values.stage === 3 && e.values.count! > 0)).toBe(true);
  }, 20000);
  it.each(["normal", "end-time", "dated-timezone"])(
    "preserves the entire annual report and actually consumes native facts: %s",
    async (kind) => {
      calendarPerformance.start(true);
      const entries = data();
      if (kind === "end-time") entries[4] = { ...entries[4], endTime: "07:05" };
      const work =
        kind === "dated-timezone"
          ? {
              ...profile,
              employmentTimeline: [
                { ...history("2026-01-01"), employment: captureEmploymentProfile(profile) },
                {
                  ...history("2026-07-15"),
                  employment: captureEmploymentProfile({
                    ...profile,
                    timeZone: "America/New_York",
                    federalState: "BY",
                  }),
                },
              ],
            }
          : profile;
      const input = args(entries, work),
        expected = drain(buildAnnualAvailableReportSteps(...input));
      let coreReady = false;
      const run = transport();
      run.run.mockImplementation(async (payload: string) => {
        expect(coreReady).toBe(true);
        return { payload: JSON.stringify(nativeReply(payload)), nativeMs: 0 };
      });
      const actual = await drainAsync(
        buildAnnualNativeReportSteps(
          ...input,
          {
            onCore: () => {
              coreReady = true;
            },
          },
          () => true,
          run,
        ),
      );
      expect(actual).toEqual(expected);
      expect(run.run).toHaveBeenCalledTimes(1);
      expect(events().some((e) => e.values.stage === 2 && e.values.state === 1)).toBe(true);
      expect(events().some((e) => e.values.stage === 3 && e.values.count! > 0)).toBe(true);
      expect(events().filter((e) => e.values.state === 2)).toEqual([]);
      const batch = JSON.parse(run.run.mock.calls[0][0]) as SharedYearBatch;
      expect(batch.days.length).toBeLessThan(
        batch.requests.reduce((sum, r) => sum + r.days.length, 0),
      );
    },
    20000,
  );
  it("uses matching restored monthly parts without another native call", async () => {
    const input = args(),
      cache = createAnnualAvailableReportCache(),
      run = transport();
    const first = await drainAsync(
      buildAnnualNativeReportSteps(...input, { cache }, () => true, run),
    );
    expect(run.run).toHaveBeenCalledTimes(1);
    run.run.mockClear();
    const second = await drainAsync(
      buildAnnualNativeReportSteps(...input, { cache }, () => true, run),
    );
    expect(second).toEqual(first);
    expect(run.run).not.toHaveBeenCalled();
  }, 20000);
  it.each(["failure", "stale-identity", "invalid-result"])(
    "falls back completely after native %s",
    async (kind) => {
      calendarPerformance.start(true);
      const input = args(),
        expected = drain(buildAnnualAvailableReportSteps(...input));
      const run = transport((reply) => {
        if (kind === "stale-identity") reply.requestId = "previous";
        if (kind === "invalid-result")
          reply.results[0].result = {
            ...reply.results[0].result,
            matched: [{ obligationIndex: 999999, candidateIndex: 999999 }],
          };
      });
      if (kind === "failure") run.run.mockRejectedValue(new Error("native failure"));
      expect(await drainAsync(buildAnnualNativeReportSteps(...input, {}, () => true, run))).toEqual(
        expected,
      );
      expect(events().some((e) => e.values.stage === 2 && e.values.state === 2)).toBe(true);
      expect(events().some((e) => e.values.stage === 3 && e.values.count! > 0)).toBe(false);
    },
    20000,
  );
  it("does not start native work for an empty or youth year", async () => {
    for (const [entries, options] of [
      [[], {}],
      [data(), { youthProtection: true }],
    ] as const) {
      const input = args(entries),
        run = transport();
      expect(
        await drainAsync(buildAnnualNativeReportSteps(...input, options, () => true, run)),
      ).toEqual(drain(buildAnnualAvailableReportSteps(...input, options)));
      expect(run.run).not.toHaveBeenCalled();
    }
  }, 20000);
  it("ignores a late native answer after generator disposal", async () => {
    calendarPerformance.start(true);
    let finish!: () => void;
    const run: AnnualRestTransport = {
      run: (payload) =>
        new Promise((resolve) => {
          finish = () => resolve({ payload: JSON.stringify(nativeReply(payload)), nativeMs: 0 });
        }),
    };
    const steps = buildAnnualNativeReportSteps(...args(), {}, () => true, run);
    let pending: Promise<void> | undefined;
    for (;;) {
      const step = steps.next();
      if (step.done) throw new Error("Expected native suspension");
      if (typeof step.value !== "number") {
        pending = step.value;
        break;
      }
    }
    steps.return(undefined as never);
    finish();
    await pending;
    expect(events().some((e) => e.values.stage === 2 && e.values.state === 3)).toBe(true);
    expect(events().some((e) => e.values.stage === 3 && e.values.count! > 0)).toBe(false);
  });
  it("rejects changed input before a native answer can populate monthly caches", async () => {
    const entries = data();
    let finish!: () => void;
    const run: AnnualRestTransport = {
      run: (payload) =>
        new Promise((resolve) => {
          finish = () => resolve({ payload: JSON.stringify(nativeReply(payload)), nativeMs: 0 });
        }),
    };
    const save = vi.fn(),
      steps = buildAnnualNativeReportSteps(...args(entries), { onMonth: save }, () => true, run);
    let pending: Promise<void> | undefined;
    for (;;) {
      const step = steps.next();
      if (step.done) throw new Error("Expected suspension");
      if (typeof step.value !== "number") {
        pending = step.value;
        break;
      }
    }
    entries[0] = { ...entries[0], endTime: "17:00" };
    finish();
    await pending;
    expect(() => steps.next()).toThrow("input changed");
    expect(save).not.toHaveBeenCalled();
  });
  it("returns a complete retained report without scheduling any native work", () => {
    const input = args();
    const request = {
      year: input[0],
      entries: input[1],
      profile: input[2],
      tariffDecisions: input[3],
      workPatternSettings: input[4],
      referenceDate: input[5],
      ruleResolver: input[6],
      youthProtection: false,
    };
    const expected = drain(buildAnnualAvailableReportSteps(...input)),
      key = annualAnalysisKey(request);
    retainAnnualAnalysis(request, key, null, expected);
    calendarPerformance.start(true);
    const complete = vi.fn(),
      fail = vi.fn();
    const lease = requestAnnualAnalysis(request, key, null, -1, complete, fail);
    expect(complete).toHaveBeenCalledExactlyOnceWith(expected);
    expect(events()).toEqual([]);
    lease.cancel();
  });
});
