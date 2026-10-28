import { describe, expect, it } from "vitest";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { createAnalysisResultCache } from "./analysis-result-cache";

describe("complete analysis snapshots", () => {
  it("keeps one current-month result within the same limit while distant months churn", () => {
    const cache = createAnalysisResultCache<number>(2);
    cache.write(bundledRuleResolver, "current", 1, true);
    for (let index = 2; index < 30; index++) cache.write(bundledRuleResolver, String(index), index);
    expect(cache.read(bundledRuleResolver, "current")).toBe(1);
    expect(cache.read(bundledRuleResolver, "2")).toBeNull();
    expect(cache.read(bundledRuleResolver, "29")).toBe(29);
    cache.read(bundledRuleResolver, "29", true);
    cache.write(bundledRuleResolver, "next", 30);
    expect(cache.read(bundledRuleResolver, "current")).toBeNull();
    expect(cache.read(bundledRuleResolver, "29")).toBe(29);
    expect(cache.read(bundledRuleResolver, "changed-current-key")).toBeNull();
  });
  it("retains an already deeply immutable estimate shared by other consumers", () => {
    const cache = createAnalysisResultCache<object>();
    const estimate = Object.freeze({ amounts: Object.freeze([450, 60]) });
    expect(cache.write(bundledRuleResolver, "shared", estimate)).toBe(estimate);
  });

  it("copies a shallowly frozen wrapper when its nested input remains mutable", () => {
    const cache = createAnalysisResultCache<{ nested: { minutes: number } }>();
    const input = Object.freeze({ nested: { minutes: 450 } });
    const stored = cache.write(bundledRuleResolver, "shallow", input);
    input.nested.minutes = 60;
    expect(stored.nested.minutes).toBe(450);
    expect(Object.isFrozen(input.nested)).toBe(false);
  });
  it("copies and freezes nested results without changing caller objects", () => {
    const cache = createAnalysisResultCache<{ nested: { minutes: number }[] }>();
    const input = { nested: [{ minutes: 450 }] };
    const stored = cache.write(bundledRuleResolver, "one", input);
    input.nested[0].minutes = 60;
    expect(stored.nested[0].minutes).toBe(450);
    expect(Object.isFrozen(input.nested[0])).toBe(false);
    expect(Object.isFrozen(stored.nested[0])).toBe(true);
  });

  it("shares safe entry snapshots across neighbouring months, including mutation detection", () => {
    const cache = createAnalysisResultCache<object>();
    const entry = { kind: "SHIFT", id: "work", minutes: 450 };
    const first = cache.write(bundledRuleResolver, "one", { entry });
    const second = cache.write(bundledRuleResolver, "two", { entry });
    expect(first).toEqual(second);
    expect((first as { entry: object }).entry).toBe((second as { entry: object }).entry);
    entry.minutes = 480;
    const third = cache.write(bundledRuleResolver, "three", { entry });
    expect(third).toEqual({ entry: { ...entry } });
    expect(first).toEqual({ entry: { ...entry, minutes: 450 } });
  });

  it("evicts the least recently used month and isolates catalog snapshots", () => {
    const cache = createAnalysisResultCache<number>(2);
    cache.write(bundledRuleResolver, "a", 1);
    cache.write(bundledRuleResolver, "b", 2);
    expect(cache.read(bundledRuleResolver, "a")).toBe(1);
    cache.write(bundledRuleResolver, "c", 3);
    expect(cache.read(bundledRuleResolver, "b")).toBeNull();
    expect(cache.read({ ...bundledRuleResolver }, "a")).toBeNull();
  });
});
