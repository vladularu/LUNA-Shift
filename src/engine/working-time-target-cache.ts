import type { MonthlyWorkingTimeTarget } from "@/domain/working-time-target";
import type { RuleResolver } from "@/rules/rule-resolver";

/** Bound retained profile/roster snapshots independently for each rule catalog. */
export function createWorkingTimeTargetCache() {
  const catalogs = new WeakMap<RuleResolver, Map<string, MonthlyWorkingTimeTarget>>();
  return {
    get(resolver: RuleResolver, key: string) {
      const cache = catalogs.get(resolver);
      const result = cache?.get(key);
      if (result) {
        cache!.delete(key);
        cache!.set(key, result);
      }
      return result;
    },
    set(resolver: RuleResolver, key: string, result: MonthlyWorkingTimeTarget) {
      const cache = catalogs.get(resolver) ?? new Map<string, MonthlyWorkingTimeTarget>();
      cache.delete(key);
      cache.set(key, result);
      if (cache.size > 48) cache.delete(cache.keys().next().value!);
      if (!catalogs.has(resolver)) catalogs.set(resolver, cache);
    },
  };
}
