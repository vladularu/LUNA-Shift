import { describe, expect, it } from "vitest";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { incompleteSpecialDuties } from "@/domain/special-duty-review";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES, setSalaryPaymentLag } from "@/domain/salary-payment";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import {
  calculateMonthlyPayEstimate,
  DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
} from "@/engine/simple-pay";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { salaryPaymentInput } from "./salary-payment-input";
import { annualSalaryProposalResultSteps } from "./annual-salary-proposal";

const tvl: UserProfile = {
  ...forecastProfile,
  tariff: null,
  tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
};
const oldDuty = {
  ...newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
  version: 2 as const,
  standbyLevel: "II" as const,
  settlement: "PAY" as const,
  standbyAgreement: { ...newStandbyAgreement("TVOED_K"), rule: "STANDARD" as const, sequence: 1 },
};
const fixedDuty = {
  ...oldDuty,
  standbyLevel: "B" as const,
  standbyAgreement: {
    ...newStandbyAgreement("TVL_43"),
    rule: "STANDARD" as const,
    sequence: 1,
    payGroup: "KR_VII",
  },
};
const standby = forecastShift({
  id: "standby-july",
  date: "2026-07-07",
  type: "CUSTOM",
  title: "Bereitschaft",
  startTime: "08:00",
  endTime: "16:00",
  breakMinutes: 0,
  specialDuty: oldDuty,
});
const context = (entries: readonly ShiftEntry[]) => ({
  entries,
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  resolver,
});

describe("recoverable special-duty billing", () => {
  it.each<UserProfile>([
    tvl,
    {
      ...forecastProfile,
      tariff: null,
      federalState: "HE",
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
    {
      ...forecastProfile,
      tariff: null,
      federalState: "BW",
      tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
    },
  ])("keeps the ordinary salary visible across the three affected tariff families", (profile) => {
    const regular = calculateMonthlyPayEstimate("2026-07", [], profile, null);
    const partial = calculateMonthlyPayEstimate("2026-07", [standby], profile, null);
    expect(regular.available).toBe(true);
    expect(partial.available).toBe(false);
    expect(partial.knownGrossAmount).toBe(regular.estimatedGrossAmount);
  });
  it("keeps known regular pay for the same TVöD duty in TV-L, without inventing a full gross or net", () => {
    expect(calculateMonthlyPayEstimate("2026-07", [standby], forecastProfile, null).available).toBe(
      true,
    );
    const ordinary = forecastShift({ id: "ordinary", date: "2026-07-08" });
    const regular = calculateMonthlyPayEstimate("2026-07", [ordinary], tvl, null);
    const pay = calculateMonthlyPayEstimate("2026-07", [ordinary, standby], tvl, null);
    expect(pay.available).toBe(false);
    expect(pay.estimatedGrossAmount).toBeNull();
    expect(pay.knownGrossAmount).toBe(regular.estimatedGrossAmount);
    expect(pay.timePremiumAmount).toBe(regular.timePremiumAmount);
    expect(pay.specialDutyAmount).toBe(0);
    expect(incompleteSpecialDuties(pay)).toEqual([
      expect.objectContaining({
        shiftId: standby.id,
        date: standby.date,
        message: expect.stringContaining("passt nicht zum Tarif"),
      }),
    ]);
    const net = calculateAutomaticNetPayForecast(
      {
        month: "2026-07",
        profile: tvl,
        settings: automatedSettings(),
        shifts: [ordinary, standby],
        pay,
      },
      resolver,
    );
    expect(net.result.status).toBe("unavailable");
  });

  it("counts complete other duties once, while an unconfirmed on-call duty remains open", () => {
    const complete = forecastShift({ ...standby, id: "complete", specialDuty: fixedDuty });
    const open = forecastShift({
      ...standby,
      id: "on-call",
      specialDuty: newSpecialDuty("ON_CALL", "08:00", "16:00", "Europe/Berlin"),
    });
    const regular = calculateMonthlyPayEstimate("2026-07", [], tvl, null);
    const known = calculateMonthlyPayEstimate("2026-07", [complete], tvl, null);
    expect(known.available).toBe(true);
    const partial = calculateMonthlyPayEstimate("2026-07", [standby, complete, open], tvl, null);
    expect(partial.specialDutyAmount).toBe(known.specialDutyAmount);
    expect(partial.knownGrossAmount).toBe(known.estimatedGrossAmount);
    expect(partial.knownGrossAmount).toBeGreaterThan(regular.estimatedGrossAmount!);
    expect(incompleteSpecialDuties(partial)).toHaveLength(2);
  });

  it("limits a delayed July failure to the affected special-duty component and recovers after saving", () => {
    const prefs = setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2025-01", 1);
    const entries = [standby, forecastShift({ id: "august", date: "2026-08-10" })];
    const partial = salaryPaymentInput("2026-08", tvl, context(entries), prefs, "PAYOUT");
    expect(partial.available).toBe(false);
    expect(partial.issues).toEqual([
      expect.objectContaining({ month: "2026-07", group: "SPECIAL_DUTY" }),
    ]);
    expect(partial.pay.knownGrossAmount).toBeGreaterThan(0);
    expect(incompleteSpecialDuties(partial.pay)[0].shiftId).toBe(standby.id);
    const repaired = salaryPaymentInput(
      "2026-08",
      tvl,
      context([{ ...standby, specialDuty: fixedDuty, revision: 2 }, entries[1]]),
      prefs,
      "PAYOUT",
    );
    expect(repaired.available).toBe(true);
    expect(repaired.pay.knownGrossAmount).toBeUndefined();
    expect(repaired.pay.estimatedGrossAmount).toBeGreaterThan(partial.pay.knownGrossAmount!);
  });

  it("does not block the current payout with an incomplete duty that is paid next month", () => {
    const prefs = setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2025-01", 1);
    const entries = [forecastShift({ id: "june", date: "2026-06-10" }), standby];
    const result = salaryPaymentInput("2026-07", tvl, context(entries), prefs, "PAYOUT");
    expect(result.available).toBe(true);
    expect(result.pay.knownGrossAmount).toBeUndefined();
    expect(incompleteSpecialDuties(result.pay)).toEqual([]);
  });

  it("never exposes a subtotal if the ordinary salary basis is also unavailable", () => {
    const pay = calculateMonthlyPayEstimate(
      "2026-07",
      [standby],
      { ...tvl, weeklyMinutes: 4000 },
      null,
    );
    expect(pay.available).toBe(false);
    expect(pay.knownGrossAmount).toBeUndefined();
  });

  it("links the blocked annual reference to the exact duty and recalculates from repaired entries", () => {
    const result = (entries: readonly ShiftEntry[]) => {
      const steps = annualSalaryProposalResultSteps(2026, tvl, context(entries));
      let step = steps.next();
      while (!step.done) step = steps.next();
      return step.value;
    };
    const blocked = result([standby]);
    expect(blocked.proposal).toBeNull();
    expect(blocked.issue).toMatchObject({
      code: "REFERENCE_MONTH_UNAVAILABLE",
      month: "2026-07",
      duties: [{ shiftId: standby.id }],
    });
    expect(
      result([{ ...standby, specialDuty: fixedDuty, revision: 2 }]).proposal?.grossCents,
    ).toBeGreaterThan(0);
  });
});
