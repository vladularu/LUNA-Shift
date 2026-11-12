import type { RuleResolver } from "@/rules/rule-resolver";
import type { PersistentAnalysisCache } from "@/features/analysis/persistent-analysis-cache";
import type { AnnualCacheRowDiagnosis } from "@/infrastructure/database/analysis-result-repository";
import { calendarPerformance } from "@/application/calendar-performance";

type Recorder = Pick<typeof calendarPerformance, "capture" | "getSnapshot">;
const parts = ["summary", "shiftTypeAnalysis", "compliance", "pay", "remuneration"] as const;
type Keys = Partial<Record<(typeof parts)[number], string>>;
const MAX_MONTHS = 36;
const MAX_CHARACTERS = 1_000_000;

export function observeAnnualCacheRead(month: string) {
  if (!calendarPerformance.getSnapshot()) return null;
  const record = calendarPerformance.capture();
  return (value: AnnualCacheRowDiagnosis) =>
    record("analysis-cache-row", { month: Number(month.replace("-", "")), stage: 4, ...value });
}

function keysOf(value: unknown, month: string): Keys {
  const keys: Keys = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return keys;
  const envelope = value as Record<string, unknown>;
  if (
    !Object.hasOwn(envelope, "month") ||
    envelope.month !== month ||
    !Object.hasOwn(envelope, "parts")
  )
    return keys;
  const stored = envelope.parts;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return keys;
  for (const part of parts) {
    if (!Object.hasOwn(stored, part)) continue;
    const item = (stored as Record<string, unknown>)[part];
    if (item && typeof item === "object" && Object.hasOwn(item, "key")) {
      const key = (item as { key?: unknown }).key;
      if (typeof key === "string") keys[part] = key;
    }
  }
  return keys;
}

/** Numeric differences only. A schema we cannot recognize stays explicitly unknown. */
function changedInputs(part: (typeof parts)[number], before: string, after: string) {
  try {
    const a: unknown = JSON.parse(before),
      b: unknown = JSON.parse(after);
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2) return 128;
    const left: unknown = a[1],
      right: unknown = b[1];
    const fields =
      part === "pay"
        ? [1, 1, 2, 16, 32]
        : part === "compliance"
          ? [1, 2, 4, 8]
          : part === "remuneration"
            ? null
            : [1, 2];
    if (
      !fields ||
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== fields.length ||
      right.length !== fields.length
    )
      return 128;
    let flags = JSON.stringify(a[0]) === JSON.stringify(b[0]) ? 0 : 64;
    fields.forEach((flag, index) => {
      if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) flags |= flag;
    });
    return flags || 128;
  } catch {
    return 128;
  }
}

/** Observe optional persistence without changing calculation keys, values or claims. */
export function observeAnnualMonthCache(
  cache: PersistentAnalysisCache,
  recorder: Recorder = calendarPerformance,
): PersistentAnalysisCache {
  const restored = new Map<string, { resolver: RuleResolver; keys: Keys; size: number }>();
  let session = 0,
    characters = 0;
  function active() {
    const next = recorder.getSnapshot();
    if (session !== next) {
      restored.clear();
      characters = 0;
      session = next;
    }
    return next;
  }
  function remember(month: string, resolver: RuleResolver, value: unknown) {
    const keys = keysOf(value, month);
    const size = Object.values(keys).reduce((sum, key) => sum + key.length, 0);
    const old = restored.get(month);
    if (old) characters -= old.size;
    restored.delete(month);
    if (size > MAX_CHARACTERS) return;
    restored.set(month, { resolver, keys, size });
    characters += size;
    while (restored.size > MAX_MONTHS || characters > MAX_CHARACTERS) {
      const first = restored.keys().next().value!;
      characters -= restored.get(first)!.size;
      restored.delete(first);
    }
  }
  return {
    claim: cache.claim?.bind(cache),
    async read(kind, month, key, resolver, accept) {
      const owner = active();
      const value = await cache.read(kind, month, key, resolver, accept);
      try {
        if (kind === "annual-month" && value !== null && owner && active() === owner)
          remember(month, resolver, value);
      } catch {
        // Recording failure must not turn a valid cache hit into a miss.
      }
      return value;
    },
    write(kind, month, key, resolver, value, accept, current) {
      try {
        if (kind === "annual-month" && active()) {
          const previous = restored.get(month);
          const before = previous?.resolver === resolver ? previous.keys : {};
          const after = keysOf(value, month);
          let input = 0,
            valid = 0,
            reused = 0,
            changed = 0,
            reason = 0;
          parts.forEach((part, index) => {
            const flag = 1 << index,
              oldKey = before[part],
              newKey = after[part];
            if (oldKey !== undefined) input |= flag;
            if (newKey !== undefined) valid |= flag;
            if (oldKey === undefined || newKey === undefined) return;
            if (oldKey === newKey) reused |= flag;
            else {
              changed |= flag;
              reason |= changedInputs(part, oldKey, newKey);
            }
          });
          recorder.capture()("analysis-parts", {
            month: Number(month.replace("-", "")),
            stage: 5,
            input,
            valid,
            cache: reused,
            state: changed,
            reason,
          });
        }
      } catch {
        // No domain data is modified; diagnostics are strictly optional.
      }
      return cache.write(kind, month, key, resolver, value, accept, current);
    },
  };
}
