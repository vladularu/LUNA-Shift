import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const WORKPLACE_RULES_KEY = "check_workplace_rules_v1";
export const questionIds = [
  "week",
  "series",
  "weekend",
  "night",
  "recovery",
  "rest",
  "switch",
  "duration",
] as const;
export type QuestionId = (typeof questionIds)[number];
const number = (max: number) => z.number().int().min(1).max(max);
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    try {
      return Temporal.PlainDate.from(value).toString() === value;
    } catch {
      return false;
    }
  }, "Bitte ein gültiges Datum eingeben.");
const duty = z.enum(["all", "regular", "standby", "callout"]);
const common = { source: z.enum(["agreed", "usual"]), onRequest: z.boolean() };
export const ruleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("unknown") }),
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("limit"), ...common, count: number(366) }),
  z.object({
    mode: z.literal("average"),
    ...common,
    count: z.number().positive().max(7),
    weeks: number(52),
  }),
  z.object({
    mode: z.literal("alternate"),
    ...common,
    anchor: isoDate
      .refine(
        (v) => isoDate.safeParse(v).success && Temporal.PlainDate.from(v).dayOfWeek === 6,
        "Bitte den Samstag eines freien Wochenendes wählen.",
      )
      .nullable(),
  }),
  z.object({ mode: z.literal("monthly"), ...common, count: number(5) }),
  z.object({ mode: z.literal("rolling"), ...common, count: number(52), weeks: number(52) }),
  z.object({ mode: z.literal("off"), ...common }),
  z.object({
    mode: z.literal("recovery"),
    ...common,
    count: number(744),
    unit: z.enum(["hours", "days"]),
    nights: number(31),
  }),
  z.object({
    mode: z.literal("rest"),
    ...common,
    minutes: number(1440),
    duty,
    basis: z.string().max(250),
    compensation: z.string().max(250),
    agreementConfirmed: z.literal(true).optional(),
    makeup: z.object({ minutes: number(2880).min(661), days: number(366) }).optional(),
  }),
  z.object({
    mode: z.literal("switch"),
    ...common,
    from: z.enum(["EARLY", "LATE", "NIGHT"]),
    to: z.enum(["EARLY", "LATE", "NIGHT"]),
  }),
  z.object({
    mode: z.literal("duration"),
    ...common,
    minutes: number(2880),
    duty,
    gross: z.boolean(),
    basis: z.string().max(250),
  }),
]);
export type WorkplaceRule = z.infer<typeof ruleSchema>;

/** Older custom limits only recorded the source. Exactly ten hours can also be the statutory care preset. */
export function hasAgreedRestLimit(rule: Extract<WorkplaceRule, { mode: "rest" }>) {
  return (
    rule.source === "agreed" &&
    rule.minutes >= 540 &&
    rule.minutes < 660 &&
    (rule.minutes !== 600 || rule.agreementConfirmed === true || !!rule.makeup)
  );
}
export type RuleSet = Partial<Record<QuestionId, WorkplaceRule>>;
export const modes: Record<QuestionId, readonly WorkplaceRule["mode"][]> = {
  week: ["limit", "average"],
  series: ["limit"],
  weekend: ["alternate", "monthly", "rolling", "off"],
  night: ["limit", "off"],
  recovery: ["recovery"],
  rest: ["rest"],
  switch: ["switch"],
  duration: ["duration"],
};
export function validateRule(id: QuestionId, value: unknown): WorkplaceRule {
  const r = ruleSchema.parse(value);
  if (r.mode === "none" || r.mode === "unknown") return r;
  if (
    !modes[id].includes(r.mode) ||
    (id === "week" && r.mode === "limit" && r.count > 7) ||
    (r.mode === "rolling" && r.count > r.weeks)
  )
    throw new Error("Bitte prüfe Wert und Zeitraum der Regel.");
  return r;
}
const change = z.object({ from: isoDate, rules: z.record(z.enum(questionIds), ruleSchema) });
export const dataSchema = z
  .object({ handled: z.boolean(), history: z.array(change), exceptions: z.array(z.string()) })
  .superRefine((data, ctx) => {
    let last = "";
    for (const item of data.history) {
      if (item.from <= last)
        ctx.addIssue({ code: "custom", message: "Ungültige Reihenfolge im Verlauf." });
      last = item.from;
      for (const id of questionIds)
        if (item.rules[id]) {
          try {
            validateRule(id, item.rules[id]);
          } catch {
            ctx.addIssue({ code: "custom", message: "Ungültige Regel für " + id });
          }
        }
    }
  });
export type WorkplaceData = z.infer<typeof dataSchema>;
export const emptyWorkplaceData: WorkplaceData = { handled: false, history: [], exceptions: [] };
export function rulesAt(history: WorkplaceData["history"], date: string): RuleSet {
  return Object.assign(
    {},
    ...history.filter((item) => item.from <= date).map((item) => item.rules),
  );
}
export function changeRule(
  data: WorkplaceData,
  date: string,
  id: QuestionId,
  value: WorkplaceRule,
): WorkplaceData {
  isoDate.parse(date);
  const rules = {
    ...data.history.find((item) => item.from === date)?.rules,
    [id]: validateRule(id, value),
  };
  return {
    ...data,
    history: [...data.history.filter((item) => item.from !== date), { from: date, rules }].sort(
      (a, b) => a.from.localeCompare(b.from),
    ),
  };
}

/** Earliest supported date for a rule covering the entire calendar. */
export const ALL_WORKPLACE_DATES = "0001-01-01";
export function changeRuleForAllDates(
  data: WorkplaceData,
  id: QuestionId,
  rule: WorkplaceRule,
): WorkplaceData {
  const history = data.history.flatMap((row) => {
    if (!row.rules[id]) return [row];
    const rules = { ...row.rules };
    delete rules[id];
    return Object.keys(rules).length ? [{ ...row, rules }] : [];
  });
  return changeRule({ ...data, history }, ALL_WORKPLACE_DATES, id, rule);
}
