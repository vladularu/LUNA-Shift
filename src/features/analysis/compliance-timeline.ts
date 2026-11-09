import { Temporal } from "@js-temporal/polyfill";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { calculateTimedShiftBounds } from "@/engine/working-time";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";
import {
  complianceCompensationSummary,
  complianceIssueSummary,
  complianceLimitHours,
} from "./compliance-issue-summary";
import {
  legacyComplianceRestPresentation,
  legacyComplianceSeriesCount,
} from "./compliance-issue-legacy";

export interface RestTimeline {
  readonly previous: ShiftEntry;
  readonly next: ShiftEntry;
  readonly endDate: string;
  readonly startDate: string;
  readonly minutes: number;
}
export interface WorkSeries {
  readonly count: number;
  readonly unit: "Arbeitstage" | "Diensttage" | "Nachtdienste" | "Nächte";
  readonly from: string | null;
  readonly until: string | null;
  readonly dutyPeriod?: {
    readonly fromDate: string;
    readonly fromTime: string;
    readonly untilDate: string;
    readonly untilTime: string;
  };
}
const REST_RULES = new Set([
  "ARBZG_5_REST_10H",
  "ARBZG_5_REST_11H",
  "JARBSCHG_13_REST",
  "PLANNING_LATE_EARLY",
]);

// Presentation only. Legal findings and their original explanations stay unchanged.
export function complianceTimeline(
  issue: ComplianceIssue,
  shifts: readonly ShiftEntry[],
  timeZone: string,
) {
  const ids = new Set(issue.relatedShiftIds);
  const related = shifts
    .filter((shift) => ids.has(shift.id) && shift.deletedAt === null)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
        a.id.localeCompare(b.id),
    );
  const missing = related.length !== ids.size;
  const facts = validComplianceIssueFacts(issue.facts, issue.rule);
  const nightSequence =
    facts?.rule === "PLANNING_NIGHT_SERIES" || facts?.rule === "PLANNING_NIGHT_RECOVERY"
      ? (facts.nightSequence ?? null)
      : null;
  const endpoints = nightSequence
    ? related.filter(
        (shift) => shift.id === nightSequence.lastShiftId || shift.id === nightSequence.nextShiftId,
      )
    : related;
  let rest: RestTimeline | null = null;
  if (
    (REST_RULES.has(issue.rule) || nightSequence?.restMinutes != null) &&
    !missing &&
    endpoints.length === 2 &&
    !endpoints.some((shift) => shift.specialDuty)
  ) {
    try {
      const bounds = endpoints
        .map((shift) => ({ shift, bounds: calculateTimedShiftBounds(shift, timeZone) }))
        .filter(
          (
            item,
          ): item is {
            shift: ShiftEntry;
            bounds: NonNullable<ReturnType<typeof calculateTimedShiftBounds>>;
          } => item.bounds !== null,
        )
        .sort((a, b) => a.bounds.startEpochMinutes - b.bounds.startEpochMinutes);
      if (bounds.length === 2) {
        const [previous, next] = bounds;
        const minutes = next.bounds.startEpochMinutes - previous.bounds.endEpochMinutes;
        if (minutes >= 0)
          rest = {
            previous: previous.shift,
            next: next.shift,
            minutes,
            endDate: Temporal.Instant.fromEpochMilliseconds(
              previous.bounds.endEpochMinutes * 60_000,
            )
              .toZonedDateTimeISO(timeZone)
              .toPlainDate()
              .toString(),
            startDate: Temporal.Instant.fromEpochMilliseconds(
              next.bounds.startEpochMinutes * 60_000,
            )
              .toZonedDateTimeISO(timeZone)
              .toPlainDate()
              .toString(),
          };
      }
    } catch {
      // Invalid or unavailable times must not become a fabricated rest duration.
    }
  }
  let series: WorkSeries | null = null;
  const legacy = !("facts" in issue);
  const count = legacy
    ? legacyComplianceSeriesCount(issue)
    : facts?.rule === "PLANNING_7_DAYS" || facts?.rule === "PLANNING_NIGHT_SERIES"
      ? facts.count
      : null;
  if (count !== null) {
    const dates = [...new Set(related.map((shift) => shift.date))].sort();
    let complete = !missing && dates.length === count;
    try {
      dates.forEach((date, index) => {
        Temporal.PlainDate.from(date);
        if (
          index &&
          Temporal.PlainDate.from(dates[index - 1])
            .add({ days: 1 })
            .toString() !== date
        )
          complete = false;
      });
    } catch {
      complete = false;
    }
    let dutyPeriod: WorkSeries["dutyPeriod"];
    if (complete && issue.rule === "PLANNING_7_DAYS") {
      try {
        const bounds = related.map((shift) => {
          // Parent windows do not establish the full extent of special-duty parts.
          if (shift.specialDuty) return null;
          const value = calculateTimedShiftBounds(shift, timeZone);
          if (!value || value.grossMinutes <= 0) return null;
          const start = Temporal.Instant.fromEpochMilliseconds(
            value.startEpochMinutes * 60_000,
          ).toZonedDateTimeISO(timeZone);
          const end = Temporal.Instant.fromEpochMilliseconds(
            value.endEpochMinutes * 60_000,
          ).toZonedDateTimeISO(timeZone);
          if (
            start.toPlainTime().toString({ smallestUnit: "minute" }) !== shift.startTime ||
            end.toPlainTime().toString({ smallestUnit: "minute" }) !== shift.endTime
          )
            return null;
          return { value, start, end };
        });
        if (bounds.every((value) => value !== null)) {
          const first = bounds.reduce((left, right) =>
            left.value.startEpochMinutes <= right.value.startEpochMinutes ? left : right,
          );
          const last = bounds.reduce((left, right) =>
            left.value.endEpochMinutes >= right.value.endEpochMinutes ? left : right,
          );
          dutyPeriod = {
            fromDate: first.start.toPlainDate().toString(),
            fromTime: first.start.toPlainTime().toString({ smallestUnit: "minute" }),
            untilDate: last.end.toPlainDate().toString(),
            untilTime: last.end.toPlainTime().toString({ smallestUnit: "minute" }),
          };
        }
      } catch {
        // Missing or invalid bounds remain a start-date range, never invented times.
      }
    }
    series = {
      count,
      unit:
        issue.rule === "PLANNING_7_DAYS" ? "Diensttage" : nightSequence ? "Nächte" : "Nachtdienste",
      from: nightSequence && !missing ? nightSequence.firstNight : complete ? dates[0] : null,
      until:
        nightSequence && !missing
          ? nightSequence.lastNight
          : complete
            ? dates[dates.length - 1]
            : null,
      ...(dutyPeriod ? { dutyPeriod } : {}),
    };
  }
  const summary = complianceIssueSummary(issue);
  let note = summary;
  let title = issue.title;
  if (rest) {
    if (legacy) ({ title, note } = legacyComplianceRestPresentation(issue, summary));
    else if (facts?.rule === "ARBZG_5_REST_10H") {
      title = "Ruhezeit zu kurz";
      note = `Mindestens ${complianceLimitHours(facts.minimumRestMinutes)} Std. Ruhezeit nötig.`;
    } else if (facts?.rule === "ARBZG_5_REST_11H") note = complianceCompensationSummary(facts);
    else if (facts?.rule === "JARBSCHG_13_REST")
      note = `Jugendliche brauchen mindestens ${complianceLimitHours(facts.minimumRestMinutes)} Std. Ruhezeit.`;
  }
  if (series)
    title = `${nightSequence?.countIsMinimum ? "Mindestens " : ""}${series.count} ${series.unit} hintereinander`;
  return { related, missing, rest, series, title, note, nightSequence };
}

export function restDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
}
