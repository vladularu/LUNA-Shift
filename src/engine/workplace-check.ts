import { Temporal } from "@js-temporal/polyfill";
import {
  rulesAt,
  type WorkplaceData,
  type QuestionId,
  type WorkplaceRule,
} from "@/domain/workplace-rules";
import { clockMinute, dutyInstant } from "@/domain/special-duty";
import type { ShiftEntry } from "@/domain/types";
import { dutyWorkParts } from "./special-duty";
import { weekendEvidence } from "./planning-weekends";

type ActiveRule = Exclude<WorkplaceRule, { mode: "unknown" | "none" }>;
export interface WorkplaceFinding {
  topic: QuestionId | "time";
  title: string;
  detail: string;
  shiftLabel: string;
  durationEvidenceKey?: string;
  evidence: () => readonly ShiftEntry[];
  assessment: string;
  periodStart: string;
  date: string;
  text: string;
  key: string;
  canConfirm: boolean;
  confirmed: boolean;
}
export function workplaceFindingGroupKey(finding: WorkplaceFinding) {
  return finding.topic === "weekend" ? "weekend:" + finding.date : finding.key;
}
function parts(shift: ShiftEntry, zone: string) {
  if (!shift.startTime || !shift.endTime || shift.allDay) return [];
  const start = clockMinute(shift.startTime),
    end = clockMinute(shift.endTime);
  const duty = shift.specialDuty;
  const intervals = duty
    ? dutyWorkParts(shift)
    : [{ start, end: end <= start ? end + 1440 : end, breakMinutes: shift.breakMinutes }];
  return intervals.map((p) => {
    const begin = dutyInstant(shift.date, p.start, duty?.timeZone ?? zone).withTimeZone(zone);
    const finish = dutyInstant(shift.date, p.end, duty?.timeZone ?? zone).withTimeZone(zone);
    return {
      shift,
      begin,
      finish,
      date: begin.toPlainDate().toString(),
      gross: (finish.epochMilliseconds - begin.epochMilliseconds) / 60000,
      pause: p.breakMinutes,
      kind: duty?.kind === "STANDBY" ? "standby" : duty?.kind === "ON_CALL" ? "callout" : "regular",
    };
  });
}
function minus(date: string, days: number) {
  return Temporal.PlainDate.from(date).subtract({ days }).toString();
}
function weekStart(date: string) {
  return minus(date, Temporal.PlainDate.from(date).dayOfWeek - 1);
}
export function workplaceFindings(
  data: WorkplaceData,
  shifts: readonly ShiftEntry[],
  period: string,
  zone: string,
): WorkplaceFinding[] {
  if (!data.history.length) return [];
  const end = (
    period.length === 4
      ? Temporal.PlainDate.from(period + "-12-31")
      : Temporal.PlainYearMonth.from(period)
          .toPlainDate({ day: 1 })
          .add({ months: 1 })
          .subtract({ days: 1 })
  ).toString();
  const activeTopics = new Set(
    data.history
      .filter((change) => change.from <= end)
      .flatMap((change) =>
        Object.entries(change.rules)
          .filter(([, rule]) => rule.mode !== "unknown" && rule.mode !== "none")
          .map(([id]) => id),
      ),
  );
  if (!activeTopics.size) return [];
  const needIntervals = ["recovery", "night", "rest", "switch", "duration"].some((id) =>
    activeTopics.has(id),
  );
  const lastStart = minus(end, -1);
  const latest = new Map<string, ShiftEntry>();
  for (const shift of shifts) {
    const prior = latest.get(shift.id);
    if (
      !prior ||
      shift.revision > prior.revision ||
      (shift.revision === prior.revision &&
        (shift.updatedAt > prior.updatedAt ||
          (shift.updatedAt === prior.updatedAt && shift.deletedAt !== null)))
    )
      latest.set(shift.id, shift);
  }
  const work = [...latest.values()].filter(
    (s) => s.date <= lastStart && !s.deletedAt && !["FREE", "SICK", "VACATION"].includes(s.type),
  );
  const byDate = new Map<string, ReturnType<typeof rulesAt>>();
  const rulesOn = (date: string) => {
    const known = byDate.get(date);
    if (known) return known;
    const rules = rulesAt(data.history, date);
    byDate.set(date, rules);
    return rules;
  };
  const results: WorkplaceFinding[] = [];
  const intervals = new Map(
    work.map((shift) => {
      let spans: ReturnType<typeof parts> = [];
      try {
        if (needIntervals) spans = parts(shift, zone);
      } catch {
        /* An ambiguous or nonexistent local time has no unique duration. */
      }
      if (
        !spans.length &&
        (needIntervals || !shift.startTime || !shift.endTime) &&
        shift.specialDuty?.kind !== "ON_CALL" &&
        shift.date.startsWith(period)
      ) {
        const rules = rulesOn(shift.date);
        if (
          [
            rules.rest,
            rules.duration,
            rules.switch,
            rules.recovery,
            rules.night,
            rules.weekend,
          ].some((rule) => rule && rule.mode !== "unknown" && rule.mode !== "none")
        )
          results.push({
            topic: "time",
            title: "Dienstzeit unklar",
            detail: shift.title + " · Beginn und Ende prüfen",
            shiftLabel: shift.title,
            evidence: () => [shift],
            assessment:
              "Prüfe Beginn und Ende dieses Dienstes im Kalender. Erst mit eindeutigen Zeiten kann LUNA die Dauer berechnen.",
            periodStart: shift.date,
            date: shift.date,
            key: JSON.stringify(["time", shift.id, shift.revision]),
            text:
              shift.title +
              " · Dienstzeit fehlt oder ist wegen der Zeitumstellung mehrdeutig. Zeitabhängige Regeln sind nur teilweise prüfbar.",
            canConfirm: false,
            confirmed: false,
          });
      }
      return [shift, spans] as const;
    }),
  );
  const items = [...intervals.values()]
    .flat()
    .sort((a, b) => a.begin.epochMilliseconds - b.begin.epochMilliseconds);
  const days = new Map<string, typeof items>();
  for (const item of items) {
    const bucket = days.get(item.date) ?? [];
    bucket.push(item);
    days.set(item.date, bucket);
  }
  const starts = new Map(work.map((shift) => [shift.date, shift]));
  const worked = [...starts.keys()].sort();
  const weekends = new Map<string, ShiftEntry[]>();
  for (const s of activeTopics.has("weekend") ? work : [])
    for (const [date, evidence] of weekendEvidence(s, zone))
      if (evidence.status === "OCCUPIED") {
        const bucket = weekends.get(date) ?? [];
        bucket.push(s);
        weekends.set(date, bucket);
      }
  const add = (
    date: string,
    id: QuestionId,
    r: ActiveRule,
    actual: string,
    target: string,
    s: ShiftEntry,
    {
      clarify = false,
      occurrence = "",
      evidence = () => [s],
      periodStart = date,
      meetsLocalLimit = false,
      durationEvidenceKey,
    }: {
      clarify?: boolean;
      occurrence?: string;
      evidence?: () => readonly ShiftEntry[];
      periodStart?: string;
      meetsLocalLimit?: boolean;
      durationEvidenceKey?: string;
    },
  ) => {
    if (!date.startsWith(period)) return;
    const key = JSON.stringify([id, date, s.id, s.revision, r, actual, target, occurrence]);
    const confirmed = data.exceptions.includes(key);
    const reason = r.source === "agreed" ? "vereinbart" : "bei euch üblich";
    const title =
      id === "weekend"
        ? r.mode === "alternate" && !r.anchor
          ? "Zwei Wochenenden hintereinander mit Dienst"
          : r.mode === "monthly" || r.mode === "rolling"
            ? "Zu wenige freie Wochenenden im Zeitraum"
            : "Dienst am vorgesehenen freien Wochenende"
        : actual;
    const readableTime = (text: string) =>
      text.replace(/(\d+) Minuten/g, (_, n: string) => {
        const minutes = Number(n);
        return minutes >= 60
          ? Math.floor(minutes / 60) +
              " Std." +
              (minutes % 60 ? " " + (minutes % 60) + " Min." : "")
          : minutes + " Min.";
      });
    results.push({
      topic: id,
      durationEvidenceKey,
      title: readableTime(title),
      detail:
        (r.source === "agreed" ? "Vereinbart" : "Bei euch üblich") +
        " · " +
        readableTime(target) +
        (clarify ? " · Ausgleich und Grundlage offen" : ""),
      periodStart,
      evidence,
      assessment: clarify
        ? (meetsLocalLimit
            ? "Der Dienstplan hält deine eingetragene Grenze ein. "
            : "Der Dienstplan weicht von deiner eingetragenen Grenze ab. ") +
          (id === "rest"
            ? "Die Ruhezeit liegt unter elf Stunden. Prüfe, ob die Verkürzung zulässig ist und der vorgeschriebene Ausgleich erfolgt."
            : "Die Arbeitszeit ohne Pausen liegt über zehn Stunden. Prüfe die Grundlage für diesen Dienst und den erforderlichen Ausgleich.")
        : r.source === "agreed"
          ? "Der Dienstplan weicht von der Regel ab, die du als vereinbart hinterlegt hast."
          : "Dieser Dienstplan weicht von der Planung ab, die du als üblich angegeben hast.",
      shiftLabel: s.title + " · " + s.date + (s.startTime ? " · " + s.startTime : ""),
      date,
      key,
      text:
        (r.onRequest
          ? s.title + " (" + s.date + (s.startTime ? ", " + s.startTime : "") + ") · "
          : "") +
        actual +
        " · " +
        reason +
        ": " +
        target +
        (clarify ? " · rechtliche Einordnung und Ausgleich prüfen" : "") +
        (confirmed ? " · Ausnahme für diesen Dienst bestätigt" : ""),
      confirmed,
      canConfirm: r.onRequest && !clarify,
    });
  };
  const shiftsBetween = (from: string, to: string) => () =>
    work.filter((s) => s.date >= from && s.date <= to);
  let streak = 0,
    nights = 0,
    previousDate = "",
    lastNight = "",
    nightEnd: Temporal.ZonedDateTime | null = null;
  for (const date of activeTopics.has("series") || activeTopics.has("week") ? worked : []) {
    const shift = starts.get(date)!;
    const r = rulesOn(date);
    streak = previousDate === minus(date, 1) ? streak + 1 : 1;
    previousDate = date;
    if (r.series?.mode === "limit" && streak > r.series.count)
      add(
        date,
        "series",
        r.series,
        streak + " Arbeitstage am Stück",
        "höchstens " + r.series.count,
        shift,
        {
          evidence: shiftsBetween(minus(date, streak - 1), date),
          periodStart: minus(date, streak - 1),
        },
      );
    const week = r.week;
    if (week?.mode === "limit" || week?.mode === "average") {
      const span = week.mode === "limit" ? 1 : week.weeks;
      const start = minus(weekStart(date), 7 * (span - 1));
      const count = worked.filter((d) => d >= start && d <= date).length;
      if (count > week.count * span)
        add(
          date,
          "week",
          week,
          count + " Arbeitstage seit " + start,
          week.count +
            " Tage " +
            (span === 1 ? "pro Woche" : "im Durchschnitt über " + span + " Wochen"),
          shift,
          { evidence: shiftsBetween(start, date), periodStart: start },
        );
    }
  }
  for (const shift of activeTopics.has("duration") ? work : []) {
    const rule = rulesOn(shift.date).duration;
    if (rule?.mode !== "duration") continue;
    const relevant = intervals
      .get(shift)!
      .filter((part) => rule.duty === "all" || part.kind === rule.duty);
    const groups =
      shift.specialDuty?.kind === "ON_CALL" ? relevant.map((item) => [item]) : [relevant];
    for (const group of groups) {
      if (!group.length) continue;
      const net = group.reduce((sum, item) => sum + item.gross - item.pause, 0);
      const minutes = rule.gross ? group.reduce((sum, item) => sum + item.gross, 0) : net;
      if (minutes > rule.minutes)
        add(
          group[0]!.date,
          "duration",
          rule,
          minutes + " Minuten " + (rule.gross ? "mit" : "ohne") + " Pausen",
          rule.minutes + " Minuten" + (rule.basis ? " · " + rule.basis : ""),
          shift,
          {
            clarify: net > 600,
            occurrence: String(group[0]!.begin.epochMilliseconds),
            meetsLocalLimit: minutes <= rule.minutes,
          },
        );
    }
  }
  let previous: (typeof items)[number] | undefined;
  for (const [date, day] of days) {
    const r = rulesOn(date);
    const first = day[0]!;
    const night = day.filter((item) => item.shift.type === "NIGHT");
    const continues = lastNight === minus(date, 1) && first.shift.type === "NIGHT";
    if (
      nightEnd &&
      !continues &&
      r.night?.mode !== "off" &&
      r.recovery?.mode === "recovery" &&
      nights >= r.recovery.nights
    ) {
      const gap = (first.begin.epochMilliseconds - nightEnd.epochMilliseconds) / 3600000;
      const fullDays = Math.max(
        0,
        nightEnd.toPlainDate().until(first.begin.toPlainDate()).days -
          (nightEnd.toPlainTime().equals("00:00") ? 0 : 1),
      );
      const actual = r.recovery.unit === "days" ? fullDays : gap;
      const unit = (n: number) =>
        r.recovery?.mode === "recovery" && r.recovery.unit === "days"
          ? n === 1
            ? " voller Kalendertag"
            : " volle Kalendertage"
          : n === 1
            ? " Stunde"
            : " Stunden";
      const blockStart = minus(lastNight, nights - 1);
      const blockEnd = lastNight;
      if (actual < r.recovery.count)
        add(
          date,
          "recovery",
          r.recovery,
          Number(actual.toFixed(2)) +
            unit(actual) +
            " frei nach " +
            nights +
            (nights === 1 ? " Nacht" : " Nächten"),
          r.recovery.count + unit(r.recovery.count),
          first.shift,
          {
            evidence: () => [
              ...work.filter(
                (s) => s.type === "NIGHT" && s.date >= blockStart && s.date <= blockEnd,
              ),
              first.shift,
            ],
            periodStart: blockStart,
          },
        );
    }
    nights = night.length ? (continues ? nights + 1 : 1) : 0;
    nightEnd = night.at(-1)?.finish ?? null;
    lastNight = night.length ? date : "";
    const firstNight = night.length ? minus(date, nights - 1) : date;
    if (
      night.length &&
      (r.night?.mode === "off" || (r.night?.mode === "limit" && nights > r.night.count))
    )
      add(
        date,
        "night",
        r.night,
        nights + " Nachtdienste am Stück",
        r.night.mode === "off" ? "keine Nachtdienste" : "höchstens " + r.night.count,
        night[0]!.shift,
        {
          evidence: () =>
            items
              .filter((i) => i.date >= firstNight && i.date <= date && i.shift.type === "NIGHT")
              .map((i) => i.shift),
          periodStart: firstNight,
        },
      );
    for (const item of day) {
      if (previous && item.shift.id !== previous.shift.id) {
        const gap = (item.begin.epochMilliseconds - previous.finish.epochMilliseconds) / 60000;
        const before = previous.shift;
        const pair = () => [before, item.shift];
        const rest = r.rest;
        if (
          gap >= 0 &&
          rest?.mode === "rest" &&
          (rest.duty === "all" || rest.duty === previous.kind) &&
          gap < rest.minutes
        )
          add(
            date,
            "rest",
            rest,
            gap + " Minuten Ruhezeit",
            rest.minutes +
              " Minuten" +
              (rest.compensation ? " · Ausgleich: " + rest.compensation : ""),
            item.shift,
            {
              clarify: gap < 660,
              occurrence: String(item.begin.epochMilliseconds),
              evidence: pair,
              durationEvidenceKey: JSON.stringify([date, [before.id, item.shift.id], gap]),
              periodStart: before.date,
            },
          );
        const sw = r.switch;
        if (
          sw?.mode === "switch" &&
          previous.shift.type === sw.from &&
          item.shift.type === sw.to &&
          previous.finish.toPlainDate().until(item.begin.toPlainDate()).days <= 1
        )
          add(
            date,
            "switch",
            sw,
            "Eingetragener Dienstwechsel",
            "diesen Wechsel vermeiden",
            item.shift,
            {
              occurrence: String(item.begin.epochMilliseconds),
              evidence: pair,
              periodStart: before.date,
            },
          );
      }
      if (!previous || item.finish.epochMilliseconds >= previous.finish.epochMilliseconds)
        previous = item;
    }
  }
  for (const date of [...weekends.keys()].sort()) {
    const sunday = minus(date, -1);
    const r = rulesOn(sunday).weekend;
    if (!r || r.mode === "unknown" || r.mode === "none") continue;
    const sat = Temporal.PlainDate.from(date);
    let target = "";
    let firstWeekend = date;
    if (r.mode === "off") target = "alle Wochenenden frei";
    if (
      r.mode === "alternate" &&
      (r.anchor
        ? Temporal.PlainDate.from(r.anchor).until(sat).days % 14 === 0
        : weekends.has(minus(date, 7)))
    ) {
      target = "jedes zweite Wochenende frei";
      if (!r.anchor) firstWeekend = minus(date, 7);
    }
    if (r.mode === "monthly" || r.mode === "rolling") {
      const monthly = r.mode === "monthly";
      const owner = Temporal.PlainDate.from(sunday);
      const begin = monthly
        ? owner.with({ day: 1 }).subtract({ days: 1 })
        : sat.subtract({ weeks: r.weeks - 1 });
      const firstSundayOffset = (7 - owner.with({ day: 1 }).dayOfWeek) % 7;
      const total = monthly
        ? Math.floor((owner.daysInMonth - 1 - firstSundayOffset) / 7) + 1
        : r.weeks;
      const occupied = [...weekends.keys()].filter(
        (d) => d >= begin.toString() && d <= date,
      ).length;
      firstWeekend = begin.toString();
      if (total - occupied < r.count)
        target =
          r.count +
          " freie Wochenenden " +
          (monthly ? "pro Kalendermonat" : "in " + r.weeks + " Wochen");
    }
    if (target)
      for (const shift of r.onRequest ? weekends.get(date)! : weekends.get(date)!.slice(0, 1))
        add(sunday, "weekend", r, "Wochenende ab " + date + " belegt", target, shift, {
          evidence: () =>
            [...weekends]
              .filter(([saturday]) => saturday >= firstWeekend && saturday <= date)
              .flatMap(([, entries]) => entries),
          periodStart: firstWeekend,
        });
  }
  return results.sort((a, b) => a.date.localeCompare(b.date));
}
