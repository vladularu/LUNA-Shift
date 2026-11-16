import { describe, expect, it } from "vitest";
import { monthlyRustSalaryPreparationResult } from "./monthly-rust-salary-preparation";
import netFixture from "./monthly-rust-net.fixture.json";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import type { AnalysisSalaryRequest } from "./analysis-salary";
import fixture from "./monthly-rust-salary-preparation.fixture.json";
import type { MonthlyRustDomainReport } from "./monthly-rust-finance";
const request = {
  ...netFixture.request,
  context: { ...netFixture.request.context, resolver: bundledRuleResolver },
} as unknown as AnalysisSalaryRequest;
describe("native complete salary preparation", () => {
  it("restores the original complete DTO without reading a native view", () => {
    const input = {
      ...fixture.request,
      context: { ...fixture.request.context, resolver: bundledRuleResolver },
    } as unknown as AnalysisSalaryRequest;
    const report = {
      ...fixture.report,
      get views() {
        throw new Error("Native UI must remain unused");
      },
    } as MonthlyRustDomainReport;
    expect(monthlyRustSalaryPreparationResult(input, report)).toEqual(fixture.value);
  });
  it("rejects missing annual data, malformed money and a mismatched settings source", () => {
    const input = {
      ...fixture.request,
      context: { ...fixture.request.context, resolver: bundledRuleResolver },
    } as unknown as AnalysisSalaryRequest;
    const report = fixture.report as unknown as MonthlyRustDomainReport;
    expect(() =>
      monthlyRustSalaryPreparationResult(input, { ...report, salaryForecast: undefined }),
    ).toThrow("RUST_SALARY_ANNUAL_INVALID");
    const bad = structuredClone(fixture.report) as unknown as {
      sections: {
        gross: { value: { legacy: { value: { pay: { estimatedGrossAmount: unknown } } } } };
      };
    };
    bad.sections.gross.value.legacy.value.pay.estimatedGrossAmount = "bad-money";
    expect(() =>
      monthlyRustSalaryPreparationResult(input, bad as unknown as MonthlyRustDomainReport),
    ).toThrow("RUST_SALARY_PROJECTION_INVALID");
    expect(() =>
      monthlyRustSalaryPreparationResult(
        { ...input, settings: input.settings ? { ...input.settings, month: "1900-01" } : null },
        report,
      ),
    ).toThrow("RUST_NET_SETTINGS_MISMATCH");
  });
  it("rejects an unrelated period before consuming any output", () => {
    expect(() =>
      monthlyRustSalaryPreparationResult(request, {
        period: { kind: "MONTH", month: "1900-01" },
        sections: {},
      }),
    ).toThrow("RUST_SALARY_PERIOD_MISMATCH");
  });
});
