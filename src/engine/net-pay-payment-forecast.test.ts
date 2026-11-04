import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { MonthlyNetPaySettings, SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type {
  SalaryPaymentContribution,
  SalaryPaymentGroup,
  SalaryPaymentProjection,
  SalaryPaymentSource,
} from "@/domain/salary-payment";
import { SALARY_PAYMENT_GROUPS } from "@/domain/salary-payment";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { captureEmploymentProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import { projectSalaryPayment } from "./salary-payment";
import { calculateAutomaticNetPayForecast } from "./net-pay-automatic-forecast";
import { calculateTax2026 } from "./net-pay";
import {
  calculateAutomaticPaymentNetPayForecast,
  calculateAutomaticPaymentNetPayForecastSteps,
} from "./net-pay-payment-forecast";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";

const trainingProfile: UserProfile = {
  ...forecastProfile,
  tariff: null,
  nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
};
const toCents = (amount: number) => Math.round(amount * 100);

function source(
  month: string,
  profile = trainingProfile,
  shifts: readonly ShiftEntry[] = [],
  monthlyAllowance = false,
): SalaryPaymentSource {
  const pay = calculateMonthlyPayEstimate(month, shifts, profile, {
    month,
    allowanceStatus: monthlyAllowance ? "ALTERNATING_MONTHLY" : "NONE",
    revision: 1,
    confirmedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  return { month, profile, shifts, pay };
}

function saved(settings: MonthlyNetPaySettings): SavedMonthlyNetPaySettings {
  return { settings, revision: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
}

function contribution(
  claim: SalaryPaymentSource,
  group: SalaryPaymentContribution["group"],
  paymentMonth: string,
): SalaryPaymentContribution {
  const { pay } = claim;
  const monthly = (pay.confirmedAllowance ?? pay.assessment.suggestedAllowance).endsWith(
    "_MONTHLY",
  );
  const amounts: Record<SalaryPaymentContribution["group"], number> = {
    BASE: pay.personalBaseAmount ?? 0,
    CARE_ALLOWANCE: pay.careAllowanceAmount,
    TARIFF_ALLOWANCE: pay.tvoedAllowanceAmount,
    PREMIUMS: pay.timePremiumAmount,
    MONTHLY_ALLOWANCE: monthly ? pay.allowanceAmount : 0,
    HOURLY_ALLOWANCE: monthly ? 0 : pay.allowanceAmount,
    OVERTIME: pay.overtimeAmount,
    SPECIAL_DUTY: pay.specialDutyAmount ?? 0,
  };
  return { group, claimMonth: claim.month, paymentMonth, amountCents: toCents(amounts[group]) };
}

function projection(
  current: SalaryPaymentSource,
  extraSources: readonly SalaryPaymentSource[] = [],
  arrivals: readonly [SalaryPaymentSource, SalaryPaymentGroup][] = [],
  deferred: readonly SalaryPaymentGroup[] = [],
): SalaryPaymentProjection {
  const contributions = (
    [
      "BASE",
      "CARE_ALLOWANCE",
      "TARIFF_ALLOWANCE",
      "PREMIUMS",
      "MONTHLY_ALLOWANCE",
      "HOURLY_ALLOWANCE",
      "OVERTIME",
      "SPECIAL_DUTY",
    ] as const
  ).map((group) =>
    contribution(
      current,
      group,
      deferred.includes(group as SalaryPaymentGroup)
        ? Temporal.PlainYearMonth.from(current.month).add({ months: 1 }).toString()
        : current.month,
    ),
  );
  contributions.push(
    ...arrivals.map(([claim, group]) => contribution(claim, group, current.month)),
  );
  const amount = (groups: readonly SalaryPaymentContribution["group"][]) =>
    contributions
      .filter((line) => line.paymentMonth === current.month && groups.includes(line.group))
      .reduce((total, line) => total + line.amountCents, 0) / 100;
  return {
    perspective: "PAYOUT",
    month: current.month,
    sources: [current, ...extraSources],
    contributions: contributions.filter((line) => line.paymentMonth === current.month),
    outgoingContributions: contributions.filter(
      (line) =>
        line.claimMonth === current.month &&
        line.paymentMonth !== current.month &&
        line.amountCents > 0,
    ),
    issues: [],
    warnings: [],
    available: true,
    pay: {
      ...current.pay,
      timePremiumAmount: amount(["PREMIUMS"]),
      allowanceAmount: amount(["MONTHLY_ALLOWANCE", "HOURLY_ALLOWANCE"]),
      overtimeAmount: amount(["OVERTIME"]),
      specialDutyAmount: amount(["SPECIAL_DUTY"]),
      estimatedGrossAmount: amount([
        "BASE",
        "CARE_ALLOWANCE",
        "TARIFF_ALLOWANCE",
        "PREMIUMS",
        "MONTHLY_ALLOWANCE",
        "HOURLY_ALLOWANCE",
        "OVERTIME",
        "SPECIAL_DUTY",
      ]),
    },
  };
}

function calculate(
  cash: SalaryPaymentProjection,
  settings = automatedSettings("2026-01"),
  timeline: readonly SavedMonthlyNetPaySettings[] = [saved(automatedSettings("2026-01"))],
) {
  return calculateAutomaticPaymentNetPayForecast(
    {
      month: cash.month,
      profile: cash.sources[0].profile,
      settings,
      projection: cash,
      sourceSettings: timeline,
    },
    resolver,
  );
}

function shiftedBundle(claim: SalaryPaymentSource, current: SalaryPaymentSource, lag: 1 | 2 = 1) {
  return projectSalaryPayment({
    month: current.month,
    perspective: "PAYOUT",
    preferences: {
      version: 1,
      periods: [
        {
          effectiveMonth: "2025-01",
          delays: Object.fromEntries(SALARY_PAYMENT_GROUPS.map((group) => [group, lag])) as Record<
            SalaryPaymentGroup,
            1 | 2
          >,
        },
      ],
      reviewedEmptyMonths: [claim.month],
    },
    source: (month) => {
      if (month === claim.month) return claim;
      if (month === current.month) return current;
      throw new Error(`Unexpected claim month ${month}`);
    },
  });
}

function screenshotMonths() {
  const claim = source(
    "2026-09",
    forecastProfile,
    [
      ["01", "21:04"],
      ["06", "19:00"],
      ["13", "19:00"],
      ["20", "19:57"],
    ].map(([day, startTime], index) =>
      forecastShift({
        id: `sept-${index}`,
        date: `2026-09-${day}`,
        startTime,
        endTime: "06:00",
        breakMinutes: 30,
      }),
    ),
    true,
  );
  const current = source(
    "2026-10",
    forecastProfile,
    [
      ...[
        ["01", "21:00"],
        ["05", "21:00"],
        ["06", "21:00"],
        ["07", "21:00"],
        ["08", "21:00"],
        ["12", "21:00"],
        ["13", "21:17"],
        ["04", "19:00"],
        ["11", "19:46"],
      ].map(([day, startTime], index) =>
        forecastShift({
          id: `oct-${index}`,
          date: `2026-10-${day}`,
          startTime,
          endTime: "06:00",
          breakMinutes: 30,
        }),
      ),
      forecastShift({
        id: "oct-overtime",
        date: "2026-10-29",
        type: "DAY",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30,
        overtimeMinutes: 180,
        tariffOvertimeConfirmed: true,
      }),
    ],
    true,
  );
  return { claim, current, cash: shiftedBundle(claim, current) };
}

function automaticSource(
  month: string,
  alternating: boolean,
  baseProfile = forecastProfile,
): SalaryPaymentSource {
  const profile: UserProfile = {
    ...baseProfile,
    workPattern: {
      workplaceCoverage: "AROUND_THE_CLOCK",
      assignment: "PERMANENT",
    },
  };
  const types = alternating
    ? (["EARLY", "LATE", "NIGHT", "NIGHT", "NIGHT", "EARLY"] as const)
    : (["EARLY", "LATE", "EARLY", "LATE", "NIGHT"] as const);
  const shifts = types.map((type, index) =>
    forecastShift({
      id: `${month}-${index}`,
      date: `${month}-${String(index * 2 + 1).padStart(2, "0")}`,
      type,
      startTime: type === "EARLY" ? "06:00" : type === "LATE" ? "13:00" : "21:00",
      endTime: type === "EARLY" ? "14:00" : type === "LATE" ? "21:00" : "07:00",
      breakMinutes: 30,
    }),
  );
  shifts.push(
    forecastShift({
      id: `${month}-standby`,
      date: `${month}-09`,
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 30,
      specialDuty: {
        ...newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
        version: 2,
        standbyLevel: "II",
        settlement: "PAY",
        standbyAgreement: {
          ...newStandbyAgreement("TVOED_K"),
          rule: "STANDARD",
          sequence: 1,
          payGroup: "KR_VI",
        },
      },
    }),
    forecastShift({
      id: `${month}-on-call`,
      date: `${month}-08`,
      startTime: "16:00",
      endTime: "20:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "16:00", "20:00", "Europe/Berlin"),
        settlement: "PAY",
        calloutsComplete: true,
        callouts: [
          {
            kind: "REMOTE",
            start: 1020,
            end: 1120,
            departure: 1020,
            returned: 1120,
            breakMinutes: 0,
          },
        ],
      },
    }),
  );
  return { month, profile, shifts, pay: calculateMonthlyPayEstimate(month, shifts, profile, null) };
}

describe("source-period adjustment estimate for one complete shifted bundle", () => {
  it.each([0, 1, 2] as const)(
    "calculates readiness net at payment lag %i with the actual source proof",
    (lag) => {
      const shift = forecastShift({
        id: "standby-july",
        date: "2026-07-07",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        specialDuty: {
          ...newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin"),
          version: 2,
          standbyLevel: "II",
          settlement: "PAY",
          standbyAgreement: {
            ...newStandbyAgreement("TVOED_K"),
            rule: "STANDARD",
            sequence: 1,
            payGroup: "KR_VI",
          },
        },
      });
      const claim = source("2026-07", forecastProfile, [shift]);
      const month = Temporal.PlainYearMonth.from(claim.month).add({ months: lag }).toString();
      const current = source(month, forecastProfile);
      const cash = lag === 0 ? projection(claim) : shiftedBundle(claim, current, lag);
      const settings = automatedSettings("2026-01");
      const original = calculate(projection(claim), settings, [saved(settings)]);
      const result = calculate(cash, settings, [saved(settings)]);
      expect(claim.pay.specialDutyAmount).toBeGreaterThan(0);
      expect(claim.pay.timePremiumAmount).toBe(0);
      expect(cash.pay.specialDutyAmount).toBe(claim.pay.specialDutyAmount);
      expect(result.result).toMatchObject({ status: "available" });
      if (result.result.status !== "available" || original.result.status !== "available")
        throw new Error("Readiness net unavailable");
      expect(result.result.pay.netCents).toBe(original.result.pay.netCents);
      expect(result.result.pay.amounts.grossCents).toBe(toCents(cash.pay.estimatedGrossAmount!));
      expect(result.result.pay.netCents).toBe(
        result.result.pay.amounts.grossCents -
          result.result.pay.tax.totalCents -
          result.result.pay.socialInsurance.totalCents -
          (result.result.pay.pension?.employeeCents ?? 0),
      );
    },
  );
  it("calculates the exact P8 screenshot cash gross and estimates its net from original September evidence", () => {
    const { claim, current, cash } = screenshotMonths();
    expect(claim.pay).toMatchObject({
      personalBaseAmount: 4075.58,
      careAllowanceAmount: 141.82,
      tvoedAllowanceAmount: 25,
      timePremiumAmount: 234.63,
      allowanceAmount: 250,
    });
    expect(current.pay.timePremiumAmount).toBe(399.87);
    expect(current.pay.overtimeAmount).toBeGreaterThan(0);
    expect(cash.pay.estimatedGrossAmount).toBe(4727.03);
    const settings = automatedSettings("2026-01");
    const actual = calculate(cash, settings);
    expect(actual.result.status).toBe("available");
    if (actual.result.status !== "available") throw new Error(actual.result.reason);
    expect(actual.payrollTimingEstimate).toEqual({
      method: "SOURCE_ADJUSTMENT",
      sourceMonth: "2026-09",
      lag: 1,
    });
    const baseCurrent = calculateAutomaticNetPayForecast(
      { ...source(current.month, forecastProfile), settings },
      resolver,
    );
    const baseSource = calculateAutomaticNetPayForecast(
      { ...source(claim.month, forecastProfile), settings },
      resolver,
    );
    const fullSource = calculateAutomaticNetPayForecast({ ...claim, settings }, resolver);
    if (
      baseCurrent.result.status !== "available" ||
      baseSource.result.status !== "available" ||
      fullSource.result.status !== "available"
    )
      throw new Error("fixture payroll unavailable");
    expect(actual.result.pay.netCents).toBe(
      baseCurrent.result.pay.netCents +
        fullSource.result.pay.netCents -
        baseSource.result.pay.netCents,
    );
    expect(actual.result.pay.amounts.grossCents).toBe(472703);
    expect(actual.result.classification.shifts).toEqual(fullSource.result.classification.shifts);
    expect(
      actual.result.classification.shifts.every((row) => row.shiftId.startsWith("sept-")),
    ).toBe(true);
    expect(Object.isFrozen(actual.result.pay)).toBe(true);
  });

  it("supports the same complete bundle after two months", () => {
    const { claim } = screenshotMonths();
    const current = source("2026-11", forecastProfile, [], true);
    const actual = calculate(shiftedBundle(claim, current, 2));
    expect(actual.result.status).toBe("available");
    expect(actual.payrollTimingEstimate).toMatchObject({ sourceMonth: "2026-09", lag: 2 });
  });

  it("does not include current pending overtime in this month's cash estimate", () => {
    const { claim, current, cash } = screenshotMonths();
    const withoutPending = source(current.month, forecastProfile, [], true);
    const actual = calculate(cash);
    expect(actual.result.status).toBe("available");
    expect(actual.result).toEqual(calculate(shiftedBundle(claim, withoutPending)).result);
  });

  it("requires source-effective net settings and points recovery at that month", () => {
    const { cash } = screenshotMonths();
    const settings = automatedSettings("2026-10");
    expect(calculate(cash, settings, [saved(settings)])).toMatchObject({
      sourceMonth: "2026-10",
      result: { status: "unavailable" },
      recovery: { kind: "net-settings", month: "2026-09" },
    });
  });

  it("counts extra recurring gross and current personal net deductions once", () => {
    const { cash } = screenshotMonths();
    const initial = automatedSettings("2026-01");
    const settings = {
      ...initial,
      automation: {
        ...initial.automation!,
        additionalRecurringGrossCents: 10000,
        additionalNetDeductionCents: 8000,
      },
    };
    const sourceSettings = {
      ...settings,
      automation: { ...settings.automation!, additionalNetDeductionCents: 25000 },
    };
    const actual = calculate(cash, settings, [saved(sourceSettings)]);
    const withoutDeduction = calculate(
      cash,
      { ...settings, automation: { ...settings.automation!, additionalNetDeductionCents: 0 } },
      [saved(sourceSettings)],
    );
    if (actual.result.status !== "available" || withoutDeduction.result.status !== "available")
      throw new Error("forecast unavailable");
    expect(actual.result.pay.amounts.grossCents).toBe(482703);
    expect(actual.result.pay.additionalNetDeductionCents).toBe(8000);
    expect(actual.result.pay.netCents).toBe(withoutDeduction.result.pay.netCents - 8000);
  });

  it("subtracts personal deductions only after the positive bundle increment", () => {
    const { current, cash } = screenshotMonths();
    const initial = automatedSettings("2026-01");
    const base = calculateAutomaticNetPayForecast(
      { ...source(current.month, forecastProfile), settings: initial },
      resolver,
    );
    const ordinary = calculate(cash);
    if (base.result.status !== "available" || ordinary.result.status !== "available")
      throw new Error("fixture payroll unavailable");
    const deduction = base.result.pay.netCents + 1;
    const settings = {
      ...initial,
      automation: { ...initial.automation!, additionalNetDeductionCents: deduction },
    };
    const actual = calculate(cash, settings);
    expect(actual.result.status).toBe("available");
    if (actual.result.status !== "available") throw new Error(actual.result.reason);
    expect(actual.result.pay.netCents).toBe(ordinary.result.pay.netCents - deduction);
    expect(actual.result.pay.netCents).toBeGreaterThan(0);
  });

  it("excludes source annual pay and adds only the current annual increment once", () => {
    const { cash } = screenshotMonths();
    const initial = automatedSettings("2026-01");
    const sourceSettings = {
      ...initial,
      automation: {
        ...initial.automation!,
        annualPayments: [
          {
            revision: 1,
            payoutMonth: "2026-09",
            grossCents: 90000,
            netBasis: { kind: "CONSTANT_PAY" as const },
          },
        ],
      },
    };
    const settings = {
      ...initial,
      automation: {
        ...initial.automation!,
        annualPayments: [
          {
            revision: 1,
            payoutMonth: "2026-10",
            grossCents: 150000,
            netBasis: { kind: "CONSTANT_PAY" as const },
          },
        ],
      },
    };
    const withSourceAnnual = calculate(cash, initial, [saved(sourceSettings)]);
    expect(withSourceAnnual.result).toEqual(calculate(cash).result);
    const actual = calculate(cash, settings, [saved(sourceSettings)]);
    expect(actual.result.status).toBe("available");
    if (actual.result.status !== "available") throw new Error(actual.result.reason);
    expect(actual.result.pay.amounts.grossCents).toBe(622703);
    expect(actual.annualPayment).toMatchObject({ grossCents: 150000, netIncluded: true });
  });

  it("keeps an annual payment with missing yearly basis out of net without guessing it", () => {
    const { cash } = screenshotMonths();
    const initial = automatedSettings("2026-01");
    const settings = {
      ...initial,
      automation: {
        ...initial.automation!,
        annualPayments: [
          { revision: 1, payoutMonth: "2026-10", grossCents: 150000, netBasis: null },
        ],
      },
    };
    const ordinary = calculate(cash);
    const actual = calculate(cash, settings);
    if (ordinary.result.status !== "available" || actual.result.status !== "available")
      throw new Error("forecast unavailable");
    expect(actual.result.pay.netCents).toBe(ordinary.result.pay.netCents);
    expect(actual.result.pay.amounts.grossCents).toBe(472703);
    expect(actual.annualPayment).toMatchObject({ totalGrossCents: 622703, netIncluded: false });
  });

  it("rejects incomplete uniform bundles instead of treating them as a source adjustment", () => {
    const { cash } = screenshotMonths();
    const incomplete = {
      ...cash,
      contributions: cash.contributions.filter((line) => line.group !== "HOURLY_ALLOWANCE"),
    };
    const actual = calculate(incomplete);
    expect(actual.result.status).toBe("unavailable");
    expect(actual.payrollTimingEstimate).toBeUndefined();
  });

  it("preserves source proof validation rather than forging zero-premium shifts", () => {
    const { claim, current } = screenshotMonths();
    const invalid = {
      ...claim,
      shifts: claim.shifts.map((shift, index) =>
        index ? shift : { ...shift, startTime: "22:00" },
      ),
    };
    expect(calculate(shiftedBundle(invalid, current)).result.status).toBe("unavailable");
  });

  it("estimates a delayed monthly allowance even when the current month has no claim", () => {
    const { claim } = screenshotMonths();
    const current = source("2026-10", forecastProfile);
    const result = calculate(shiftedBundle(claim, current));
    expect(result.result.status).toBe("available");
    expect(result.recovery).toBeUndefined();
    const original = calculate(projection(claim));
    if (result.result.status !== "available" || original.result.status !== "available")
      throw new Error("Delayed monthly claim unavailable");
    expect(result.result.pay.netCents).toBe(original.result.pay.netCents);
    expect(result.result.pay.socialInsurance).toEqual(original.result.pay.socialInsurance);
  });

  it.each([
    [1, false],
    [2, false],
    [1, true],
    [2, true],
  ] as const)(
    "calculates different automatic monthly claims, standby and on-call without confirmation (lag %i, reverse %s)",
    (lag, reverse) => {
      const month = Temporal.PlainYearMonth.from("2026-07").add({ months: lag }).toString();
      const claim = automaticSource("2026-07", reverse);
      const current = automaticSource(month, !reverse);
      expect(claim.pay.confirmedAllowance).toBeNull();
      expect(current.pay.confirmedAllowance).toBeNull();
      expect(claim.pay.assessment.suggestedAllowance).toBe(
        reverse ? "ALTERNATING_MONTHLY" : "SHIFT_MONTHLY",
      );
      expect(current.pay.assessment.suggestedAllowance).toBe(
        reverse ? "SHIFT_MONTHLY" : "ALTERNATING_MONTHLY",
      );
      expect(claim.pay.allowanceAmount).toBe(reverse ? 250 : 100);
      expect(current.pay.allowanceAmount).toBe(reverse ? 100 : 250);
      expect(claim.pay.specialDutyBreakdowns?.map((line) => line.shiftId).sort()).toEqual([
        "2026-07-on-call",
        "2026-07-standby",
      ]);
      expect(claim.pay.specialDutyAmount).toBeGreaterThan(0);
      const result = calculate(shiftedBundle(claim, current, lag));
      const original = calculate(projection(claim));
      expect(result.recovery).toBeUndefined();
      if (result.result.status !== "available" || original.result.status !== "available")
        throw new Error(
          JSON.stringify({
            actual: result.result.status === "unavailable" ? result.result.reason : "available",
            original:
              original.result.status === "unavailable" ? original.result.reason : "available",
          }),
        );
      expect(result.result.pay.netCents).toBe(original.result.pay.netCents);
      expect(result.result.pay.tax).toEqual(original.result.pay.tax);
      expect(result.result.pay.socialInsurance).toEqual(original.result.pay.socialInsurance);
      expect(result.result.pay.pension).toEqual(original.result.pay.pension);
      expect(result.result.classification.shifts).toEqual(original.result.classification.shifts);
      expect(result.basicHourlyPayCents).toBe(original.basicHourlyPayCents);
      expect(result.result.pay.amounts.grossCents).toBe(toCents(claim.pay.estimatedGrossAmount!));
      expect(result.regularGrossCents).toBe(424240 + (reverse ? 10000 : 25000));
      expect(result.payrollTimingEstimate).toMatchObject({ sourceMonth: "2026-07", lag });
      expect(claim.pay.confirmedAllowance).toBeNull();
      expect(current.pay.confirmedAllowance).toBeNull();
    },
  );

  it.each(["VBL_WEST", "VBL_EAST", "ZVK_DARMSTADT_I", "ZVK_DARMSTADT_II"] as const)(
    "preserves source pension and contribution caps with different automatic claims (%s)",
    (pensionScheme) => {
      const highProfile: UserProfile = {
        ...forecastProfile,
        tariff: { ...forecastProfile.tariff!, payGroup: "P16", payLevel: 6 },
      };
      const claim = automaticSource("2026-07", false, highProfile);
      const current = automaticSource("2026-08", true, highProfile);
      const initial = automatedSettings("2026-01");
      const settings = {
        ...initial,
        automation: {
          ...initial.automation!,
          pensionScheme,
          additionalRecurringGrossCents: 106000,
        },
      };
      const actual = calculate(shiftedBundle(claim, current), settings, [saved(settings)]);
      const original = calculate(projection(claim), settings, [saved(settings)]);
      if (actual.result.status !== "available" || original.result.status !== "available")
        throw new Error("High salary supplementary-pension fixture unavailable");
      expect(actual.result.pay.netCents).toBe(original.result.pay.netCents);
      expect(actual.result.pay.pension).toEqual(original.result.pay.pension);
      expect(actual.result.pay.tax).toEqual(original.result.pay.tax);
      expect(actual.result.pay.socialInsurance).toEqual(original.result.pay.socialInsurance);
      expect(actual.result.pay.socialInsurance.healthBasisCents).toBe(581250);
      expect(actual.result.pay.socialInsurance.pensionBasisCents).toBe(845000);
      expect(actual.result.pay.pension?.employeeCents).toBeGreaterThan(0);
    },
  );

  it.each([1, 2] as const)(
    "calculates readiness net independently of a different pending monthly claim at lag %i",
    (lag) => {
      const shift = forecastShift({
        id: "readiness-july",
        date: "2026-07-07",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        specialDuty: {
          ...newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin"),
          version: 2,
          standbyLevel: "II",
          settlement: "PAY",
          standbyAgreement: {
            ...newStandbyAgreement("TVOED_K"),
            rule: "STANDARD",
            sequence: 1,
            payGroup: "KR_VI",
          },
        },
      });
      const month = Temporal.PlainYearMonth.from("2026-07").add({ months: lag }).toString();
      const initialClaim = source("2026-07", forecastProfile, [shift]);
      const initialCurrent = source(month, forecastProfile, [], true);
      expect(calculate(shiftedBundle(initialClaim, initialCurrent, lag)).result.status).toBe(
        "available",
      );
      for (const monthly of [false, true]) {
        const claim = source("2026-07", forecastProfile, [shift], monthly);
        const current = source(month, forecastProfile, [], monthly);
        const settings = automatedSettings("2026-01");
        const result = calculate(shiftedBundle(claim, current, lag), settings, [saved(settings)]);
        const original = calculate(projection(claim), settings, [saved(settings)]);
        expect(result.recovery).toBeUndefined();
        if (result.result.status !== "available" || original.result.status !== "available")
          throw new Error("Matched readiness claim net unavailable");
        expect(result.result.pay.netCents).toBe(original.result.pay.netCents);
        expect(result.result.pay.amounts.grossCents).toBe(toCents(claim.pay.estimatedGrossAmount!));
      }
    },
  );

  it.each([
    { healthAdditionalRateBps: 350 },
    { taxClass: 3 as const, churchTaxRatePercent: 9 as const },
    { isParent: true, childrenUnder25: 2, childAllowanceHalfUnits: 2 },
  ])("uses each month's own tax/SV profile after a change: %j", (changes) => {
    const { claim, current, cash } = screenshotMonths();
    const previous = automatedSettings("2026-01");
    const settings = {
      ...previous,
      month: current.month,
      profile: { ...previous.profile, ...changes },
    };
    const actual = calculate(cash, settings, [saved(previous), saved(settings)]);
    const currentBase = calculateAutomaticNetPayForecast(
      { ...source(current.month, forecastProfile), settings },
      resolver,
    );
    const sourceBase = calculateAutomaticNetPayForecast(
      { ...source(claim.month, forecastProfile), settings: previous },
      resolver,
    );
    const sourceFull = calculateAutomaticNetPayForecast({ ...claim, settings: previous }, resolver);
    if (
      actual.result.status !== "available" ||
      currentBase.result.status !== "available" ||
      sourceBase.result.status !== "available" ||
      sourceFull.result.status !== "available"
    )
      throw new Error("changed monthly payroll must remain available");
    expect(actual.result.pay.netCents).toBe(
      currentBase.result.pay.netCents +
        sourceFull.result.pay.netCents -
        sourceBase.result.pay.netCents,
    );
    expect(actual.result.pay.tax.totalCents).toBe(
      currentBase.result.pay.tax.totalCents +
        sourceFull.result.pay.tax.totalCents -
        sourceBase.result.pay.tax.totalCents,
    );
    expect(actual.result.classification.shifts).toEqual(sourceFull.result.classification.shifts);
  });

  it("attributes the dated childless PV change to the correct month", () => {
    const { cash } = screenshotMonths();
    const initial = automatedSettings("2026-01");
    const settings = { ...initial, profile: { ...initial.profile, birthDate: "2003-09-15" } };
    expect(calculate(cash, settings, [saved(settings)]).result).toMatchObject({
      status: "available",
    });
  });

  it.each([1, 2] as const)(
    "supports employment, regular pay and pension changes at lag %s",
    (lag) => {
      const { claim } = screenshotMonths();
      const month = lag === 1 ? "2026-10" : "2026-11";
      const profile = { ...forecastProfile, weeklyMinutes: 1800 };
      const current = source(month, profile);
      const previous = automatedSettings("2026-01");
      const settings = {
        ...previous,
        month,
        automation: {
          ...previous.automation!,
          additionalRecurringGrossCents: 12000,
          pensionScheme: "VBL_WEST" as const,
          additionalNetDeductionCents: 8000,
        },
      };
      const actual = calculate(shiftedBundle(claim, current, lag), settings, [
        saved(previous),
        saved(settings),
      ]);
      expect(actual.result.status).toBe("available");
      if (actual.result.status !== "available") throw new Error(actual.result.reason);
      const baseSettings = {
        ...settings,
        automation: { ...settings.automation!, additionalNetDeductionCents: 0 },
      };
      const base = calculateAutomaticNetPayForecast(
        { ...current, settings: baseSettings },
        resolver,
      );
      const full = calculateAutomaticNetPayForecast({ ...claim, settings: previous }, resolver);
      const oldBase = calculateAutomaticNetPayForecast(
        { ...source(claim.month, forecastProfile), settings: previous },
        resolver,
      );
      if (
        base.result.status !== "available" ||
        full.result.status !== "available" ||
        oldBase.result.status !== "available"
      )
        throw new Error("fixture payroll unavailable");
      expect(actual.result.pay.netCents).toBe(
        base.result.pay.netCents + full.result.pay.netCents - oldBase.result.pay.netCents - 8000,
      );
      expect(actual.result.pay.additionalNetDeductionCents).toBe(8000);
      expect(actual.result.pay.pension!.employeeCents).toBe(base.result.pay.pension!.employeeCents);
    },
  );

  it("retains source supplementary-pension deductions after the scheme ends", () => {
    const { cash } = screenshotMonths();
    const initial = automatedSettings("2026-01");
    const previous = {
      ...initial,
      automation: { ...initial.automation!, pensionScheme: "VBL_WEST" as const },
    };
    const actual = calculate(cash, initial, [saved(previous)]);
    if (actual.result.status !== "available") throw new Error(actual.result.reason);
    expect(actual.result.pay.pension).toMatchObject({
      scheme: "VBL_WEST",
      employeeCents: expect.any(Number),
    });
    expect(actual.result.pay.pension!.employeeCents).toBeGreaterThan(0);
    expect(actual.result.pay.netCents).toBe(
      actual.result.pay.amounts.grossCents -
        actual.result.pay.tax.totalCents -
        actual.result.pay.socialInsurance.totalCents -
        actual.result.pay.pension!.employeeCents,
    );
  });

  it("keeps partial employment changes unsupported", () => {
    const { claim, current } = screenshotMonths();
    const changed = {
      ...forecastProfile,
      employmentTimeline: [
        [null, forecastProfile],
        ["2026-09-15", { ...forecastProfile, weeklyMinutes: 1800 }],
      ].map(([effectiveFrom, profile], index) => ({
        effectiveFrom: effectiveFrom as string | null,
        data: remunerationDataFromLegacy(profile as UserProfile),
        employment: captureEmploymentProfile(profile as UserProfile),
        revision: index + 1,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      })),
    };
    const invalid = { ...claim, profile: changed };
    expect(calculate(shiftedBundle(invalid, current)).result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Beschäftigungsänderungen"),
    });
  });

  it.each([
    ["2026-12", "2027-01", 1],
    ["2026-11", "2027-01", 2],
    ["2026-12", "2027-02", 2],
  ] as const)(
    "estimates %s supplements paid in %s as prior-year arrears",
    (claimMonth, month, lag) => {
      const claim = source(
        claimMonth,
        forecastProfile,
        [forecastShift({ date: `${claimMonth}-06` })],
        true,
      );
      const current = source(month, forecastProfile, [], true);
      const settings = automatedSettings("2026-01");
      const actual = calculate(shiftedBundle(claim, current, lag), settings);
      if (actual.result.status !== "available") throw new Error(actual.result.reason);
      const base = calculateAutomaticNetPayForecast(
        { ...source(month, forecastProfile), settings },
        resolver,
      );
      const regular = calculateAutomaticNetPayForecast({ ...current, settings }, resolver);
      const full = calculateAutomaticNetPayForecast({ ...claim, settings }, resolver);
      const oldBase = calculateAutomaticNetPayForecast(
        { ...source(claimMonth, forecastProfile), settings },
        resolver,
      );
      if (
        base.result.status !== "available" ||
        regular.result.status !== "available" ||
        full.result.status !== "available" ||
        oldBase.result.status !== "available"
      )
        throw new Error("fixture payroll unavailable");
      const priorYearTaxable =
        full.result.pay.amounts.taxableGrossCents - oldBase.result.pay.amounts.taxableGrossCents;
      const annualTaxableGrossCents = regular.result.pay.amounts.taxableGrossCents * 12;
      expect(actual.result.pay.tax).toEqual(
        calculateTax2026(base.result.pay.amounts.taxableGrossCents, settings.profile, true, {
          grossCents: priorYearTaxable,
          annualTaxableGrossCents,
        }),
      );
      expect(actual.result.pay.socialInsurance.totalCents).toBe(
        base.result.pay.socialInsurance.totalCents +
          full.result.pay.socialInsurance.totalCents -
          oldBase.result.pay.socialInsurance.totalCents,
      );
      expect(actual.result.pay.calculationBasis).toMatchObject({
        payrollYear: 2027,
        status: "PREVIOUS_YEAR_ESTIMATE",
      });
      expect(actual.result.classification.calculationBasis).toEqual(
        actual.result.pay.calculationBasis,
      );
      expect(actual.payrollTimingEstimate?.crossYearTaxEstimate).toEqual({
        assumedPayment: "MONTH_END",
        annualTaxableGrossCents,
        annualBasis: "CURRENT_REGULAR_PAY",
      });
      expect(actual.result.pay.netCents).toBe(
        actual.result.pay.amounts.grossCents -
          actual.result.pay.tax.totalCents -
          actual.result.pay.socialInsurance.totalCents -
          (actual.result.pay.pension?.employeeCents ?? 0),
      );
    },
  );

  it.each([false, true])(
    "combines prior-year arrears and a current annual payment once (payroll annual basis: %s)",
    (explicit) => {
      const claim = source("2026-12", forecastProfile, [], true);
      const current = source("2027-01", { ...forecastProfile, weeklyMinutes: 1800 });
      const previous = automatedSettings("2026-01");
      const regular = calculateAutomaticNetPayForecast(
        { ...current, settings: previous },
        resolver,
      );
      if (regular.result.status !== "available") throw new Error("fixture unavailable");
      const annualTaxableGrossCents = explicit
        ? 5_000_000
        : regular.result.pay.amounts.taxableGrossCents * 12;
      const payment = {
        revision: 1,
        payoutMonth: current.month,
        grossCents: 60000,
        netBasis: explicit
          ? {
              kind: "PAYROLL" as const,
              annualTaxableGrossCents,
              socialInsuranceDays: 30,
              healthAssessedCents: regular.result.pay.socialInsurance.healthBasisCents + 25000,
              pensionAssessedCents: regular.result.pay.socialInsurance.pensionBasisCents + 25000,
            }
          : { kind: "CONSTANT_PAY" as const },
      };
      const settings = {
        ...previous,
        month: current.month,
        automation: {
          ...previous.automation!,
          annualPayments: [payment],
          additionalNetDeductionCents: 5000,
        },
      };
      const actual = calculate(shiftedBundle(claim, current), settings, [saved(previous)]);
      if (actual.result.status !== "available") throw new Error(actual.result.reason);
      expect(actual.annualPayment).toMatchObject({ grossCents: 60000, netIncluded: true });
      expect(actual.result.pay.tax).toEqual(
        calculateTax2026(regular.result.pay.amounts.taxableGrossCents, settings.profile, true, {
          grossCents: 85000,
          annualTaxableGrossCents,
        }),
      );
      expect(actual.result.pay.amounts.grossCents).toBe(
        toCents(current.pay.estimatedGrossAmount!) + 85000,
      );
      expect(actual.result.pay.additionalNetDeductionCents).toBe(5000);
      expect(actual.result.pay.netCents).toBe(
        actual.result.pay.amounts.grossCents -
          actual.result.pay.tax.totalCents -
          actual.result.pay.socialInsurance.totalCents -
          5000,
      );
      expect(actual.payrollTimingEstimate?.crossYearTaxEstimate?.annualBasis).toBe(
        explicit ? "PAYROLL" : "CURRENT_REGULAR_PAY",
      );
    },
  );

  it("uses the original SV cap when pay falls between service and payout months", () => {
    const highProfile = {
      ...forecastProfile,
      tariff: { ...forecastProfile.tariff!, payGroup: "P16" as const, payLevel: 6 as const },
    };
    const lowProfile = { ...forecastProfile, weeklyMinutes: 1800 };
    const claim = source("2026-09", highProfile, [], true);
    const current = source("2026-10", lowProfile);
    const settings = automatedSettings("2026-01");
    const actual = calculate(shiftedBundle(claim, current), settings);
    const full = calculateAutomaticNetPayForecast({ ...claim, settings }, resolver);
    const base = calculateAutomaticNetPayForecast(
      { ...source(claim.month, highProfile), settings },
      resolver,
    );
    const currentBase = calculateAutomaticNetPayForecast({ ...current, settings }, resolver);
    if (
      actual.result.status !== "available" ||
      full.result.status !== "available" ||
      base.result.status !== "available" ||
      currentBase.result.status !== "available"
    )
      throw new Error("capped payroll fixture unavailable");
    expect(full.result.pay.socialInsurance.healthBasisCents).toBe(
      base.result.pay.socialInsurance.healthBasisCents,
    );
    expect(actual.result.pay.socialInsurance.healthCents).toBe(
      currentBase.result.pay.socialInsurance.healthCents,
    );
  });
});

describe("payment-month automatic net forecast", () => {
  it.each([forecastProfile, trainingProfile])(
    "preserves the earned forecast when every payment is in its claim month",
    (profile) => {
      const current = source("2026-07", profile, [forecastShift()]);
      const settings = automatedSettings("2026-01");
      expect(calculate(projection(current), settings, [])).toEqual(
        calculateAutomaticNetPayForecast({ ...current, settings }, resolver),
      );
    },
  );

  it("classifies incoming tax/SV-free premiums on their original dates and taxes cash only once", () => {
    const claim = source("2026-06", trainingProfile, [
      forecastShift({ id: "june-night", date: "2026-06-07" }),
    ]);
    const current = source("2026-08");
    const earned = calculateAutomaticNetPayForecast(
      { ...claim, settings: automatedSettings("2026-01") },
      resolver,
    );
    const base = calculate(projection(current));
    const actual = calculate(projection(current, [claim], [[claim, "PREMIUMS"]]));
    expect(actual.result.status).toBe("available");
    if (
      actual.result.status !== "available" ||
      earned.result.status !== "available" ||
      base.result.status !== "available"
    )
      throw new Error("forecast unavailable");
    expect(actual.result.classification.shifts).toEqual(earned.result.classification.shifts);
    expect(Object.isFrozen(actual.result.classification)).toBe(true);
    expect(Object.isFrozen(actual.result.classification.amounts)).toBe(true);
    expect(Object.isFrozen(actual.result.classification.shifts)).toBe(true);
    expect(actual.result.classification.taxFreeCents).toBe(toCents(claim.pay.timePremiumAmount));
    expect(actual.result.pay.netCents).toBe(
      base.result.pay.netCents + toCents(claim.pay.timePremiumAmount),
    );
    expect(actual.result.pay.amounts.grossCents).toBe(
      toCents(current.pay.estimatedGrossAmount! + claim.pay.timePremiumAmount),
    );
  });

  it("uses cash tax settings while retaining the historical premium basis", () => {
    const claim = source("2026-06", trainingProfile, [forecastShift({ date: "2026-06-07" })]);
    const current = source("2026-07");
    const initial = automatedSettings("2026-07");
    const cashSettings = { ...initial, profile: { ...initial.profile, taxClass: 3 as const } };
    const actual = calculate(projection(current, [claim], [[claim, "PREMIUMS"]]), cashSettings);
    const base = calculate(projection(current), cashSettings);
    expect(actual.sourceMonth).toBe("2026-07");
    if (actual.result.status !== "available" || base.result.status !== "available")
      throw new Error("forecast unavailable");
    expect(actual.result.pay.netCents).toBe(
      base.result.pay.netCents + toCents(claim.pay.timePremiumAmount),
    );
  });

  it("combines one- and two-month premium arrivals without merging their evidence", () => {
    const first = source("2026-05", trainingProfile, [
      forecastShift({ id: "may", date: "2026-05-03" }),
    ]);
    const second = source("2026-06", trainingProfile, [
      forecastShift({ id: "june", date: "2026-06-07" }),
    ]);
    const current = source("2026-07");
    const actual = calculate(
      projection(
        current,
        [first, second],
        [
          [first, "PREMIUMS"],
          [second, "PREMIUMS"],
        ],
      ),
    );
    const base = calculate(projection(current));
    if (actual.result.status !== "available" || base.result.status !== "available")
      throw new Error("forecast unavailable");
    expect(actual.result.classification.shifts.map((row) => row.shiftId)).toEqual(["may", "june"]);
    expect(actual.result.pay.netCents).toBe(
      base.result.pay.netCents +
        toCents(first.pay.timePremiumAmount + second.pay.timePremiumAmount),
    );
  });

  it("supports the confirmed cash SV method when original SFN hourly pay exceeds the SV cap", () => {
    const profile: UserProfile = {
      ...forecastProfile,
      tariff: { ...forecastProfile.tariff!, payGroup: "P16", payLevel: 6 },
    };
    const claim = source("2026-06", profile, [forecastShift({ date: "2026-06-07" })]);
    const current = source("2026-07", profile);
    const cash = projection(current, [claim], [[claim, "PREMIUMS"]]);
    const settings = automatedSettings("2026-01");
    const actual = calculateAutomaticPaymentNetPayForecast(
      {
        month: cash.month,
        profile,
        settings,
        projection: cash,
        sourceSettings: [saved(settings)],
        socialInsuranceAttribution: "CASH_VARIABLE",
      },
      resolver,
    );
    if (actual.result.status !== "available") throw new Error(actual.result.reason);
    expect(actual.result.classification.socialInsuranceFreeCents).toBeLessThan(
      toCents(claim.pay.timePremiumAmount),
    );
    expect(actual.result.pay.amounts.socialInsuranceGrossCents).toBe(
      toCents(cash.pay.estimatedGrossAmount!) -
        actual.result.classification.socialInsuranceFreeCents,
    );
  });

  it("selects only special-duty proofs when ordinary premiums are paid separately", () => {
    const duty = forecastShift({
      id: "on-call",
      date: "2026-06-07",
      type: "CUSTOM",
      startTime: "20:00",
      endTime: "23:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "20:00", "23:00", "Europe/Berlin"),
        settlement: "PAY",
        calloutsComplete: true,
        callouts: [
          {
            kind: "REMOTE",
            departure: 1320,
            start: 1320,
            end: 1330,
            returned: 1330,
            breakMinutes: 0,
          },
        ],
      },
    });
    const claim = source("2026-06", forecastProfile, [
      duty,
      forecastShift({ id: "ordinary", date: "2026-06-08" }),
    ]);
    const current = source("2026-07", forecastProfile);
    const cash = projection(current, [claim], [[claim, "SPECIAL_DUTY"]]);
    const settings = automatedSettings("2026-01");
    const actual = calculateAutomaticPaymentNetPayForecast(
      {
        month: cash.month,
        profile: forecastProfile,
        settings,
        projection: cash,
        sourceSettings: [saved(settings)],
        socialInsuranceAttribution: "CASH_VARIABLE",
      },
      resolver,
    );
    if (actual.result.status !== "available") throw new Error(actual.result.reason);
    expect(actual.result.classification.shifts).toHaveLength(1);
    expect(actual.result.classification.shifts[0].sourceShiftId).toBe("on-call");
    expect(actual.result.classification.shifts[0].shiftId).not.toBe("ordinary");
  });

  it("does not use a future net setup for older source premiums", () => {
    const claim = source("2026-06", trainingProfile, [forecastShift({ date: "2026-06-07" })]);
    const current = source("2026-07");
    const settings = automatedSettings("2026-07");
    expect(
      calculate(projection(current, [claim], [[claim, "PREMIUMS"]]), settings, [saved(settings)])
        .result,
    ).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("2026-06"),
    });
  });

  it("does not require older net settings for an incoming zero amount", () => {
    const claim = source("2026-06");
    const current = source("2026-07");
    expect(
      calculate(
        projection(current, [claim], [[claim, "PREMIUMS"]]),
        automatedSettings("2026-07"),
        [],
      ).result.status,
    ).toBe("available");
  });

  it("keeps deferred current premiums out of cash gross and net", () => {
    const current = source("2026-07", trainingProfile, [forecastShift()]);
    const empty = source("2026-07");
    const actual = calculate(projection(current, [], [], ["PREMIUMS"]));
    const base = calculate(projection(empty));
    if (actual.result.status !== "available" || base.result.status !== "available")
      throw new Error("forecast unavailable");
    expect(actual.result.pay.netCents).toBe(base.result.pay.netCents);
    expect(actual.result.classification.shifts).toEqual([]);
  });

  it("also requires the SV assignment when current contribution-liable earnings are deferred", () => {
    const current = source("2026-07", trainingProfile, [
      forecastShift({
        type: "EARLY",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        overtimeMinutes: 60,
        tariffOvertimeConfirmed: true,
      }),
    ]);
    const cash = projection(current, [], [], ["OVERTIME"]);
    expect(current.pay.overtimeAmount).toBeGreaterThan(0);
    expect(calculate(cash).result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Sozialversicherung"),
    });
  });

  it("reads current deferred SV-liable earnings from the real payment projection", () => {
    const month = "2026-10";
    const cash = projectSalaryPayment({
      month,
      perspective: "PAYOUT",
      preferences: {
        version: 1,
        periods: [
          {
            effectiveMonth: "2026-01",
            delays: {
              PREMIUMS: 2,
              MONTHLY_ALLOWANCE: 0,
              HOURLY_ALLOWANCE: 2,
              OVERTIME: 2,
              SPECIAL_DUTY: 2,
            },
          },
        ],
        reviewedEmptyMonths: ["2026-08"],
        socialInsuranceAttribution: "UNKNOWN",
      },
      source: (claimMonth) =>
        source(
          claimMonth,
          trainingProfile,
          claimMonth === month
            ? [
                forecastShift({
                  date: "2026-10-06",
                  type: "EARLY",
                  startTime: "06:00",
                  endTime: "14:00",
                  breakMinutes: 30,
                  overtimeMinutes: 60,
                  tariffOvertimeConfirmed: true,
                }),
              ]
            : [],
        ),
    });
    expect(cash.available).toBe(true);
    expect(
      cash.outgoingContributions?.some((line) => line.group === "OVERTIME" && line.amountCents > 0),
    ).toBe(true);
    expect(calculate(cash).result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Sozialversicherung"),
    });
  });

  it("refuses incomplete outgoing metadata rather than assuming no deferred SV-liable claims", () => {
    const current = source("2026-07", trainingProfile, [
      forecastShift({
        type: "EARLY",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        overtimeMinutes: 60,
        tariffOvertimeConfirmed: true,
      }),
    ]);
    const cash = projection(current, [], [], ["OVERTIME"]);
    expect(calculate({ ...cash, outgoingContributions: undefined }).result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("unvollständig"),
    });
  });

  it("keeps current monthly allowances unsupported when deferred to another month", () => {
    const current = source("2026-07", forecastProfile, [], true);
    const cash = projection(current, [], [], ["MONTHLY_ALLOWANCE"]);
    const settings = automatedSettings("2026-01");
    expect(
      calculateAutomaticPaymentNetPayForecast(
        {
          month: cash.month,
          profile: current.profile,
          settings,
          projection: cash,
          sourceSettings: [saved(settings)],
          socialInsuranceAttribution: "CASH_VARIABLE",
        },
        resolver,
      ).result,
    ).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("monatlichen Zulage"),
    });
  });

  it("refuses to move contribution-liable deferred earnings into a different SV period", () => {
    const claim = source("2026-06", trainingProfile, [
      forecastShift({
        date: "2026-06-06",
        type: "EARLY",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        overtimeMinutes: 60,
        tariffOvertimeConfirmed: true,
      }),
    ]);
    expect(claim.pay.overtimeAmount).toBeGreaterThan(0);
    expect(
      calculate(projection(source("2026-07"), [claim], [[claim, "OVERTIME"]])).result,
    ).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Sozialversicherung"),
    });
  });

  it("uses the confirmed cash SV period for regularly delayed variable earnings", () => {
    const claim = source("2026-06", trainingProfile, [
      forecastShift({
        date: "2026-06-06",
        type: "EARLY",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        overtimeMinutes: 60,
        tariffOvertimeConfirmed: true,
      }),
    ]);
    const current = source("2026-07");
    const cash = projection(current, [claim], [[claim, "OVERTIME"]]);
    const settings = automatedSettings("2026-01");
    const actual = calculateAutomaticPaymentNetPayForecast(
      {
        month: cash.month,
        profile: current.profile,
        settings,
        projection: cash,
        sourceSettings: [saved(settings)],
        socialInsuranceAttribution: "CASH_VARIABLE",
      },
      resolver,
    );
    expect(actual.result.status).toBe("available");
    if (actual.result.status !== "available") throw new Error(actual.result.reason);
    expect(actual.result.pay.amounts.socialInsuranceGrossCents).toBe(
      toCents(cash.pay.estimatedGrossAmount!),
    );
  });

  it("does not extend the variable-pay SV simplification to delayed monthly allowances", () => {
    const claim = source("2026-06", forecastProfile, [], true);
    const current = source("2026-07", forecastProfile, [], true);
    const cash = projection(
      current,
      [claim],
      [[claim, "MONTHLY_ALLOWANCE"]],
      ["MONTHLY_ALLOWANCE"],
    );
    const settings = automatedSettings("2026-01");
    expect(claim.pay.allowanceAmount).toBeGreaterThan(0);
    expect(
      calculateAutomaticPaymentNetPayForecast(
        {
          month: cash.month,
          profile: current.profile,
          settings,
          projection: cash,
          sourceSettings: [saved(settings)],
          socialInsuranceAttribution: "CASH_VARIABLE",
        },
        resolver,
      ).result,
    ).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("monatlichen Zulage"),
    });
  });

  it("refuses shifted premiums when regular remuneration or employment changed", () => {
    const claim = source("2026-06", trainingProfile, [forecastShift({ date: "2026-06-07" })]);
    const changed = source("2026-07", { ...trainingProfile, weeklyMinutes: 1800 });
    expect(calculate(projection(changed, [claim], [[claim, "PREMIUMS"]])).result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Beschäftigungs"),
    });
  });

  it("does not invent an SFN basis for an unsupported source year", () => {
    const claim = source("2025-12", trainingProfile, [forecastShift({ date: "2025-12-07" })]);
    const settings = automatedSettings("2025-01");
    expect(
      calculate(
        projection(source("2026-01"), [claim], [[claim, "PREMIUMS"]]),
        automatedSettings("2026-01"),
        [saved(settings)],
      ).result.status,
    ).toBe("unavailable");
  });

  it("adds cash recurring gross and the annual payment once", () => {
    const current = source("2026-11");
    const initial = automatedSettings("2026-01");
    const settings: MonthlyNetPaySettings = {
      ...initial,
      automation: {
        ...initial.automation!,
        additionalRecurringGrossCents: 10000,
        annualPayments: [
          {
            revision: 1,
            payoutMonth: "2026-11",
            grossCents: 150000,
            netBasis: { kind: "CONSTANT_PAY" },
          },
        ],
      },
    };
    const actual = calculate(projection(current), settings);
    if (actual.result.status !== "available") throw new Error(actual.result.reason);
    expect(actual.result.pay.amounts.grossCents).toBe(
      toCents(current.pay.estimatedGrossAmount!) + 160000,
    );
    expect(actual.annualPayment?.grossCents).toBe(150000);
  });

  it("does not calculate a complete forecast for incomplete cash projection", () => {
    const cash = projection(source("2026-07"));
    expect(
      calculate({
        ...cash,
        available: false,
        issues: [{ kind: "MISSING_MONTH", month: "2026-05", message: "Mai prüfen" }],
      }).result,
    ).toMatchObject({ status: "unavailable", reason: "Mai prüfen" });
  });

  it("rejects a contribution total that disagrees with cash gross", () => {
    const cash = projection(source("2026-07"));
    expect(
      calculate({ ...cash, pay: { ...cash.pay, estimatedGrossAmount: 1 } }).result.status,
    ).toBe("unavailable");
  });

  it("keeps synchronous and incremental calculation identical", () => {
    const cash = projection(source("2026-07"));
    const settings = automatedSettings("2026-01");
    const input = {
      month: cash.month,
      profile: cash.sources[0].profile,
      settings,
      projection: cash,
      sourceSettings: [saved(settings)],
    };
    const steps = calculateAutomaticPaymentNetPayForecastSteps(input, resolver);
    let step = steps.next();
    while (!step.done) step = steps.next();
    expect(step.value).toEqual(calculateAutomaticPaymentNetPayForecast(input, resolver));
  });
});
