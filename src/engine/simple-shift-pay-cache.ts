import type { RuleResolver } from "@/rules/rule-resolver";

function immutable<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value)) immutable(child, visited);
  return Object.freeze(value);
}

/** Successful dated shift calculations only; exact inputs, resolver isolation, bounded memory. */
export function createSimpleShiftPayCache<T>(limit = 1024) {
  const catalogs = new WeakMap<RuleResolver, Map<string, T>>();
  return (resolver: RuleResolver, inputs: readonly unknown[], calculate: () => T): T => {
    const key = JSON.stringify(inputs);
    const cache = catalogs.get(resolver) ?? new Map<string, T>();
    if (cache.has(key)) {
      const result = cache.get(key)!;
      cache.delete(key);
      cache.set(key, result);
      return result;
    }
    const result = immutable(calculate());
    cache.set(key, result);
    if (cache.size > limit) cache.delete(cache.keys().next().value!);
    catalogs.set(resolver, cache);
    return result;
  };
}

/** The same bounded primitive also holds derived inputs for monthly pay calculations. */
export const createSimplePayCache = createSimpleShiftPayCache;
