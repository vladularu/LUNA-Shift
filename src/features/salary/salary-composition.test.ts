import { describe, expect, it } from "vitest";
import type { SalaryPaymentContribution, SalaryPaymentProjection } from "@/domain/salary-payment";
import { salaryPaymentHint, salaryComposition } from "./salary-composition";
import { forecastProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";

const part = (
  group: SalaryPaymentContribution["group"],
  claimMonth: string,
  amountCents = 100,
): SalaryPaymentContribution => ({
  group,
  claimMonth,
  paymentMonth: "2026-10",
  amountCents,
});
const hint = (...contributions: readonly SalaryPaymentContribution[]) =>
  salaryPaymentHint({ month: "2026-10", contributions });

describe("salary origin hint", () => {
  it("leaves the original same-month UI unchanged", () => {
    expect(hint(part("BASE", "2026-10"), part("PREMIUMS", "2026-10"))).toBeNull();
  });
  it.each([
    "PREMIUMS",
    "MONTHLY_ALLOWANCE",
    "HOURLY_ALLOWANCE",
    "OVERTIME",
    "SPECIAL_DUTY",
  ] as const)("names the origin month of delayed %s once", (group) => {
    expect(hint(part(group, "2026-09"), part("BASE", "2026-10"))).toBe(
      "Zulagen aus September 2026",
    );
  });
  it("does not treat fixed monthly pay as a delayed allowance", () => {
    expect(
      hint(
        part("BASE", "2026-09"),
        part("CARE_ALLOWANCE", "2026-09"),
        part("TARIFF_ALLOWANCE", "2026-09"),
      ),
    ).toBeNull();
  });
  it("marks a mixed legacy payout as partly from an older month", () => {
    expect(hint(part("PREMIUMS", "2026-09"), part("MONTHLY_ALLOWANCE", "2026-10"))).toBe(
      "Zulagen teilweise aus September 2026",
    );
  });
  it("does not assign fixed current pay to a delayed zero allowance", () => {
    expect(hint(part("PREMIUMS", "2026-09", 0), part("CARE_ALLOWANCE", "2026-10"))).toBeNull();
  });
  it("does not add a hint for zero amounts with no payment lag", () => {
    expect(hint(part("PREMIUMS", "2026-10", 0))).toBeNull();
  });
  it("does not mark current positive allowances plus a delayed zero source as mixed", () => {
    expect(hint(part("PREMIUMS", "2026-09", 0), part("MONTHLY_ALLOWANCE", "2026-10"))).toBeNull();
  });
  it("does not invent a cash origin for an unconfigured payment rule", () => {
    expect(hint({ ...part("PREMIUMS", "2026-09"), paymentMonth: null })).toBeNull();
  });
  it("identifies missing evidence without claiming that money came from that month", () => {
    expect(
      salaryPaymentHint({
        month: "2026-10",
        contributions: [part("PREMIUMS", "2026-08", 0)],
        issues: [{ kind: "MISSING_MONTH", month: "2026-08", message: "Dienste fehlen" }],
      }),
    ).toBe("Zulagen für August 2026 noch offen");
  });
  it("uses a neutral label for mixed monthly and hourly claim sources", () => {
    const pay = calculateMonthlyPayEstimate("2026-10", [], forecastProfile, null);
    const projection: SalaryPaymentProjection = {
      month: "2026-10",
      perspective: "PAYOUT",
      pay: { ...pay, allowanceAmount: 230 },
      available: true,
      issues: [],
      warnings: [],
      sources: [
        {
          month: "2026-08",
          profile: forecastProfile,
          shifts: [],
          pay: { ...pay, month: "2026-08", confirmedAllowance: "SHIFT_MONTHLY" },
        },
        {
          month: "2026-09",
          profile: forecastProfile,
          shifts: [],
          pay: { ...pay, month: "2026-09", confirmedAllowance: "SHIFT_HOURLY" },
        },
      ],
      contributions: [
        part("MONTHLY_ALLOWANCE", "2026-08", 20000),
        part("HOURLY_ALLOWANCE", "2026-09", 3000),
      ],
    };
    const rows = salaryComposition(forecastProfile, projection.pay, projection).compositionRows;
    expect(rows.find((row) => row.label === "Schichtzulagen")?.value).toBe(
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(230),
    );
    expect(rows.some((row) => row.label === "Ständige Schichtzulage")).toBe(false);
  });
  it("leaves an unresolved source premium blank in the original component row", () => {
    const pay = calculateMonthlyPayEstimate("2026-10", [], forecastProfile, null);
    const projection: SalaryPaymentProjection = {
      month: "2026-10",
      perspective: "PAYOUT",
      pay: { ...pay, available: false, estimatedGrossAmount: null },
      available: false,
      contributions: [part("PREMIUMS", "2026-09", 0)],
      sources: [
        {
          month: "2026-09",
          profile: forecastProfile,
          shifts: [],
          pay: { ...pay, month: "2026-09" },
        },
      ],
      issues: [
        { kind: "MISSING_MONTH", month: "2026-09", group: "PREMIUMS", message: "Dienste fehlen" },
      ],
      warnings: [],
    };
    expect(
      salaryComposition(forecastProfile, projection.pay, projection).compositionRows.find(
        (row) => row.label === "Zeitzuschläge",
      )?.value,
    ).toBe("–");
  });
});
