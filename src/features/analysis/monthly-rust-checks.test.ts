import { describe, expect, it } from "vitest";
import type { MonthlyComplianceResult } from "@/domain/types";
import type { MonthlyRustDomainReport } from "./monthly-rust-finance";
import { monthlyRustChecksKey, monthlyRustChecksResult } from "./monthly-rust-checks";
import type { MonthlyRustChecksCalculator } from "./monthly-rust-checks";

const value: MonthlyComplianceResult = {
  month: "2026-11",
  issues: [],
  affectedDates: [],
  criticalCount: 0,
  warningCount: 0,
  infoCount: 0,
};
const report = (result: unknown = value): MonthlyRustDomainReport => ({
  period: { kind: "MONTH", month: value.month },
  sections: {
    checks: {
      state: "READY",
      value: { month: value.month, compliance: { ok: true, value: result } },
    },
  },
});
describe("monthly Rust checks preserve the original result", () => {
  it("consumes only raw domain sections, never native views", () => {
    const native = {
      ...report(),
      get views() {
        throw new Error("Native UI must stay unused");
      },
    };
    expect(monthlyRustChecksResult(value.month, native)).toBe(value);
  });
  it("rejects other periods, unavailable checks and malformed findings", () => {
    expect(() => monthlyRustChecksResult("2027-01", report())).toThrow(
      "RUST_CHECKS_PERIOD_MISMATCH",
    );
    expect(() => monthlyRustChecksResult(value.month, { ...report(), sections: {} })).toThrow(
      "RUST_CHECKS_UNAVAILABLE",
    );
    expect(() =>
      monthlyRustChecksResult(value.month, report({ ...value, criticalCount: "0" })),
    ).toThrow("RUST_CHECKS_OUTPUT_INVALID");
    expect(() =>
      monthlyRustChecksResult(value.month, report({ ...value, month: "2026-12" })),
    ).toThrow("RUST_CHECKS_OUTPUT_INVALID");
  });
  it("retains existing TS keys and isolates native engine versions", () => {
    const calc = (cacheIdentity: string) =>
      Object.assign(async () => value, { cacheIdentity }) as MonthlyRustChecksCalculator;
    expect(monthlyRustChecksKey("original-key", null)).toBe("original-key");
    expect(monthlyRustChecksKey("original-key", calc("a"))).not.toBe("original-key");
    expect(monthlyRustChecksKey("original-key", calc("a"))).not.toBe(
      monthlyRustChecksKey("original-key", calc("b")),
    );
  });
});
