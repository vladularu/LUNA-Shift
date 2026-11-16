import { describe, expect, it } from "vitest";
import {
  createMonthlyRustBridge,
  monthlyRustResult,
  monthlyRustSteps,
} from "./monthly-rust-bridge";
import type { MonthlyAnalysisCalculation, MonthlyAnalysisRequest } from "./monthly-analysis";
import fixture from "./monthly-rust-native.fixture.json";
import { bundledRuleResolver } from "@/rules/rule-resolver";

const request = () =>
  ({
    ...fixture.request,
    workPatternSettings: undefined,
    ruleResolver: bundledRuleResolver,
  }) as MonthlyAnalysisRequest;
const value = fixture.value as unknown as MonthlyAnalysisCalculation;
function report() {
  return {
    period: { kind: "MONTH", month: fixture.request.month },
    sections: {
      time: {
        state: "READY",
        value: {
          monthShifts: value.monthShifts,
          summary: value.summary,
          shiftTypeAnalysis: value.shiftTypeAnalysis,
        },
      },
      gross: {
        state: "READY",
        value: { legacy: { state: "READY", value: fixture.value.pay.value } },
      },
    },
    get views(): never {
      throw new Error("UI presentation must not be read");
    },
  };
}

describe("Rust month domain boundary", () => {
  it("rejects a different native binary before admitting calculations", async () => {
    const unused = async () => {
      throw new Error("No source may be admitted");
    };
    const calculate = createMonthlyRustBridge({
      expectedEngineVersion: "expected-engine",
      invoke: async () =>
        JSON.stringify({ ok: true, engineVersion: "other-engine", sourceKinds: [] }),
      source: unused,
      calendarRanks: unused,
      catalogFinalize: unused,
    });
    await expect(
      calculate(request(), { referenceDate: "2026-07-01", sources: {}, catalogs: {} }),
    ).rejects.toThrow("RUST_MONTH_ENGINE_MISMATCH");
  });
  it("uses real recorded domain fields without touching native UI output", () => {
    expect(monthlyRustResult(request(), report())).toEqual(value);
  });
  it("rejects an answer belonging to another month", () => {
    const payload = report();
    payload.period.month = "2026-08";
    expect(() => monthlyRustResult(request(), payload)).toThrow("RUST_MONTH_PERIOD_MISMATCH");
  });
  it("keeps missing salary unavailable instead of inventing zero values", () => {
    const payload = report();
    payload.sections.gross.value.legacy = { state: "UNAVAILABLE", value: undefined } as never;
    expect(() => monthlyRustResult(request(), payload)).toThrow("RUST_MONTH_UNAVAILABLE");
  });
  it("waits on one native promise through the existing work queue", async () => {
    let finish!: (value: MonthlyAnalysisCalculation) => void;
    const steps = monthlyRustSteps(
      request(),
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const waiting = steps.next();
    expect(waiting.done).toBe(false);
    expect(waiting.value).toBeInstanceOf(Promise);
    finish(value);
    await waiting.value;
    expect(steps.next()).toEqual({ done: true, value });
  });
  it("forwards a failed native calculation", async () => {
    const steps = monthlyRustSteps(request(), () => Promise.reject(new Error("native failed")));
    await expect(steps.next().value).rejects.toThrow("native failed");
  });
});
