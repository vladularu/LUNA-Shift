import type { ComplianceIssue, MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";
import { validTariffComplianceEvidence } from "@/domain/tariff-compliance-validation";
import { calculateTimedShiftBounds } from "@/engine/working-time";
import { Temporal } from "@js-temporal/polyfill";

export interface CheckDisplayGroup {
  readonly id: string;
  readonly date: string;
  readonly primary: ComplianceIssue;
  readonly relatedIssues: readonly ComplianceIssue[];
}

/** UI placement only: planned observations are results; unavailable foundations are scope limits. */
export function checkDisplayProjection(result: MonthlyComplianceResult) {
  const ids = new Map<string, number>();
  for (const issue of [...result.issues, ...(result.prerequisites ?? [])])
    ids.set(issue.id, (ids.get(issue.id) ?? 0) + 1);
  const known = (issue: ComplianceIssue) =>
    ids.get(issue.id) === 1 &&
    issue.kind === "LEGAL" &&
    issue.severity === "info" &&
    !!issue.tariff &&
    issue.tariff.ruleId === issue.rule &&
    ["TARIFF_SCOPE", "TARIFF_WEEK_DAYS", "TARIFF_FREE_DAYS", "TARIFF_FREE_SUNDAY"].includes(
      issue.rule,
    ) &&
    validTariffComplianceEvidence(issue.tariff, issue.rule);
  const pending = (result.prerequisites ?? []).filter(
    (issue) => known(issue) && issue.tariff?.status === "PENDING",
  );
  const unavailable = result.issues.filter(
    (issue) => known(issue) && issue.tariff?.status === "UNAVAILABLE",
  );
  const unavailableMembers = new Set(unavailable);
  const pendingMembers = new Set(pending);
  return {
    issues: [...result.issues.filter((issue) => !unavailableMembers.has(issue)), ...pending],
    prerequisites: [
      ...(result.prerequisites ?? []).filter((issue) => !pendingMembers.has(issue)),
      ...unavailable,
    ],
    unavailable: unavailable.length > 0,
  };
}

const WORK_RULE = "PLANNING_7_DAYS";
const NIGHT_RULES = new Set(["PLANNING_NIGHT_SERIES", "PLANNING_NIGHT_RECOVERY"]);
const DUTY_TYPES = new Set(["EARLY", "LATE", "NIGHT", "DAY", "TRAINING", "CUSTOM"]);
const PRIORITY = { critical: 0, warning: 1, info: 2 };
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

interface WorkBlock {
  readonly index: number;
  readonly ids: ReadonlySet<string>;
}
interface NightBlock extends WorkBlock {
  readonly identity: string;
  readonly evidence: string;
}
interface TariffBlock extends WorkBlock {
  readonly identity: string;
  readonly from: string;
  readonly until: string;
}

function validDate(value: string): boolean {
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
}

function consecutiveDates(dates: readonly string[]): boolean {
  return dates.every(
    (date, index) =>
      validDate(date) &&
      (index === 0 ||
        Temporal.PlainDate.from(dates[index - 1])
          .add({ days: 1 })
          .toString() === date),
  );
}

function completeDuties(
  issue: ComplianceIssue,
  shifts: ReadonlyMap<string, ShiftEntry | null>,
): readonly ShiftEntry[] | null {
  const ids = [...new Set(issue.relatedShiftIds)];
  if (!ids.length) return null;
  const related: ShiftEntry[] = [];
  for (const id of ids) {
    const shift = shifts.get(id);
    if (
      !shift ||
      shift.deletedAt !== null ||
      shift.allDay ||
      shift.specialDuty ||
      !DUTY_TYPES.has(shift.type) ||
      !validDate(shift.date) ||
      !CLOCK.test(shift.startTime ?? "") ||
      !CLOCK.test(shift.endTime ?? "")
    )
      return null;
    related.push(shift);
  }
  return related;
}

function observationPriority(issue: ComplianceIssue): number {
  return issue.rule === WORK_RULE ? 0 : issue.rule === "PLANNING_NIGHT_SERIES" ? 1 : 2;
}

function consistentTariffDuties(
  issue: ComplianceIssue,
  related: readonly ShiftEntry[],
  timeZone?: string,
): boolean {
  const tariff = issue.tariff;
  const recordedDates = tariff?.recordedDates;
  if (!timeZone || !tariff || !recordedDates) return false;
  try {
    const from = Temporal.PlainDate.from(tariff.period.from),
      until = Temporal.PlainDate.from(tariff.period.until);
    const days = tariff.ruleId === "TARIFF_WEEK_DAYS" ? 7 : 14;
    if (from.dayOfWeek !== 1 || until.dayOfWeek !== 7 || until.since(from).days !== days - 1)
      return false;
    const recorded = new Set(recordedDates),
      proved = new Set<string>();
    if (recorded.size !== tariff.count || recorded.size !== recordedDates.length) return false;
    for (const shift of related) {
      if (!Number.isSafeInteger(shift.breakMinutes) || shift.breakMinutes < 0) return false;
      const bounds = calculateTimedShiftBounds(shift, timeZone);
      if (!bounds) return false;
      if (tariff.ruleId === "TARIFF_WEEK_DAYS") {
        if (
          shift.date < tariff.period.from ||
          shift.date > tariff.period.until ||
          bounds.endEpochMinutes - bounds.startEpochMinutes <= shift.breakMinutes
        )
          return false;
        proved.add(shift.date);
        continue;
      }
      let contributes = false;
      for (let offset = 0; offset < days; offset += 1) {
        const day = from.add({ days: offset });
        if (tariff.ruleId === "TARIFF_FREE_SUNDAY" && day.dayOfWeek !== 7) continue;
        const lower = Number(day.toZonedDateTime(timeZone).epochMilliseconds) / 60_000;
        const upper =
          Number(day.add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds) / 60_000;
        const overlap =
          Math.min(bounds.endEpochMinutes, upper) - Math.max(bounds.startEpochMinutes, lower);
        // As in recorded-work evidence, an unlocated pause must not be guessed into another day.
        if (overlap > shift.breakMinutes) {
          contributes = true;
          proved.add(day.toString());
        }
      }
      if (!contributes) return false;
    }
    return proved.size === recorded.size && [...recorded].every((date) => proved.has(date));
  } catch {
    return false;
  }
}

/** Groups observations for display only; all returned observations are original objects. */
export function groupCheckDisplayIssues(
  issues: readonly ComplianceIssue[],
  shifts: readonly ShiftEntry[],
  timeZone?: string,
): readonly CheckDisplayGroup[] {
  const byId = new Map<string, ShiftEntry | null>();
  for (const shift of shifts) byId.set(shift.id, byId.has(shift.id) ? null : shift);
  const issueIds = new Map<string, number>();
  for (const issue of issues) issueIds.set(issue.id, (issueIds.get(issue.id) ?? 0) + 1);
  const works: WorkBlock[] = [],
    nights: NightBlock[] = [],
    tariffs: TariffBlock[] = [];
  issues.forEach((issue, index) => {
    const tariff = issue.tariff;
    if (
      issue.kind === "LEGAL" &&
      issue.severity === "info" &&
      issueIds.get(issue.id) === 1 &&
      validDate(issue.date) &&
      tariff &&
      tariff.ruleId === issue.rule &&
      ["TARIFF_WEEK_DAYS", "TARIFF_FREE_DAYS", "TARIFF_FREE_SUNDAY"].includes(issue.rule) &&
      ["REVIEW", "PENDING"].includes(tariff.status) &&
      validTariffComplianceEvidence(tariff, issue.rule) &&
      tariff.period.from <= issue.date &&
      issue.date <= tariff.period.until &&
      Number.isSafeInteger(tariff.count) &&
      tariff.recordedDates?.length &&
      tariff.recordedDates.every(
        (date) => date >= tariff.period.from && date <= tariff.period.until,
      )
    ) {
      const related = completeDuties(issue, byId);
      if (related && consistentTariffDuties(issue, related, timeZone))
        tariffs.push({
          index,
          ids: new Set(related.map((shift) => shift.id)),
          from: tariff.period.from,
          until: tariff.period.until,
          identity: JSON.stringify([
            issue.date.slice(0, 7),
            issue.rule,
            issue.severity,
            tariff.status,
            tariff.tariffLabel,
            tariff.source,
            tariff.ruleText,
            tariff.requirements,
            tariff.count,
            tariff.limit,
          ]),
        });
    }
    if (
      issue.kind !== "PLANNING" ||
      issue.tariff ||
      issue.severity === "critical" ||
      issueIds.get(issue.id) !== 1 ||
      !validDate(issue.date)
    )
      return;
    const facts = validComplianceIssueFacts(issue.facts, issue.rule);
    if (
      !facts ||
      !(facts.rule === WORK_RULE || NIGHT_RULES.has(facts.rule)) ||
      !("count" in facts) ||
      !Number.isSafeInteger(facts.count) ||
      !facts.count ||
      facts.count < 1
    )
      return;
    const related = completeDuties(issue, byId);
    if (!related) return;
    if (facts.rule === WORK_RULE) {
      const dates = [...new Set(related.map((shift) => shift.date))].sort();
      if (dates.length === facts.count && consecutiveDates(dates) && issue.date === dates.at(-1))
        works.push({ index, ids: new Set(related.map((shift) => shift.id)) });
      return;
    }
    if (facts.rule !== "PLANNING_NIGHT_SERIES" && facts.rule !== "PLANNING_NIGHT_RECOVERY") return;
    const sequence = facts.nightSequence;
    const nightDuties = related.filter((shift) => shift.id !== sequence?.nextShiftId);
    const ids = new Set(nightDuties.map((shift) => shift.id));
    const dates = [...new Set(nightDuties.map((shift) => shift.date))].sort();
    if (dates.length !== facts.count || !consecutiveDates(dates)) return;
    if (sequence) {
      // Lookup completeness is proved only for the observation's explicit related IDs.
      if (sequence.nextShiftId !== null && !issue.relatedShiftIds.includes(sequence.nextShiftId))
        return;
      const offset = Temporal.PlainDate.from(dates[0]).since(
        Temporal.PlainDate.from(sequence.firstNight),
      ).days;
      if (
        (offset !== 0 && offset !== 1) ||
        !ids.has(sequence.lastShiftId) ||
        issue.date < sequence.firstNight ||
        issue.date > sequence.lastNight ||
        byId.get(sequence.lastShiftId)?.date !== dates.at(-1) ||
        Temporal.PlainDate.from(sequence.lastNight).add({ days: offset }).toString() !==
          dates.at(-1)
      )
        return;
    } else if (issue.date !== dates.at(-1)) return;
    const identity = JSON.stringify(
      sequence
        ? [issue.date.slice(0, 7), sequence.policyVersion, sequence.firstNight, sequence.lastNight]
        : [issue.date.slice(0, 7), "legacy", facts.count, dates, [...ids].sort()],
    );
    nights.push({
      index,
      ids,
      identity,
      evidence: JSON.stringify(
        sequence
          ? [
              sequence.policyVersion,
              sequence.firstNight,
              sequence.lastNight,
              sequence.countIsMinimum,
              sequence.recoveryStatus,
              sequence.restMinutes,
              sequence.lastShiftId,
              sequence.nextShiftId,
              [...ids].sort(),
            ]
          : ["legacy", facts.count, [...ids].sort()],
      ),
    });
  });

  const parent = issues.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index];
    return index;
  };
  const join = (left: number, right: number) => {
    parent[find(right)] = find(left);
  };
  // A shared original duty and pairwise overlap prove one conservative display group.
  // A chain must not bridge observations that no longer overlap each other.
  const tariffGroups: TariffBlock[][] = [];
  for (const tariff of [...tariffs].sort(
    (a, b) =>
      issues[a.index].date.localeCompare(issues[b.index].date) ||
      issues[a.index].id.localeCompare(issues[b.index].id),
  )) {
    const same = tariffGroups.find((group) =>
      group.every(
        (member) =>
          member.identity === tariff.identity &&
          member.from <= tariff.until &&
          tariff.from <= member.until &&
          [...tariff.ids].some((id) => member.ids.has(id)),
      ),
    );
    if (same) {
      join(same[0].index, tariff.index);
      same.push(tariff);
    } else tariffGroups.push([tariff]);
  }
  const sequences = new Map<string, NightBlock[]>();
  for (const night of nights)
    sequences.set(night.identity, [...(sequences.get(night.identity) ?? []), night]);
  const ambiguous = new Set<number>();
  const nightOwners = new Map<string, NightBlock[]>();
  for (const night of nights)
    for (const id of night.ids) nightOwners.set(id, [...(nightOwners.get(id) ?? []), night]);
  // A work block must not become a transitive bridge between incompatible night identities.
  for (const owners of nightOwners.values()) {
    if (new Set(owners.map((item) => item.identity)).size > 1)
      owners.forEach((item) => ambiguous.add(item.index));
  }
  for (const sequence of sequences.values()) {
    if (sequence.length < 2) continue;
    const rules = new Set(sequence.map((item) => issues[item.index].rule));
    if (
      sequence.length !== 2 ||
      rules.size !== 2 ||
      sequence[0].evidence !== sequence[1].evidence ||
      sequence.some((item) => ambiguous.has(item.index))
    ) {
      sequence.forEach((item) => ambiguous.add(item.index));
      continue;
    }
    join(sequence[0].index, sequence[1].index);
  }
  for (const night of nights) {
    if (ambiguous.has(night.index)) continue;
    const containers = works.filter(
      (work) =>
        issues[work.index].date.slice(0, 7) === issues[night.index].date.slice(0, 7) &&
        [...night.ids].every((id) => work.ids.has(id)),
    );
    if (containers.length === 1) join(containers[0].index, night.index);
  }
  const grouped = new Map<number, ComplianceIssue[]>();
  issues.forEach((issue, index) => {
    const key = find(index);
    grouped.set(key, [...(grouped.get(key) ?? []), issue]);
  });
  const result = [...grouped.values()]
    .map((group) => {
      const ordered = [...group].sort(
        (a, b) =>
          observationPriority(a) - observationPriority(b) ||
          (a.tariff && b.tariff ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) ||
          a.id.localeCompare(b.id),
      );
      return {
        id: `check-group:${JSON.stringify(group.map((issue) => issue.id).sort())}`,
        date: group
          .map((issue) => issue.date)
          .sort()
          .at(-1)!,
        primary: ordered[0],
        relatedIssues: ordered.slice(1),
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Math.min(...[a.primary, ...a.relatedIssues].map((item) => PRIORITY[item.severity])) -
          Math.min(...[b.primary, ...b.relatedIssues].map((item) => PRIORITY[item.severity])) ||
        a.id.localeCompare(b.id) ||
        JSON.stringify(a.primary).localeCompare(JSON.stringify(b.primary)),
    );
  const used = new Map<string, number>();
  return result.map((group) => {
    const count = used.get(group.id) ?? 0;
    used.set(group.id, count + 1);
    return count ? { ...group, id: `${group.id}:${count}` } : group;
  });
}
