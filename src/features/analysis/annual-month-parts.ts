import { SHIFT_TYPES } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import type { AvailableMonthCache, createAnnualAvailableReportCache } from "./annual-core-report";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { persistentCheckValue } from "./persistent-analysis-values";

// This locates the latest candidate only. Each restored part still has to
// match its complete current input key inside calculateAvailableMonth.
export const ANNUAL_MONTH_PARTS_KEY = "annual-month-parts-v1";
export interface AnnualMonthParts {
  readonly month: string;
  readonly parts: AvailableMonthCache;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const numbers = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => number(value[key]));
const optionalNumber = (value: unknown) => value === undefined || value === null || number(value);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const shiftType = (value: unknown) => SHIFT_TYPES.some((type) => type === value);
const appearance = (value: unknown) =>
  record(value) && ["title", "color", "symbol"].every((key) => typeof value[key] === "string");

function shiftAnalysis(value: unknown) {
  return (
    record(value) &&
    numbers(value, ["totalCount", "totalMinutes"]) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item: unknown) =>
        record(item) && shiftType(item.type) && numbers(item, ["count", "minutes"]),
    ) &&
    (value.appearances === undefined ||
      (record(value.appearances) &&
        Object.entries(value.appearances).every(
          ([type, styles]) => shiftType(type) && Array.isArray(styles) && styles.every(appearance),
        ))) &&
    (value.groups === undefined ||
      (Array.isArray(value.groups) &&
        value.groups.every(
          (group: unknown) =>
            record(group) &&
            appearance(group) &&
            typeof group.key === "string" &&
            numbers(group, ["count", "minutes"]) &&
            Array.isArray(group.types) &&
            group.types.every(shiftType) &&
            Array.isArray(group.entries) &&
            group.entries.every(
              (entry: unknown) =>
                record(entry) &&
                typeof entry.id === "string" &&
                typeof entry.date === "string" &&
                number(entry.minutes),
            ),
        )))
  );
}

/** Validate every field the annual aggregator consumes, including nested checks and groups. */
export function persistentAnnualMonthParts(value: unknown): value is AnnualMonthParts {
  if (
    !record(value) ||
    typeof value.month !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) ||
    !record(value.parts) ||
    value.parts.remuneration !== undefined
  )
    return false;
  const month = value.month;
  const validators: Record<string, (value: unknown) => boolean> = {
    summary: (item) =>
      record(item) &&
      item.month === month &&
      numbers(item, ["targetMinutes", "actualMinutes", "balanceMinutes"]) &&
      optionalNumber(item.timeAccountMinutes) &&
      (item.specialDutyNotes === undefined || strings(item.specialDutyNotes)) &&
      (item.targetCalculation === undefined ||
        (record(item.targetCalculation) &&
          ["FINAL", "PROVISIONAL", "UNAVAILABLE"].includes(String(item.targetCalculation.status)))),
    compliance: (item) => persistentCheckValue(item) && item.month === month,
    pay: (item) =>
      record(item) &&
      item.month === month &&
      typeof item.available === "boolean" &&
      (item.estimatedGrossAmount === null || number(item.estimatedGrossAmount)) &&
      numbers(item, [
        "timePremiumAmount",
        "overtimeAmount",
        "allowanceAmount",
        "tvoedAllowanceAmount",
        "careAllowanceAmount",
      ]),
    shiftTypeAnalysis: shiftAnalysis,
  };
  const parts = Object.entries(value.parts);
  return (
    parts.length > 0 &&
    parts.every(
      ([name, part]) =>
        Object.hasOwn(validators, name) &&
        record(part) &&
        typeof part.key === "string" &&
        part.key.length > 0 &&
        (part.value === null || validators[name]!(part.value)),
    )
  );
}

export function annualMonthPartsSession(
  year: number,
  resolver: RuleResolver,
  cache: ReturnType<typeof createAnnualAvailableReportCache>,
  persistent: PersistentAnalysisCache | null,
) {
  const claims = new Map<string, () => boolean>();
  return {
    async restore(current: () => boolean) {
      if (!persistent || !current()) return;
      const months = cache.get(resolver) ?? new Map<string, AvailableMonthCache>();
      cache.set(resolver, months);
      await Promise.all(
        Array.from({ length: 12 }, async (_, index) => {
          const month = `${year}-${String(index + 1).padStart(2, "0")}`;
          claims.set(month, persistent.claim?.("annual-month", month) ?? (() => true));
          if (months.has(month)) return;
          const saved = await persistent.read(
            "annual-month",
            month,
            ANNUAL_MONTH_PARTS_KEY,
            resolver,
            persistentAnnualMonthParts,
          );
          if (!current() || saved?.month !== month || months.has(month)) return;
          if (months.size >= 36) months.delete(months.keys().next().value!);
          months.set(month, { ...saved.parts });
        }),
      );
    },
    save(month: string, parts: AvailableMonthCache) {
      if (!persistent) return;
      // Shallow-copy the cache container before async hashing: later requests
      // may replace its parts, but cannot alter this completed month's snapshot.
      void persistent.write(
        "annual-month",
        month,
        ANNUAL_MONTH_PARTS_KEY,
        resolver,
        { month, parts: { ...parts } },
        persistentAnnualMonthParts,
        claims.get(month),
      );
    },
  };
}
