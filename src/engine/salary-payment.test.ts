import { describe, expect, it, vi } from "vitest";
import type {
  SalaryPaymentGroup,
  SalaryPaymentPreferences,
  SalaryPaymentSource,
} from "@/domain/salary-payment";
import { createManualMonthlyPayEstimate } from "./pay-fallback";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { projectSalaryPayment } from "./salary-payment";

const groups: readonly SalaryPaymentGroup[] = [
  "PREMIUMS",
  "MONTHLY_ALLOWANCE",
  "HOURLY_ALLOWANCE",
  "OVERTIME",
  "SPECIAL_DUTY",
];
function preferences(
  delays: Partial<Record<SalaryPaymentGroup, 0 | 1 | 2 | null>> = {},
): SalaryPaymentPreferences {
  return {
    version: 1,
    periods: [
      {
        effectiveMonth: "2025-01",
        delays: Object.fromEntries(groups.map((group) => [group, delays[group] ?? 0])) as Record<
          SalaryPaymentGroup,
          0 | 1 | 2 | null
        >,
      },
    ],
    reviewedEmptyMonths: [],
  };
}
function source(
  month: string,
  overrides: Partial<SalaryPaymentSource["pay"]> = {},
): SalaryPaymentSource {
  return {
    month,
    profile: forecastProfile,
    shifts: [forecastShift({ id: month, date: `${month}-05` })],
    pay: {
      ...createManualMonthlyPayEstimate(month, 400_000),
      timePremiumAmount: 10,
      allowanceAmount: 20,
      confirmedAllowance: "SHIFT_MONTHLY",
      overtimeAmount: 30,
      specialDutyAmount: 40,
      estimatedGrossAmount: 4100,
      ...overrides,
    },
  };
}

describe("salary payment projection", () => {
  it("preserves the old same-month estimate when no timing preference exists", () => {
    const actual = source("2026-10", {
      confirmedAllowance: null,
      allowanceAmount: 0,
      estimatedGrossAmount: 4080,
    });
    const empty: SalaryPaymentSource = {
      ...actual,
      shifts: [],
      pay: {
        ...actual.pay,
        assessment: {
          ...actual.pay.assessment,
          requiresConfirmation: true,
          criteria: [
            { key: "ASSIGNMENT", label: "Assignment", detail: "Open", state: "OPEN" as const },
          ],
        },
      },
    };
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: { version: 1, periods: [], reviewedEmptyMonths: [] },
      source: () => empty,
    });
    expect(result.available).toBe(true);
    expect(result.pay).toEqual(empty.pay);
    expect(result.issues).toEqual([]);
  });
  it("preserves the earned result with zero delays and keeps the source objects", () => {
    const actual = source("2026-10");
    const load = vi.fn(() => actual);
    const result = projectSalaryPayment({
      month: actual.month,
      perspective: "PAYOUT",
      preferences: preferences(),
      source: load,
    });
    expect(result.pay).toEqual(actual.pay);
    expect(result.sources).toEqual([actual]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.available).toBe(true);
  });

  it("assigns each component by its claim month's policy across a year boundary", () => {
    const result = projectSalaryPayment({
      month: "2027-01",
      perspective: "PAYOUT",
      preferences: preferences({
        PREMIUMS: 2,
        MONTHLY_ALLOWANCE: 1,
        HOURLY_ALLOWANCE: 2,
        OVERTIME: 1,
        SPECIAL_DUTY: 2,
      }),
      source: (month) =>
        source(month, {
          timePremiumAmount: month === "2026-11" ? 11.11 : 99,
          allowanceAmount: month === "2026-12" ? 22.22 : 99,
          overtimeAmount: month === "2026-12" ? 33.33 : 99,
          specialDutyAmount: month === "2026-11" ? 44.44 : 99,
        }),
    });
    expect(result.pay.estimatedGrossAmount).toBe(4111.1);
    expect(result.contributions.find((part) => part.group === "PREMIUMS")).toMatchObject({
      claimMonth: "2026-11",
      paymentMonth: "2027-01",
      amountCents: 1111,
    });
    expect(result.contributions.find((part) => part.group === "MONTHLY_ALLOWANCE")).toMatchObject({
      claimMonth: "2026-12",
      amountCents: 2222,
    });
    expect(result.sources.map((item) => item.month).sort()).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });

  it("includes two claim months when a changed delay makes them land together", () => {
    const prefs = preferences({ PREMIUMS: 2 });
    const next = preferences({ PREMIUMS: 1 }).periods[0];
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: {
        ...prefs,
        periods: [...prefs.periods, { ...next, effectiveMonth: "2026-09" }],
      },
      source: (month) => source(month, { timePremiumAmount: month === "2026-08" ? 12 : 23 }),
    });
    expect(result.pay.timePremiumAmount).toBe(35);
    expect(
      result.contributions
        .filter((part) => part.group === "PREMIUMS")
        .map((part) => part.claimMonth),
    ).toEqual(["2026-08", "2026-09"]);
  });

  it("never treats missing historical shifts as a confirmed zero", () => {
    const prefs = preferences({ PREMIUMS: 1 });
    const load = (month: string) => ({
      ...source(month),
      shifts: month === "2026-09" ? [] : source(month).shifts,
    });
    const missing = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: prefs,
      source: load,
    });
    expect(missing.available).toBe(false);
    expect(missing.pay.estimatedGrossAmount).toBeNull();
    expect(missing.pay.personalBaseAmount).toBe(4000);
    expect(missing.issues).toContainEqual(
      expect.objectContaining({ kind: "MISSING_MONTH", month: "2026-09", group: "PREMIUMS" }),
    );
    const reviewed = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: { ...prefs, reviewedEmptyMonths: ["2026-09"] },
      source: (month) => ({
        ...load(month),
        pay: { ...load(month).pay, timePremiumAmount: month === "2026-09" ? 0 : 10 },
      }),
    });
    expect(reviewed.available).toBe(true);
    expect(reviewed.pay.timePremiumAmount).toBe(0);
  });

  it("accepts a confirmed monthly entitlement without inventing an hourly allowance", () => {
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: preferences({ MONTHLY_ALLOWANCE: 1 }),
      source: (month) => ({
        ...source(month),
        shifts: month === "2026-09" ? [] : source(month).shifts,
      }),
    });
    expect(result.available).toBe(true);
    expect(result.pay.allowanceAmount).toBe(20);
    expect(
      result.contributions
        .filter((part) => part.group === "HOURLY_ALLOWANCE")
        .every((part) => part.amountCents === 0),
    ).toBe(true);
  });

  it("does not let a confirmed NONE decision prove the shift history complete", () => {
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: preferences({ PREMIUMS: 1 }),
      source: (month) => ({
        ...source(month, { confirmedAllowance: "NONE", allowanceAmount: 0 }),
        shifts: [],
      }),
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "MISSING_MONTH", month: "2026-09", group: "PREMIUMS" }),
    );
  });

  it("keeps unavailable source components and their provenance while withholding a total", () => {
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: preferences({ PREMIUMS: 1 }),
      source: (month) => source(month, { available: month !== "2026-09" }),
    });
    expect(result.available).toBe(false);
    expect(result.pay.estimatedGrossAmount).toBeNull();
    expect(result.sources).toHaveLength(2);
    expect(result.contributions).toContainEqual(
      expect.objectContaining({ group: "PREMIUMS", claimMonth: "2026-09", amountCents: 1000 }),
    );
  });

  it("shows earned gross independently of unconfigured payment timing", () => {
    const prefs = preferences();
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "EARNED",
      preferences: {
        ...prefs,
        periods: [
          {
            ...prefs.periods[0],
            delays: {
              PREMIUMS: null,
              MONTHLY_ALLOWANCE: null,
              HOURLY_ALLOWANCE: null,
              OVERTIME: null,
              SPECIAL_DUTY: null,
            },
          },
        ],
      },
      source,
    });
    expect(result.available).toBe(true);
    expect(result.pay.estimatedGrossAmount).toBe(4100);
    expect(result.contributions.find((part) => part.group === "PREMIUMS")?.paymentMonth).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("withholds payout when an earlier claim month's timing is unknown", () => {
    const prefs = preferences();
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: {
        ...prefs,
        periods: [
          {
            ...prefs.periods[0],
            delays: {
              PREMIUMS: null,
              MONTHLY_ALLOWANCE: null,
              HOURLY_ALLOWANCE: null,
              OVERTIME: null,
              SPECIAL_DUTY: null,
            },
          },
          { ...prefs.periods[0], effectiveMonth: "2026-10" },
        ],
      },
      source,
    });
    expect(result.available).toBe(false);
    expect(result.pay.estimatedGrossAmount).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "UNCONFIGURED", month: "2026-09", group: "PREMIUMS" }),
    );
    expect(result.pay.personalBaseAmount).toBe(4000);
  });

  it("does not move a conditional monthly allowance into the hourly group", () => {
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: preferences({ MONTHLY_ALLOWANCE: 1, HOURLY_ALLOWANCE: 2 }),
      source: (month) =>
        source(month, {
          confirmedAllowance: month === "2026-08" ? "SHIFT_HOURLY" : "SHIFT_MONTHLY",
          allowanceAmount: month === "2026-08" ? 3.21 : 20,
        }),
    });
    expect(result.pay.allowanceAmount).toBe(23.21);
    expect(result.contributions).toContainEqual(
      expect.objectContaining({
        group: "HOURLY_ALLOWANCE",
        claimMonth: "2026-08",
        amountCents: 321,
      }),
    );
    expect(result.contributions).toContainEqual(
      expect.objectContaining({
        group: "MONTHLY_ALLOWANCE",
        claimMonth: "2026-09",
        amountCents: 2000,
      }),
    );
  });

  it("removes current special-duty details when that duty is paid in a later month", () => {
    const current = source("2026-10", {
      specialDutyBreakdowns: [
        {
          shiftId: "cash-duty",
          date: "2026-10-04",
          title: "Duty",
          source: null,
          durationMinutes: 480,
          paidHours: 8,
          hourlyCents: 5000,
          baseAmountCents: 40_000,
          complete: true,
          notes: [],
        },
      ],
      specialDutyNotes: ["current duty note"],
    });
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: preferences({ SPECIAL_DUTY: 1 }),
      source: (month) => (month === current.month ? current : source(month)),
    });
    expect(result.pay.specialDutyBreakdowns).toEqual([]);
    expect(result.pay.specialDutyNotes).toEqual([]);
    expect(
      result.sources.find((item) => item.month === current.month)?.pay.specialDutyBreakdowns?.[0]
        .shiftId,
    ).toBe("cash-duty");
  });

  it("exposes outgoing current claims separately without adding them to cash gross", () => {
    const prefs = preferences({ PREMIUMS: 2, OVERTIME: 2 });
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: prefs,
      source: (month) =>
        source(month, {
          timePremiumAmount: month === "2026-10" ? 75 : 0,
          overtimeAmount: month === "2026-10" ? 125 : 0,
        }),
    });
    expect(result.outgoingContributions).toEqual([
      { group: "PREMIUMS", claimMonth: "2026-10", paymentMonth: "2026-12", amountCents: 7500 },
      { group: "OVERTIME", claimMonth: "2026-10", paymentMonth: "2026-12", amountCents: 12500 },
    ]);
    expect(
      result.contributions.some(
        (part) => part.claimMonth === "2026-10" && part.group === "PREMIUMS",
      ),
    ).toBe(false);
    expect(result.pay.timePremiumAmount).toBe(0);
    expect(result.pay.overtimeAmount).toBe(0);
    expect(result.pay.estimatedGrossAmount).toBe(4060);
  });

  it("retains an unresolved outgoing claim while blocking its unknown payment month", () => {
    const prefs = preferences();
    const result = projectSalaryPayment({
      month: "2026-10",
      perspective: "PAYOUT",
      preferences: {
        ...prefs,
        periods: [{ ...prefs.periods[0], delays: { ...prefs.periods[0].delays, PREMIUMS: null } }],
      },
      source,
    });
    expect(result.outgoingContributions).toContainEqual({
      group: "PREMIUMS",
      claimMonth: "2026-10",
      paymentMonth: null,
      amountCents: 1000,
    });
    expect(result.available).toBe(false);
    expect(result.pay.estimatedGrossAmount).toBeNull();
  });
});
