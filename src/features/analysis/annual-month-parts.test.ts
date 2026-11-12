import { describe, expect, it, vi } from "vitest";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { createRuleResolver } from "@/rules/rule-resolver";
import {
  buildAnnualAvailableReportSteps,
  createAnnualAvailableReportCache,
  type AvailableMonthCache,
} from "./annual-core-report";
import {
  annualMonthPartsSession,
  persistentAnnualMonthParts,
  type AnnualMonthParts,
} from "./annual-month-parts";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { decodeAnalysisCacheValue, encodeAnalysisCacheValue } from "./analysis-cache-codec";

const resolver = createRuleResolver();
function calculate(
  cache = createAnnualAvailableReportCache(),
  onMonth = (_month: string, _parts: AvailableMonthCache) => {},
) {
  const steps = buildAnnualAvailableReportSteps(
    2026,
    [forecastShift({ date: "2026-06-05" })],
    forecastProfile,
    [],
    DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    "2026-11-12",
    resolver,
    { cache, onMonth },
  );
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
const saved = () => {
  const values: AnnualMonthParts[] = [];
  calculate(undefined, (month, parts) => values.push({ month, parts: { ...parts } }));
  return values;
};
describe("annual monthly parts", () => {
  it.each(["constructor", "toString", "__proto__"])(
    "rejects inherited validator names such as %s",
    (name) => {
      expect(
        persistentAnnualMonthParts({
          month: "2026-06",
          parts: Object.fromEntries([[name, { key: "input", value: null }]]),
        }),
      ).toBe(false);
    },
  );
  it("round-trips all twelve months, including unavailable salary coverage", () => {
    const values = saved();
    expect(values).toHaveLength(12);
    for (const value of values)
      expect(
        persistentAnnualMonthParts(decodeAnalysisCacheValue(encodeAnalysisCacheValue(value))),
      ).toBe(true);
  });
  it("does not write unchanged months again when the in-memory parts are reused", () => {
    const cache = createAnnualAvailableReportCache(),
      changes = vi.fn();
    const first = calculate(cache, changes);
    expect(changes).toHaveBeenCalledTimes(12);
    changes.mockClear();
    expect(calculate(cache, changes)).toEqual(first);
    expect(changes).not.toHaveBeenCalled();
  });
  it("rejects mismatched months, malformed nested groups, incomplete parts and non-finite values", () => {
    const value = saved()[5]!;
    expect(persistentAnnualMonthParts({ ...value, month: "2026-13" })).toBe(false);
    expect(persistentAnnualMonthParts({ ...value, month: "2025-06" })).toBe(false);
    expect(
      persistentAnnualMonthParts({ ...value, parts: { summary: { key: "", value: null } } }),
    ).toBe(false);
    expect(
      persistentAnnualMonthParts({
        ...value,
        parts: {
          pay: { key: "input", value: { ...value.parts.pay!.value, allowanceAmount: Infinity } },
        },
      }),
    ).toBe(false);
    expect(
      persistentAnnualMonthParts({
        ...value,
        parts: {
          shiftTypeAnalysis: {
            key: "input",
            value: { ...value.parts.shiftTypeAnalysis!.value, groups: [{ entries: null }] },
          },
        },
      }),
    ).toBe(false);
  });
  it("discards late canceled restores and never replaces newer in-memory parts", async () => {
    const value = saved()[5]!,
      cache = createAnnualAvailableReportCache();
    let resolve!: (value: AnnualMonthParts) => void;
    const persistent = {
      read: () =>
        new Promise<AnnualMonthParts>((done) => {
          resolve = done;
        }),
      write: vi.fn(),
    } as unknown as PersistentAnalysisCache;
    // Restrict the pending-read test to one missing month.
    cache.set(
      resolver,
      new Map(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, {}])),
    );
    cache.get(resolver)!.delete("2026-06");
    let active = true;
    const pending = annualMonthPartsSession(2026, resolver, cache, persistent).restore(
      () => active,
    );
    active = false;
    resolve(value);
    await pending;
    expect(cache.get(resolver)!.has("2026-06")).toBe(false);
    const second = annualMonthPartsSession(2026, resolver, cache, persistent).restore(() => true);
    const newer = { summary: { key: "newer", value: null } };
    cache.get(resolver)!.set("2026-06", newer);
    resolve(value);
    await second;
    expect(cache.get(resolver)!.get("2026-06")).toBe(newer);
  });
});
