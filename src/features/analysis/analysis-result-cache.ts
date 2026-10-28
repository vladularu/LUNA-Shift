import type { RuleResolver } from "@/rules/rule-resolver";
import { currentMonth } from "@/engine/calendar";

export function isCurrentAnalysisMonth(month: string, timeZone: string) {
  try {
    return month === currentMonth(timeZone);
  } catch {
    return false;
  }
}

const entrySnapshots = new WeakMap<object, { readonly key: string; readonly value: object }>();
const immutableResults = new WeakSet<object>();

function deeplyFrozen(value: object): boolean {
  if (immutableResults.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  if (
    !Object.values(value).every(
      (child) => child === null || typeof child !== "object" || deeplyFrozen(child),
    )
  )
    return false;
  immutableResults.add(value);
  return true;
}

function snapshot<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  // Engine-owned, deeply immutable estimates are already shared with salary details.
  if (deeplyFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  const entry = "kind" in value && (value.kind === "SHIFT" || value.kind === "APPOINTMENT");
  const key = entry ? JSON.stringify(value) : null;
  const existing = entry ? entrySnapshots.get(value) : null;
  if (existing && existing.key === key) return existing.value as T;
  const result = Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)])),
  ) as T;
  // Adjacent months share immutable entry snapshots and the engine's interval preparation.
  if (key !== null) entrySnapshots.set(value, { key, value: result as object });
  return result;
}

/** Exact content keys, bounded memory, and no freezing of application-owned input objects. */
export function createAnalysisResultCache<T>(limit = 18) {
  const catalogs = new WeakMap<RuleResolver, Map<string, T>>();
  const retained = new WeakMap<RuleResolver, string>();
  return {
    read(resolver: RuleResolver, key: string, keepCurrent = false): T | null {
      const entries = catalogs.get(resolver);
      if (!entries?.has(key)) return null;
      const value = entries.get(key)!;
      if (keepCurrent) retained.set(resolver, key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    write(resolver: RuleResolver, key: string, result: T, keepCurrent = false): T {
      const entries = catalogs.get(resolver) ?? new Map<string, T>();
      const value = snapshot(result);
      entries.delete(key);
      entries.set(key, value);
      if (keepCurrent) retained.set(resolver, key);
      if (entries.size > limit) {
        const oldest = [...entries.keys()].find(
          (candidate) => candidate !== retained.get(resolver),
        );
        entries.delete(oldest ?? entries.keys().next().value!);
      }
      catalogs.set(resolver, entries);
      return value;
    },
  };
}
