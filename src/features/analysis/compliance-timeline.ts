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
  readonly unit: "Arbeitstage" | "Nachtdienste";
  readonly from: string | null;
  readonly until: string | null;
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
  let rest: RestTimeline | null = null;
  if (REST_RULES.has(issue.rule) && !missing && related.length === 2) {
    try {
      const bounds = related
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
  const facts = validComplianceIssueFacts(issue.facts, issue.rule);
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
    series = {
      count,
      unit: issue.rule === "PLANNING_7_DAYS" ? "Arbeitstage" : "Nachtdienste",
      from: complete ? dates[0] : null,
      until: complete ? dates[dates.length - 1] : null,
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
  if (series) title = `${series.count} ${series.unit} hintereinander`;
  return { related, missing, rest, series, title, note };
}

export function restDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
}
