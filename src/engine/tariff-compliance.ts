import { Temporal } from "@js-temporal/polyfill";
import { dutyInstant } from "@/domain/special-duty";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import { TARIFF_SCOPE_SOURCE, TARIFF_WEEKLY_CHECK_ASSUMPTION } from "@/domain/tariff-time-policy";
import type { ComplianceIssue, ShiftEntry, UserProfile } from "@/domain/types";
import { dutyWorkParts } from "./special-duty";
import { tariffContextAt, type TariffTimeContext } from "./tariff-compliance-context";

export interface TariffComplianceOptions {
  readonly employmentProfile?: UserProfile;
  readonly referenceDate?: string;
  readonly youthProtection?: boolean;
  readonly employmentAssessmentPeriod?: { readonly from: string; readonly until: string | null };
}

export function recordedWorkDates(shift: ShiftEntry, timeZone: string): readonly string[] {
  if (
    shift.deletedAt !== null ||
    shift.allDay ||
    ["FREE", "VACATION", "SICK"].includes(shift.type) ||
    !shift.startTime ||
    !shift.endTime
  )
    return [];
  try {
    const intervals = shift.specialDuty
      ? dutyWorkParts(shift).map((part) => ({
          start: dutyInstant(shift.date, part.start, shift.specialDuty!.timeZone).withTimeZone(
            timeZone,
          ),
          end: dutyInstant(shift.date, part.end, shift.specialDuty!.timeZone).withTimeZone(
            timeZone,
          ),
          breakMinutes: part.breakMinutes,
        }))
      : [
          {
            start: Temporal.PlainDate.from(shift.date).toZonedDateTime({
              timeZone,
              plainTime: shift.startTime,
            }),
            end: Temporal.PlainDate.from(shift.date)
              .add({ days: shift.endTime <= shift.startTime ? 1 : 0 })
              .toZonedDateTime({ timeZone, plainTime: shift.endTime }),
            breakMinutes: shift.breakMinutes,
          },
        ];
    const dates = new Set<string>();
    for (const { start, end, breakMinutes } of intervals) {
      if (Temporal.ZonedDateTime.compare(end, start) <= 0) continue;
      const last = end.subtract({ nanoseconds: 1 }).toPlainDate();
      let day = start.toPlainDate();
      for (
        let n = 0;
        n < 16 && Temporal.PlainDate.compare(day, last) <= 0;
        n++, day = day.add({ days: 1 })
      ) {
        const dayStart = day.toZonedDateTime(timeZone);
        const dayEnd = day.add({ days: 1 }).toZonedDateTime(timeZone);
        const lower = Temporal.ZonedDateTime.compare(start, dayStart) > 0 ? start : dayStart;
        const upper = Temporal.ZonedDateTime.compare(end, dayEnd) < 0 ? end : dayEnd;
        const grossMinutes = Number(upper.epochMilliseconds - lower.epochMilliseconds) / 60000;
        // A short midnight slice could consist entirely of an unlocated pause.
        // Count only calendar days with some work even under that possibility.
        if (grossMinutes > breakMinutes) dates.add(day.toString());
      }
    }
    return [...dates].sort();
  } catch {
    // Missing/invalid timestamps never become proof of either work or free time.
    return [];
  }
}

const localDays = (from: Temporal.PlainDate, count: number) =>
  Array.from({ length: count }, (_, n) => from.add({ days: n }).toString());
const monday = (day: Temporal.PlainDate) => day.subtract({ days: day.dayOfWeek - 1 });

function evidence(
  context: TariffTimeContext,
  from: string,
  until: string,
  reference: string,
  freeDays = false,
): TariffComplianceEvidence {
  return {
    tariffLabel: context.label,
    ruleId: freeDays ? "TARIFF_FREE_DAYS" : "TARIFF_WEEK_DAYS",
    status: context.unavailable ? "UNAVAILABLE" : until >= reference ? "PENDING" : "REVIEW",
    period: { from, until },
    source: (freeDays ? context.policy?.freeSource : context.policy?.source) ?? TARIFF_SCOPE_SOURCE,
    ruleText:
      (freeDays ? context.policy?.freeRuleText : context.policy?.ruleText) ??
      "Die anwendbare Tarifgrundlage ist noch zu bestimmen.",
    requirements: context.requirements,
  };
}

function freeDayRequirements(
  context: TariffTimeContext,
  contexts: readonly (TariffTimeContext | null)[],
): readonly string[] {
  const mixed = new Set(contexts.map((item) => item?.key ?? "NONE")).size > 1;
  return [
    ...context.requirements,
    "Die Zuordnung des tariflichen Zweiwochen-Bezugszeitraums ist zu bestätigen; dieses Fenster ist ein Beobachtungszeitraum.",
    ...(contexts.every((item) => item?.sundayWorkModelKnown === true)
      ? []
      : [
          "Prüfe, ob regelmäßig Sonn- und Feiertagsarbeit im Sinne der Tarifregel geleistet wird. Die Zulässigkeit von Sonntagsarbeit allein bestätigt diese Regelmäßigkeit nicht.",
        ]),
    "Leere Kalendertage sind kein Nachweis tatsächlich arbeitsfreier Tage.",
    ...(contexts.some((item) => item !== null && !item.scopeConfirmed)
      ? ["Der persönliche Geltungsbereich dieser Tarifregel ist zu bestätigen."]
      : []),
    ...(mixed
      ? ["Ein Tarifwechsel innerhalb des Beobachtungszeitraums muss gesondert geprüft werden."]
      : []),
  ];
}

function finding(
  rule: string,
  date: string,
  title: string,
  description: string,
  tariff: TariffComplianceEvidence,
  ids: readonly string[],
): ComplianceIssue {
  return {
    id: `${rule}:${tariff.tariffLabel}:${tariff.period.from}:${tariff.period.until}`,
    kind: "LEGAL",
    severity: "info",
    rule,
    title,
    description,
    date,
    tariff,
    relatedShiftIds: [...new Set(ids)].sort(),
    assessmentRanges: [
      {
        from: tariff.period.from,
        through: Temporal.PlainDate.from(tariff.period.until).add({ days: 1 }).toString(),
      },
    ],
  };
}

/**
 * Evaluate recorded tariff candidates without treating forecasts, blank days or
 * salary selections as proof of individual applicability or legal breaches.
 */
export function* checkTariffWorkingTimeSteps(
  month: string,
  shifts: readonly ShiftEntry[],
  timeZone: string,
  options: TariffComplianceOptions = {},
): Generator<number, ComplianceIssue[], void> {
  const profile = options.employmentProfile;
  if (!profile || options.youthProtection === true) return [];
  const first = Temporal.PlainDate.from(month + "-01");
  const last = first.with({ day: first.daysInMonth });
  const scanStart = monday(first).subtract({ days: 7 });
  const scanEnd = monday(last).add({ days: 13 });
  const reference = options.referenceDate ?? Temporal.Now.plainDateISO(timeZone).toString();
  const work = new Map<string, Set<string>>();
  // Weekly distribution uses entry start dates. Free-day/Sunday checks below
  // retain actual work on every touched date, including overnight spillover.
  const starts = new Map<string, Set<string>>();
  const unique = new Map<string, ShiftEntry>();
  let checkpoint = 0;
  yield checkpoint;
  for (const shift of shifts) {
    const current = unique.get(shift.id);
    if (
      !current ||
      shift.revision > current.revision ||
      (shift.revision === current.revision && shift.updatedAt > current.updatedAt)
    )
      unique.set(shift.id, shift);
    if (++checkpoint % 8 === 0) yield checkpoint;
  }
  const earliestEntry = scanStart.subtract({ days: 15 }).toString();
  const latestEntry = scanEnd.toString();
  for (const shift of unique.values()) {
    if (shift.date >= earliestEntry && shift.date <= latestEntry) {
      const workedDates = recordedWorkDates(shift, timeZone);
      if (workedDates.length && shift.date >= scanStart.toString()) {
        const ids = starts.get(shift.date) ?? new Set<string>();
        ids.add(shift.id);
        starts.set(shift.date, ids);
      }
      for (const date of workedDates) {
        if (date < scanStart.toString() || date > latestEntry) continue;
        const ids = work.get(date) ?? new Set<string>();
        ids.add(shift.id);
        work.set(date, ids);
      }
    }
    if (++checkpoint % 4 === 0) yield checkpoint;
  }
  if (work.size === 0) return [];
  const cache = new Map<string, TariffTimeContext | null>();
  const contextAt = (date: string) => {
    if (!cache.has(date)) cache.set(date, tariffContextAt(profile, date));
    return cache.get(date)!;
  };
  const result: ComplianceIssue[] = [];
  const inDisplayPeriod = (date: string) =>
    date.startsWith(month + "-") &&
    (!options.employmentAssessmentPeriod ||
      (date >= options.employmentAssessmentPeriod.from &&
        (!options.employmentAssessmentPeriod.until ||
          date < options.employmentAssessmentPeriod.until)));

  const missing = new Map<string, { context: TariffTimeContext; dates: string[] }>();
  for (const date of [...work.keys()].sort()) {
    if (date.startsWith(month + "-")) {
      const context = contextAt(date);
      if (context?.unavailable) {
        const item = missing.get(context.key) ?? { context, dates: [] };
        item.dates.push(date);
        missing.set(context.key, item);
      }
    }
    if (++checkpoint % 4 === 0) yield checkpoint;
  }
  for (const { context, dates } of missing.values()) {
    if (!inDisplayPeriod(dates[0])) continue;
    const tariff: TariffComplianceEvidence = {
      ...evidence(context, dates[0], dates.at(-1)!, reference),
      ruleId: "TARIFF_SCOPE",
      status: "UNAVAILABLE",
      recordedDates: dates,
    };
    result.push(
      finding(
        "TARIFF_SCOPE",
        dates[0],
        "Tarifgrundlage prüfen",
        "Für die erfassten Dienste ist die tarifliche Prüfgrundlage nicht hinreichend bestimmt.",
        tariff,
        dates.flatMap((date) => [...work.get(date)!]),
      ),
    );
  }

  // Two occupied Sundays are observable even in a sparse calendar. They do not
  // establish regular Sunday work or the binding allocation of a tariff fortnight.
  for (
    let start = scanStart;
    Temporal.PlainDate.compare(start, monday(last)) <= 0;
    start = start.add({ days: 7 })
  ) {
    const dates = localDays(start, 14);
    const sundays = [dates[6], dates[13]];
    const until = sundays[1];
    if (!inDisplayPeriod(until) || !sundays.every((date) => work.has(date))) continue;
    const contexts: (TariffTimeContext | null)[] = [];
    for (const date of dates) {
      contexts.push(contextAt(date));
      if (++checkpoint % 4 === 0) yield checkpoint;
    }
    const context = contexts[13] ?? contexts.find((value) => value !== null);
    if (
      !context?.policy?.freeSource ||
      context.unavailable ||
      sundays.some((date) => contextAt(date)?.sundayHolidayWorkEligible === false)
    )
      continue;
    const tariff: TariffComplianceEvidence = {
      ...evidence(context, dates[0], until, reference, true),
      ruleId: "TARIFF_FREE_SUNDAY",
      ruleText:
        "Von den zwei arbeitsfreien Tagen innerhalb von zwei Wochen soll ein Tag auf einen Sonntag fallen.",
      count: 2,
      recordedDates: sundays,
      requirements: freeDayRequirements(context, contexts),
    };
    result.push(
      finding(
        "TARIFF_FREE_SUNDAY",
        until,
        "Beide Sonntage mit Diensten",
        "An beiden Sonntagen des Beobachtungszeitraums sind Tätigkeiten erfasst. Prüfe die tarifliche Sollvorgabe zur Lage eines freien Tages am Sonntag.",
        tariff,
        sundays.flatMap((date) => [...work.get(date)!]),
      ),
    );
  }

  // Start dates and occupied dates can differ around midnight and pauses.
  if (work.size <= 6 && starts.size <= 6) return result;

  for (
    let start = scanStart;
    Temporal.PlainDate.compare(start, monday(last)) <= 0;
    start = start.add({ days: 7 })
  ) {
    const dates = localDays(start, 7);
    const worked = dates.filter((date) => starts.has(date));
    if (worked.length <= 6 || !inDisplayPeriod(worked[6])) continue;
    const contexts: (TariffTimeContext | null)[] = [];
    for (const date of dates) {
      contexts.push(contextAt(date));
      if (++checkpoint % 4 === 0) yield checkpoint;
    }
    const context = contextAt(worked[6]) ?? contexts.find((value) => value !== null);
    if (!context || context.unavailable) continue;
    const date = worked[6];
    const mixed = new Set(contexts.map((item) => item?.key ?? "NONE")).size > 1;
    const rule = context.unavailable ? "TARIFF_SCOPE" : "TARIFF_WEEK_DAYS";
    const base = evidence(context, dates[0], dates[6], reference);
    const tariff: TariffComplianceEvidence = {
      ...base,
      ruleId: rule,
      count: worked.length,
      limit: 6,
      recordedDates: worked,
      requirements: [
        ...base.requirements,
        "Prüfe, welche erfassten Tätigkeiten regelmäßige Arbeitszeit und welche zusätzliche Arbeit sind.",
        TARIFF_WEEKLY_CHECK_ASSUMPTION,
        ...(contexts.some((item) => item !== null && !item.scopeConfirmed)
          ? ["Der persönliche Geltungsbereich der gewählten Tarifregel ist zu bestätigen."]
          : []),
        ...(mixed
          ? [
              "Innerhalb dieser Woche ändert sich die Tarifzuordnung oder eine Prüfgrundlage. Die Teilzeiträume sind getrennt zu beurteilen.",
            ]
          : []),
      ],
    };
    result.push(
      finding(
        rule,
        date,
        context.unavailable
          ? "Tarifgrundlage prüfen"
          : `Arbeit an allen ${worked.length} Tagen der Kalenderwoche`,
        `${worked.length} Tage mit Dienstbeginn in einer Kalenderwoche. ${TARIFF_WEEKLY_CHECK_ASSUMPTION}`,
        tariff,
        worked.flatMap((d) => [...starts.get(d)!]),
      ),
    );
  }

  // These are clearly labelled observation windows, not an invented binding
  // fortnight allocation. Only even the maximum possible freedom can fail here.
  for (
    let start = scanStart;
    Temporal.PlainDate.compare(start, monday(last)) <= 0;
    start = start.add({ days: 7 })
  ) {
    const dates = localDays(start, 14);
    const until = dates[13];
    if (!inDisplayPeriod(until)) continue;
    const worked = dates.filter((date) => work.has(date));
    const possibleFree = 14 - worked.length;
    const blockPossible = dates.some(
      (date, n) => n < 13 && !work.has(date) && !work.has(dates[n + 1]),
    );
    // If both free-day models remain possible, no tariff context can produce
    // a finding. Blank dates are still possibilities, never confirmed freedom.
    if (possibleFree >= 2 && blockPossible) continue;
    if (!worked.some((date) => Temporal.PlainDate.from(date).dayOfWeek === 7)) continue;
    const contexts: (TariffTimeContext | null)[] = [];
    for (const date of dates) {
      contexts.push(contextAt(date));
      if (++checkpoint % 4 === 0) yield checkpoint;
    }
    const context = contexts[13] ?? contexts.find((value) => value !== null);
    if (
      !context?.policy?.freeSource ||
      context.unavailable ||
      context.sundayHolidayWorkEligible === false
    )
      continue;
    if (possibleFree >= 2 && (!context.policy.consecutiveFreeDays || blockPossible)) continue;
    const base = evidence(context, dates[0], until, reference, true);
    const tariff: TariffComplianceEvidence = {
      ...base,
      count: worked.length,
      recordedDates: worked,
      requirements: freeDayRequirements(context, contexts),
    };
    result.push(
      finding(
        "TARIFF_FREE_DAYS",
        until,
        "Tarifliches Frei prüfen",
        context.policy.consecutiveFreeDays
          ? `Im Beobachtungszeitraum lassen die erfassten Tätigkeiten keinen möglichen zusammenhängenden Zweitageblock übrig. ${tariff.ruleText}`
          : `Im Beobachtungszeitraum liegen Tätigkeiten an ${worked.length} von 14 Kalendertagen. ${tariff.ruleText}`,
        tariff,
        worked.flatMap((date) => [...work.get(date)!]),
      ),
    );
  }
  return result;
}
