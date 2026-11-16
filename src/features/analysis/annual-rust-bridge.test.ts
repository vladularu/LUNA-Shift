import { describe, expect, it } from "vitest";
import {
  annualRustReportResult,
  annualRustNetResult,
  annualRustRequest,
  type AnnualRustCalculator,
} from "./annual-rust-bridge";
import { annualAnalysisKey, type AnnualAnalysisRequest } from "./annual-analysis";
import { persistentAnnualNetPay } from "./annual-net-pay-cache";
import type { AnnualRustDomainReport } from "./monthly-rust-finance";
import fixture from "./annual-rust-bridge.fixture.json";

const raw = () => structuredClone(fixture.rawBase) as unknown as AnnualRustDomainReport;
describe("recorded real Rust annual domain reports", () => {
  it("maps all original report fields and revives the existing distribution Map", () => {
    const value = annualRustReportResult(fixture.base.year, raw());
    expect({ ...value, distribution: [...value.distribution] }).toEqual(fixture.report);
    expect(value).not.toHaveProperty("views");
  });
  it("retains the complete original net and mathematical annual payment forecast", () => {
    const value = annualRustNetResult(
      fixture.base.year,
      fixture.rawNet as unknown as AnnualRustDomainReport,
    );
    expect(value).toEqual(fixture.net);
    expect(persistentAnnualNetPay(value, fixture.base.year, true)).toBe(true);
    const { salaryForecast: _forecast, ...legacy } = value;
    expect(persistentAnnualNetPay(legacy, fixture.base.year, true)).toBe(false);
    expect(persistentAnnualNetPay(legacy, fixture.base.year)).toBe(true);
  });
  it.each(["wrong year", "missing month", "unavailable checks", "nonfinite gross"])(
    "rejects %s instead of inventing values",
    (failure) => {
      const value = structuredClone(fixture.rawBase);
      if (failure === "wrong year") value.period.year++;
      if (failure === "missing month") value.sections.time.value.months.pop();
      if (failure === "unavailable checks")
        Object.assign(value.sections.checks, { state: "UNAVAILABLE", value: null });
      if (failure === "nonfinite gross")
        value.sections.gross.value.legacy.value.estimatedGrossAmount = Infinity;
      expect(() =>
        annualRustReportResult(fixture.base.year, value as unknown as AnnualRustDomainReport),
      ).toThrow();
    },
  );
  it("separates engine versions while preserving the original key when disabled", () => {
    const request = fixture.base as unknown as AnnualAnalysisRequest;
    expect(annualRustRequest(request, null)).toBe(request);
    const calculator = { cacheIdentity: "engine-one" } as AnnualRustCalculator;
    expect(annualAnalysisKey(annualRustRequest(request, calculator))).not.toBe(
      annualAnalysisKey(request),
    );
    expect(annualAnalysisKey(annualRustRequest(request, calculator))).not.toBe(
      annualAnalysisKey(annualRustRequest(request, { ...calculator, cacheIdentity: "engine-two" })),
    );
  });
});
