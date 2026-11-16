import type { CalendarEntry, UserProfile } from "@/domain/types";
import { prepareComplianceCalendarSteps, type ComplianceOptions } from "@/engine/compliance";
import {
  createCompliancePreparation,
  type ComplianceCalendarContext,
} from "@/engine/compliance-preparation";
import { datedComplianceInputs } from "@/engine/dated-compliance";
import {
  calendarDayBounds,
  calendarDate,
  calendarValueDay,
} from "@/engine/compliance-rest-calendar";
import { knownHolidayDatesIncrementally } from "@/engine/compliance-sunday-holiday-rest";
import {
  restContextKey,
  type HolidayCoverage,
  type PreparedRestKernel,
} from "@/engine/compliance-rest-kernel";
import type { ComplianceInterval } from "@/engine/compliance-sequences";
import type { RuleResolver } from "@/rules/rule-resolver";
import type { PilotDay, PilotRequest } from "../../../modules/luna-rest-pilot/protocol";
import {
  packYearRequests,
  YEAR_ENGINE_VERSION,
} from "../../../modules/luna-rest-pilot/year-contract";
import {
  annualComplianceInput,
  type AnnualComputationOptions,
  type AnnualRestPreparation,
} from "./annual-core-report";
import { readRestFacts, restArray, restNumber, restRecord } from "./annual-rest-result";
import type { AnnualRestTransport } from "./annual-rest-transport";
import { calendarPerformance } from "@/application/calendar-performance";

interface Item {
  readonly context: ComplianceCalendarContext;
  readonly request: PilotRequest;
  readonly holidays: HolidayCoverage;
  readonly options: ComplianceOptions;
}
let nextRequest = 0;
export function createAnnualRestSession() {
  let active = true;
  let hits = 0,
    requestedYear = 0;
  let facts = new WeakMap<readonly ComplianceInterval[], Map<string, PreparedRestKernel>>();
  const items: Item[] = [];
  const preparation: AnnualRestPreparation = {
    inputs: new Map(),
    contexts: createCompliancePreparation(),
    provider: {
      get: (intervals, month, state, region, from, through) => {
        const value = active
          ? facts.get(intervals)?.get(restContextKey(month, state, region, from, through))
          : undefined;
        if (value) hits++;
        return value;
      },
    },
  };
  return {
    preparation,
    items,
    dispose() {
      if (requestedYear)
        calendarPerformance.record("analysis-native-rest", {
          month: requestedYear * 100 + 1,
          stage: 3,
          count: hits,
          state: hits > 0 ? 1 : 0,
        });
      active = false;
      facts = new WeakMap();
      items.length = 0;
      preparation.inputs.clear();
    },
    async compute(transport: AnnualRestTransport, year: number, current: () => boolean) {
      if (!active || !current() || items.length === 0) return;
      requestedYear = year;
      const finish = calendarPerformance.span("analysis-native-rest", {
        month: year * 100 + 1,
        stage: 2,
        count: items.length,
      });
      try {
        const packed = packYearRequests(
          `year-${year}-${++nextRequest}`,
          items.map((item) => item.request),
        );
        const payload = JSON.stringify(packed.batch);
        if (payload.length > 4 * 1024 * 1024) throw new Error("Native annual input limit");
        const response = await transport.run(payload);
        if (!active || !current()) {
          finish({ state: 3 });
          return;
        }
        const decoding = performance.now();
        if (typeof response.payload !== "string" || response.payload.length > 4 * 1024 * 1024)
          throw new Error("Invalid native annual response");
        const reply = restRecord(JSON.parse(response.payload));
        if (
          reply.schemaVersion !== 2 ||
          reply.engineVersion !== YEAR_ENGINE_VERSION ||
          reply.requestId !== packed.batch.requestId
        )
          throw new Error("Native annual identity mismatch");
        const results = restArray(reply.results, 64);
        if (results.length !== packed.batch.requests.length)
          throw new Error("Native annual result count");
        for (let i = 0; i < results.length; i++)
          if (restRecord(results[i]).id !== packed.batch.requests[i].id)
            throw new Error("Native annual result order");
        const next = new WeakMap<readonly ComplianceInterval[], Map<string, PreparedRestKernel>>();
        for (let i = 0; i < items.length; i++) {
          const item = items[i],
            value = restRecord(results[packed.indices[i]]).result;
          const result = readRestFacts(value, item.request, item.context, item.holidays);
          const map = next.get(item.context.intervals) ?? new Map();
          map.set(
            restContextKey(
              item.request.month,
              item.options.federalState,
              item.options.holidayRegion,
              item.context.start,
              item.context.end,
            ),
            result,
          );
          next.set(item.context.intervals, map);
        }
        const nativeMs = restNumber(response.nativeMs),
          kernelMs = restNumber(reply.kernelMs);
        restNumber(reply.parseMs);
        restNumber(reply.validationMs);
        if (!active || !current()) {
          finish({ state: 3 });
          return;
        }
        facts = next;
        finish({
          state: 1,
          input: payload.length,
          output: response.payload.length,
          nodes: packed.batch.requests.length,
          cpu: performance.now() - decoding,
          wait: nativeMs,
          kernel: kernelMs,
        });
      } catch {
        // The regular generator will evaluate every missing fact with TypeScript.
        facts = new WeakMap();
        finish({ state: 2 });
      }
    },
  };
}

export function* prepareAnnualRestSteps(
  year: number,
  entries: readonly CalendarEntry[],
  profile: UserProfile,
  referenceDate: string,
  resolver: RuleResolver,
  options: AnnualComputationOptions,
  session: ReturnType<typeof createAnnualRestSession>,
): Generator<number, void, void> {
  if (options.youthProtection) return;
  const finish = calendarPerformance.span("analysis-native-rest", {
    month: year * 100 + 1,
    stage: 1,
  });
  const days = new Map<string, PilotDay>();
  const normalized = new WeakMap<
    ComplianceInterval,
    { start: number; last: number; wire: { shiftId: string; startMs: number; endMs: number } }
  >();
  const holidays = new Map<string, HolidayCoverage>();
  const monthsCache = options.cache?.get(resolver);
  try {
    for (let number = 1; number <= 12; number++) {
      const month = `${year}-${String(number).padStart(2, "0")}`;
      const input = annualComplianceInput(
        month,
        entries,
        profile,
        referenceDate,
        resolver,
        options.youthProtection,
      );
      session.preparation.inputs.set(month, input);
      if (input.shifts === null || monthsCache?.get(month)?.compliance?.key === input.key) continue;
      const p = input.profile;
      const base: ComplianceOptions = {
        preparation: session.preparation.contexts,
        employmentProfile: p,
        federalState: p.federalState,
        holidayRegion: p.holidayRegion,
        referenceDate,
        ruleResolver: resolver,
        weeklyMinutes: p.weeklyMinutes,
        regularRotatingNightWork: p.regularRotatingNightWork,
        sundayHolidayWorkEligible: p.sundayHolidayWorkEligible,
        allEmploymentWorkRecorded: p.allEmploymentWorkRecorded,
        youthProtection: options.youthProtection,
      };
      for (const dated of datedComplianceInputs(month, p.timeZone, base)) {
        const context = yield* prepareComplianceCalendarSteps(
          month,
          input.shifts,
          dated.timeZone,
          dated.options,
        );
        const rest = context.rules.sundayHolidayRest;
        if (
          !rest ||
          context.legalPackage.engineContractVersion < 5 ||
          !dated.options.federalState ||
          !rest.eligibleSectorIds.includes(dated.options.sectorId ?? "care") ||
          context.intervals.length === 0
        )
          continue;
        if (context.intervals.length > 5000 || context.calculationShifts.length > 5000) continue;
        const uniqueShifts = new Set(context.calculationShifts.map((s) => s.id)),
          uniqueIntervals = new Set(context.intervals.map((i) => i.shift.id));
        if (
          uniqueShifts.size !== context.calculationShifts.length ||
          uniqueIntervals.size !== context.intervals.length
        )
          continue;
        const years = new Set([year]);
        let first = calendarValueDay(context.start),
          last = calendarValueDay(context.end);
        const intervals = context.intervals.map((interval) => {
          let value = normalized.get(interval);
          if (!value) {
            value = {
              start: calendarValueDay(interval.start.toPlainDate().toString()),
              last: calendarValueDay(
                interval.end.subtract({ nanoseconds: 1 }).toPlainDate().toString(),
              ),
              wire: {
                shiftId: interval.shift.id,
                startMs: interval.start.epochMilliseconds,
                endMs: interval.end.epochMilliseconds,
              },
            };
            normalized.set(interval, value);
          }
          first = Math.min(first, value.start);
          last = Math.max(last, value.last);
          for (
            let y = calendarDate(value.start).date.year;
            y <= calendarDate(value.last).date.year;
            y++
          )
            years.add(y);
          return value.wire;
        });
        if (last - first + 1 > 1000) continue;
        for (const shift of context.calculationShifts) years.add(Number(shift.date.slice(0, 4)));
        const holidayKey = JSON.stringify([
          [...years].sort(),
          dated.options.federalState,
          dated.options.holidayRegion,
          p,
        ]);
        let coverage = holidays.get(holidayKey);
        if (!coverage) {
          coverage = yield* knownHolidayDatesIncrementally(
            years,
            dated.options.federalState,
            dated.options.holidayRegion ?? "NONE",
            resolver,
            p,
          );
          holidays.set(holidayKey, coverage);
        }
        const table: PilotDay[] = [];
        let slice = performance.now();
        for (let day = first; day <= last; day++) {
          const key = `${dated.timeZone}:${day}`;
          let value = days.get(key);
          if (!value) {
            const bounds = calendarDayBounds(day, dated.timeZone);
            value = {
              day,
              date: calendarDate(day).value,
              startMs: bounds.start,
              endMs: bounds.end,
            };
            days.set(key, value);
          }
          table.push(value);
          if (table.length % 64 === 0 || performance.now() - slice >= 3) {
            yield table.length;
            slice = performance.now();
          }
        }
        session.items.push({
          context,
          holidays: coverage,
          options: dated.options,
          request: {
            schemaVersion: 1,
            id: `context-${session.items.length}`,
            month,
            timeZone: dated.timeZone,
            coverageStart: calendarValueDay(context.start),
            coverageEnd: calendarValueDay(context.end),
            sundayPeriodDays: rest.sundayCompensationPeriodDays,
            holidayPeriodDays: rest.weekdayHolidayCompensationPeriodDays,
            requiredRestMinutes: rest.replacementDayMinutes + rest.connectedRestMinutes,
            evidenceShiftType: rest.evidenceShiftType,
            days: table,
            holidays: [...coverage.dates].map(calendarValueDay).sort((a, b) => a - b),
            shifts: context.calculationShifts.map((s) => ({
              id: s.id,
              date: s.date,
              type: s.type,
              startTime: s.startTime,
              endTime: s.endTime,
              deletedAt: s.deletedAt,
            })),
            intervals,
          },
        });
      }
      yield number;
    }
    finish({ state: 1, count: session.items.length, input: days.size });
  } catch {
    session.items.length = 0;
    finish({ state: 2 });
  }
}
