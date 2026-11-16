import { describe, expect, it } from "vitest";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { analysisSalaryKey, type AnalysisSalaryRequest } from "./analysis-salary";
import { monthlyRustNetRequest, monthlyRustNetResult } from "./monthly-rust-net";
import type { MonthlyRustNetCalculator } from "./monthly-rust-net";
import type { MonthlyRustDomainReport } from "./monthly-rust-finance";
import fixture from "./monthly-rust-net.fixture.json";

const request = {
  ...fixture.request,
  context: { ...fixture.request.context, resolver: bundledRuleResolver },
} as unknown as AnalysisSalaryRequest;
const report = (value: unknown): MonthlyRustDomainReport => ({
  period: { kind: "MONTH", month: request.month },
  sections: { net: { state: "READY", value } },
});
describe("original net DTO over the existing Rust finance transport", () => {
  it("reads the actual raw net result without native views", () => {
    const input = {
      ...report(fixture.value),
      get views() {
        throw new Error("Native views must not be consumed");
      },
    };
    expect(monthlyRustNetResult(request, input)).toBe(fixture.value);
  });
  it("rejects another month, another settings source and malformed money", () => {
    expect(() =>
      monthlyRustNetResult(request, {
        ...report(fixture.value),
        period: { kind: "MONTH", month: "2025-01" },
      }),
    ).toThrow("RUST_NET_PERIOD_MISMATCH");
    expect(() =>
      monthlyRustNetResult(request, report({ ...fixture.value, sourceMonth: "1900-01" })),
    ).toThrow("RUST_NET_SETTINGS_MISMATCH");
    const bad = structuredClone(fixture.value) as unknown as {
      result: { pay: { netCents: unknown } };
    };
    bad.result.pay.netCents = "not-money";
    expect(() => monthlyRustNetResult(request, report(bad))).toThrow("RUST_NET_OUTPUT_INVALID");
  });
  it("preserves an unavailable result and never invents a zero amount", () => {
    const unavailable = {
      sourceMonth: request.settings!.month,
      result: {
        status: "unavailable",
        stage: "net-pay",
        reason: "Dieser Abrechnungsfall ist noch nicht unterstützt.",
      },
    };
    expect(monthlyRustNetResult(request, report(unavailable))).toBe(unavailable);
    expect(monthlyRustNetResult(request, report(unavailable)).result).not.toHaveProperty("pay");
  });
  it("keeps original TS keys and separates engine identities", () => {
    const calculator = (identity: string) =>
      Object.assign(async () => fixture.value, {
        cacheIdentity: identity,
      }) as unknown as MonthlyRustNetCalculator;
    expect(monthlyRustNetRequest(request, null)).toBe(request);
    expect(analysisSalaryKey(monthlyRustNetRequest(request, calculator("one")))).not.toBe(
      analysisSalaryKey(request),
    );
    expect(analysisSalaryKey(monthlyRustNetRequest(request, calculator("one")))).not.toBe(
      analysisSalaryKey(monthlyRustNetRequest(request, calculator("two"))),
    );
  });
});
