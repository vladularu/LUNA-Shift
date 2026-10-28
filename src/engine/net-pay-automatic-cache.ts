import type { RuleResolver } from "@/rules/rule-resolver";
import { resolveNetPayCalculationBasis } from "./net-pay-calculation-basis";
import type {
  AutomaticNetPayForecast,
  calculateAutomaticNetPayForecast,
} from "./net-pay-automatic-forecast";

type Input = Parameters<typeof calculateAutomaticNetPayForecast>[0];
const LIMIT = 12;

function freeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value)) freeze(child, visited);
  return Object.freeze(value);
}

/** In-memory only. Content keys handle fresh SQL objects and edits without a revision change. */
export function createAutomaticNetPayCache() {
  const catalogs = new WeakMap<RuleResolver, Map<string, AutomaticNetPayForecast>>();
  const keyFor = (input: Input) =>
    JSON.stringify([
      input.month,
      resolveNetPayCalculationBasis(input.month, "FORECAST"),
      input.profile,
      input.settings,
      input.shifts,
      input.pay,
    ]);
  const read = (input: Input, resolver: RuleResolver) => {
    const key = keyFor(input);
    const entries = catalogs.get(resolver);
    const cached = entries?.get(key);
    if (cached) {
      entries!.delete(key);
      entries!.set(key, cached);
      return cached;
    }
    return null;
  };
  const write = (input: Input, resolver: RuleResolver, forecast: AutomaticNetPayForecast) => {
    // Failed or incomplete calculations must be retried when underlying data becomes available.
    if (forecast.result.status !== "available") return forecast;
    const key = keyFor(input);
    const entries = catalogs.get(resolver) ?? new Map<string, AutomaticNetPayForecast>();
    const snapshot = freeze(forecast);
    entries.set(key, snapshot);
    if (entries.size > LIMIT) entries.delete(entries.keys().next().value!);
    if (!catalogs.has(resolver)) catalogs.set(resolver, entries);
    return snapshot;
  };
  return Object.assign(
    (input: Input, resolver: RuleResolver, calculate: () => AutomaticNetPayForecast) =>
      read(input, resolver) ?? write(input, resolver, calculate()),
    { read, write },
  );
}
