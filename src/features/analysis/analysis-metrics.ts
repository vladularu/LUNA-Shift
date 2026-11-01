import { projectDutyCalendarDays } from "@/engine/special-duty";
import {
  SHIFT_TYPES,
  type CalendarEntry,
  type ShiftEntry,
  type ShiftType,
  type UserProfile,
} from "@/domain/types";
import {
  calculateDailyWorkCredit,
  calculateTimedDailyWorkCredit,
  type WorkCreditObserver,
} from "@/engine/daily-summary";
import { bundledRuleResolver, type RuleResolver } from "@/rules/rule-resolver";

type ProfileForTime = Pick<UserProfile, "federalState" | "weeklyMinutes" | "timeZone"> &
  Partial<Pick<UserProfile, "holidayRegion">>;

export interface ShiftTypeAnalysisItem {
  readonly type: ShiftType;
  readonly count: number;
  readonly minutes: number;
}

export interface ShiftAppearance {
  readonly title: string;
  readonly color: string;
  readonly symbol: string;
}

export interface MonthlyShiftTypeAnalysis {
  readonly groups?: readonly ShiftNameGroup[];
  readonly appearances?: Readonly<Partial<Record<ShiftType, readonly ShiftAppearance[]>>>;
  readonly items: readonly ShiftTypeAnalysisItem[];
  readonly totalCount: number;
  readonly totalMinutes: number;
}

export interface ShiftNameGroup extends ShiftAppearance {
  readonly key: string;
  readonly count: number;
  readonly minutes: number;
  readonly types: readonly ShiftType[];
  readonly entries: readonly {
    readonly id: string;
    readonly date: string;
    readonly minutes: number;
  }[];
}

function appearanceKey(entry: ShiftAppearance): string {
  return JSON.stringify([entry.title, entry.color, entry.symbol]);
}

export function buildMonthlyShiftTypeAnalysis(
  month: string,
  entries: readonly CalendarEntry[],
  profile: ProfileForTime,
  ruleResolver: RuleResolver = bundledRuleResolver,
): MonthlyShiftTypeAnalysis {
  return buildMonthlyShiftTypeAnalysisWithCredit(month, entries, (date, shifts, onCredit) =>
    calculateDailyWorkCredit(date, shifts, profile, ruleResolver, onCredit),
  );
}

export function buildMonthlyTimedShiftTypeAnalysis(
  month: string,
  entries: readonly CalendarEntry[],
  profile: Pick<ProfileForTime, "timeZone">,
): MonthlyShiftTypeAnalysis {
  return buildMonthlyShiftTypeAnalysisWithCredit(month, entries, (date, shifts, onCredit) =>
    calculateTimedDailyWorkCredit(date, shifts, profile, onCredit),
  );
}

function buildMonthlyShiftTypeAnalysisWithCredit(
  ...args: Parameters<typeof buildMonthlyShiftTypeAnalysisWithCreditSteps>
): MonthlyShiftTypeAnalysis {
  const steps = buildMonthlyShiftTypeAnalysisWithCreditSteps(...args);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function* buildMonthlyShiftTypeAnalysisSteps(
  month: string,
  entries: readonly CalendarEntry[],
  profile: ProfileForTime,
  ruleResolver: RuleResolver,
): Generator<number, MonthlyShiftTypeAnalysis, void> {
  return yield* buildMonthlyShiftTypeAnalysisWithCreditSteps(
    month,
    entries,
    (date, shifts, onCredit) =>
      calculateDailyWorkCredit(date, shifts, profile, ruleResolver, onCredit),
  );
}

export function* buildMonthlyTimedShiftTypeAnalysisSteps(
  month: string,
  entries: readonly CalendarEntry[],
  profile: Pick<ProfileForTime, "timeZone">,
): Generator<number, MonthlyShiftTypeAnalysis, void> {
  return yield* buildMonthlyShiftTypeAnalysisWithCreditSteps(
    month,
    entries,
    (date, shifts, onCredit) => calculateTimedDailyWorkCredit(date, shifts, profile, onCredit),
  );
}

function* buildMonthlyShiftTypeAnalysisWithCreditSteps(
  month: string,
  entries: readonly CalendarEntry[],
  calculateCredit: (
    date: string,
    shifts: readonly ShiftEntry[],
    onCredit: WorkCreditObserver,
  ) => { readonly minutesByType: Readonly<Partial<Record<ShiftType, number>>> },
): Generator<number, MonthlyShiftTypeAnalysis, void> {
  const sources = new Map(
    entries
      .filter((entry): entry is ShiftEntry => entry.kind === "SHIFT")
      .map((entry) => [entry.id, entry]),
  );
  entries = entries.flatMap<CalendarEntry>((entry) =>
    entry.kind === "SHIFT"
      ? (() => {
          const parts = projectDutyCalendarDays([entry]);
          return parts.length ? parts : [entry];
        })()
      : [entry],
  );
  const counted = new Set<string>();
  const counts: Partial<Record<ShiftType, number>> = {};
  const minutes: Partial<Record<ShiftType, number>> = {};
  const appearances: Partial<Record<ShiftType, ShiftAppearance[]>> = {};
  const shiftsByDate = new Map<string, ShiftEntry[]>();
  const groups = new Map<
    string,
    {
      appearance: ShiftAppearance;
      types: Set<ShiftType>;
      entries: Map<string, { id: string; date: string; minutes: number }>;
    }
  >();

  for (const entry of entries) {
    if (entry.kind !== "SHIFT" || entry.deletedAt !== null || !entry.date.startsWith(`${month}-`)) {
      continue;
    }
    const styles = appearances[entry.type] ?? [];
    if (
      !styles.some(
        (style) =>
          style.title === entry.title &&
          style.color === entry.color &&
          style.symbol === entry.symbol,
      )
    ) {
      styles.push(Object.freeze({ title: entry.title, color: entry.color, symbol: entry.symbol }));
      appearances[entry.type] = styles;
    }
    if (!counted.has(entry.id)) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    const key = appearanceKey(entry);
    let group = groups.get(key);
    if (!group) {
      group = {
        appearance: { title: entry.title, color: entry.color, symbol: entry.symbol },
        types: new Set(),
        entries: new Map(),
      };
      groups.set(key, group);
    }
    group.types.add(entry.type);
    if (!group.entries.has(entry.id))
      group.entries.set(entry.id, {
        id: entry.id,
        date: sources.get(entry.id)?.date ?? entry.date,
        minutes: 0,
      });
    counted.add(entry.id);
    const dateShifts = shiftsByDate.get(entry.date) ?? [];
    dateShifts.push(entry);
    shiftsByDate.set(entry.date, dateShifts);
  }

  for (const [date, dateShifts] of shiftsByDate) {
    const daily = calculateCredit(date, dateShifts, (entry, creditedMinutes) => {
      const item = groups.get(appearanceKey(entry))?.entries.get(entry.id);
      if (item) item.minutes += creditedMinutes;
    });
    for (const type of SHIFT_TYPES) {
      const creditedMinutes = daily.minutesByType[type] ?? 0;
      if (creditedMinutes > 0) minutes[type] = (minutes[type] ?? 0) + creditedMinutes;
    }
    yield 1;
  }

  const items = Object.freeze(
    SHIFT_TYPES.filter((type) => (counts[type] ?? 0) > 0 || (minutes[type] ?? 0) > 0).map((type) =>
      Object.freeze({
        type,
        count: counts[type] ?? 0,
        minutes: minutes[type] ?? 0,
      }),
    ),
  );

  return Object.freeze({
    items,
    ...(groups.size
      ? {
          groups: Object.freeze(
            [...groups].map(([key, group]) =>
              Object.freeze({
                ...group.appearance,
                key,
                types: Object.freeze([...group.types]),
                count: group.entries.size,
                minutes: [...group.entries.values()].reduce((sum, entry) => sum + entry.minutes, 0),
                entries: Object.freeze(
                  [...group.entries.values()].map((entry) => Object.freeze(entry)),
                ),
              }),
            ),
          ),
        }
      : {}),
    ...(items.length
      ? {
          appearances: Object.freeze(
            Object.fromEntries(
              Object.entries(appearances).map(([type, styles]) => [type, Object.freeze(styles)]),
            ),
          ),
        }
      : {}),
    totalCount: items.reduce((sum, item) => sum + item.count, 0),
    totalMinutes: items.reduce((sum, item) => sum + item.minutes, 0),
  });
}

export function combineShiftTypeAnalyses(
  parts: readonly MonthlyShiftTypeAnalysis[],
): MonthlyShiftTypeAnalysis {
  const groups = new Map<string, ShiftNameGroup>();
  for (const part of parts)
    for (const group of part.groups ?? []) {
      const previous = groups.get(group.key);
      groups.set(
        group.key,
        previous
          ? Object.freeze({
              ...previous,
              count: previous.count + group.count,
              minutes: previous.minutes + group.minutes,
              types: Object.freeze([...new Set([...previous.types, ...group.types])]),
              entries: Object.freeze([...previous.entries, ...group.entries]),
            })
          : group,
      );
    }
  const items = SHIFT_TYPES.map((type) => ({
    type,
    count: parts.reduce(
      (sum, part) => sum + (part.items.find((item) => item.type === type)?.count ?? 0),
      0,
    ),
    minutes: parts.reduce(
      (sum, part) => sum + (part.items.find((item) => item.type === type)?.minutes ?? 0),
      0,
    ),
  })).filter((item) => item.count > 0 || item.minutes > 0);
  const appearances: Partial<Record<ShiftType, readonly ShiftAppearance[]>> = {};
  for (const type of SHIFT_TYPES) {
    const styles = parts.flatMap((part) => part.appearances?.[type] ?? []);
    const unique = styles.filter(
      (style, index) =>
        styles.findIndex(
          (other) =>
            other.title === style.title &&
            other.color === style.color &&
            other.symbol === style.symbol,
        ) === index,
    );
    if (unique.length) appearances[type] = Object.freeze(unique);
  }
  return Object.freeze({
    ...(groups.size ? { groups: Object.freeze([...groups.values()]) } : {}),
    ...(Object.keys(appearances).length ? { appearances: Object.freeze(appearances) } : {}),
    items: Object.freeze(items.map((item) => Object.freeze(item))),
    totalCount: items.reduce((sum, item) => sum + item.count, 0),
    totalMinutes: items.reduce((sum, item) => sum + item.minutes, 0),
  });
}
