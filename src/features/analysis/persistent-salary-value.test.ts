import { beforeAll, describe, expect, it } from "vitest";
import {
  analysisSalaryKey,
  prepareAnalysisSalarySteps,
  type PreparedAnalysisSalary,
} from "./analysis-salary";
import { encodeAnalysisCacheValue, decodeAnalysisCacheValue } from "./analysis-cache-codec";
import { persistentSalaryValue } from "./persistent-salary-value";
import { salaryPersistenceRequest } from "./salary-persistence-test-fixtures";

function calculate(month: string) {
  const request = salaryPersistenceRequest(month),
    steps = prepareAnalysisSalarySteps(request, analysisSalaryKey(request));
  while (true) {
    const step = steps.next();
    if (step.done) return { request, value: step.value };
  }
}
let available: ReturnType<typeof calculate>, unavailable: ReturnType<typeof calculate>;
beforeAll(() => {
  available = calculate("2026-10");
  unavailable = calculate("2027-10");
});
const copy = (value: PreparedAnalysisSalary) =>
  decodeAnalysisCacheValue(encodeAnalysisCacheValue(value)) as PreparedAnalysisSalary;

describe("complete persisted payout salary", () => {
  it("accepts the full real payout including source evidence, deductions and outgoing claims", () => {
    expect(available.value.forecast?.result.status).toBe("available");
    expect(available.value.projection?.sources.length).toBeGreaterThan(0);
    expect(persistentSalaryValue(available.value, available.request)).toBe(true);
    const restored = copy(available.value);
    expect(persistentSalaryValue(restored, available.request)).toBe(true);
    expect(encodeAnalysisCacheValue(restored)).toBe(encodeAnalysisCacheValue(available.value));
    expect(restored.projection).toEqual(available.value.projection);
  });
  it("retains complete deterministic unavailable results instead of repeating unchanged future-year work", () => {
    expect(unavailable.value.forecast?.result.status).toBe("unavailable");
    expect(persistentSalaryValue(copy(unavailable.value), unavailable.request)).toBe(true);
  });
  it("rejects a legacy projection-free result when the request requires a payout projection", () => {
    const value = copy(available.value);
    expect(persistentSalaryValue({ ...value, projection: undefined }, available.request)).toBe(
      false,
    );
    expect(
      persistentSalaryValue(
        { ...value, projection: { ...value.projection, month: "2026-09" } },
        available.request,
      ),
    ).toBe(false);
    expect(
      persistentSalaryValue(
        { ...value, projection: { ...value.projection, perspective: "EARNED" } },
        available.request,
      ),
    ).toBe(false);
  });
  it.each(["net", "tax", "source", "contribution", "forecast"])(
    "rejects incomplete or inconsistent %s data",
    (kind) => {
      const value = copy(available.value);
      const raw = value as unknown as Record<string, unknown>;
      const result = (raw.forecast as Record<string, unknown>).result as Record<string, unknown>;
      const pay = result.pay as Record<string, unknown>;
      if (kind === "net") pay.netCents = Number(pay.netCents) + 1;
      if (kind === "tax") delete (pay.tax as Record<string, unknown>).totalCents;
      if (kind === "source")
        delete (value.projection!.sources[0].profile as unknown as Record<string, unknown>)
          .timeZone;
      if (kind === "contribution")
        (value.projection!.contributions[0] as unknown as Record<string, unknown>).amountCents =
          NaN;
      if (kind === "forecast") raw.forecast = null;
      expect(persistentSalaryValue(value, available.request)).toBe(false);
    },
  );
  it("keeps failed attempts retryable and rejects values not supported by the JSON/Map codec", () => {
    const value = copy(unavailable.value);
    expect(
      persistentSalaryValue(
        {
          ...value,
          forecast: {
            sourceMonth: "2026-01",
            result: {
              status: "unavailable",
              stage: "sfn",
              reason: "Die vollständige Gehaltsprognose konnte nicht berechnet werden.",
            },
          },
        },
        unavailable.request,
      ),
    ).toBe(false);
    expect(
      persistentSalaryValue(
        {
          ...value,
          annual: { ...value.annual, issue: { code: "REFERENCE_MONTH_FAILED", month: "2026-08" } },
        },
        unavailable.request,
      ),
    ).toBe(false);
    expect(persistentSalaryValue({ ...value, unsupported: new Date() }, unavailable.request)).toBe(
      false,
    );
  });
});
