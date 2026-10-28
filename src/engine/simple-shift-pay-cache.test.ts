import { describe, expect, it, vi } from "vitest";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { createSimpleShiftPayCache } from "./simple-shift-pay-cache";

describe("bounded dated shift results", () => {
  it("shares exact contents, invalidates edits/options and separates catalogs", () => {
    const cached = createSimpleShiftPayCache<object>();
    const calculate = vi.fn(() => ({ amounts: [10, 20] }));
    const shift = { id: "one", revision: 1, endTime: "07:00" };
    const first = cached(bundledRuleResolver, [shift, false], calculate);
    expect(cached(bundledRuleResolver, [{ ...shift }, false], calculate)).toBe(first);
    shift.endTime = "08:00";
    expect(cached(bundledRuleResolver, [shift, false], calculate)).not.toBe(first);
    cached(bundledRuleResolver, [shift, true], calculate);
    cached({ ...bundledRuleResolver }, [shift, true], calculate);
    expect(calculate).toHaveBeenCalledTimes(4);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen((first as { amounts: number[] }).amounts)).toBe(true);
  });
  it("retries failures and evicts old entries", () => {
    const cached = createSimpleShiftPayCache<number>(2);
    const calculate = vi.fn(() => {
      throw new Error("transient");
    });
    expect(() => cached(bundledRuleResolver, [1], calculate)).toThrow("transient");
    expect(cached(bundledRuleResolver, [1], () => 1)).toBe(1);
    cached(bundledRuleResolver, [2], () => 2);
    cached(bundledRuleResolver, [3], () => 3);
    const recalculated = vi.fn(() => 4);
    expect(cached(bundledRuleResolver, [1], recalculated)).toBe(4);
    expect(recalculated).toHaveBeenCalledOnce();
  });
});
