import { captureEmploymentProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { describe, expect, it } from "vitest";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { NET_PAY_PENSION_OPTIONS, netPayPensionMaxOwnRate } from "@/domain/net-pay-pension-schemes";
import { selectMonthlyAnalysisEntries } from "@/features/analysis/analysis-data";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "./tvoed-pattern";
import { calculateAutomaticNetPayForecast } from "./net-pay-automatic-forecast";
import { calculateTvUkNursingShift } from "./simple-tvuk-nursing-pay";
import { classifySfnPayroll2026 } from "./net-pay-sfn";

const base: UserProfile = { ...forecastProfile, tariff: null };
const models: readonly [string, UserProfile][] = [
  ["TVöD-P", forecastProfile],
  [
    "TVöD E",
    {
      ...base,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    },
  ],
  ["TV-L KR", { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } }],
  [
    "TV-H KR",
    {
      ...base,
      federalState: "HE",
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
  ],
  ["TV-UK", { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } }],
  [
    "TVAöD Pflege",
    { ...base, nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" } },
  ],
  ["TVA-L Pflege", { ...base, tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST" } }],
  ["Manuelles Gehalt", { ...base, manualMonthlyGrossCents: 500000 }],
];
function calculate(
  profile: UserProfile,
  shift = forecastShift(),
  settings = automatedSettings("2026-06"),
  allowanceStatus = "NONE" as "NONE" | "ALTERNATING_MONTHLY",
) {
  return calculateMonth(profile, shift.date.slice(0, 7), [shift], settings, allowanceStatus);
}
function calculateMonth(
  profile: UserProfile,
  month: string,
  entries: readonly ShiftEntry[],
  settings = automatedSettings("2026-01"),
  allowanceStatus = "NONE" as "NONE" | "ALTERNATING_MONTHLY",
) {
  const shifts = selectMonthlyAnalysisEntries(entries, month).monthShifts;
  const decision = {
    month,
    allowanceStatus,
    revision: 1,
    confirmedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const pay = calculateMonthlyPayEstimate(
    month,
    shifts,
    profile,
    decision,
    shifts,
    DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    resolver,
  );
  return {
    forecast: calculateAutomaticNetPayForecast(
      { month, profile, settings, shifts: entries, pay },
      resolver,
    ),
    pay,
  };
}
describe("automatic payroll across every selectable salary model", () => {
  it("identifies the affected service when work times are missing", () => {
    const shift = forecastShift({
      id: "missing-times",
      allDay: true,
      startTime: null,
      endTime: null,
    });
    const { forecast } = calculate(forecastProfile, shift);
    expect(forecast.result.status).toBe("unavailable");
    expect(forecast).toMatchObject({
      recovery: { kind: "entry", date: shift.date, entryId: shift.id },
    });
  });

  it("identifies the work profile when weekly hours are missing", () => {
    const profile = { ...forecastProfile, weeklyMinutes: 0 };
    const pay = calculate(forecastProfile).pay;
    const forecast = calculateAutomaticNetPayForecast(
      {
        month: pay.month,
        profile,
        settings: automatedSettings("2026-06"),
        shifts: [forecastShift()],
        pay,
      },
      resolver,
    );
    expect(forecast).toMatchObject({
      result: { status: "unavailable" },
      recovery: { kind: "profile", section: "WORK" },
    });
  });

  it("identifies invalid pauses even when they also prevent a complete gross forecast", () => {
    const shift = forecastShift({ id: "invalid-pause", breakMinutes: 9999 });
    const { forecast } = calculate(forecastProfile, shift);
    expect(forecast).toMatchObject({
      result: { status: "unavailable" },
      recovery: { kind: "entry", date: shift.date, entryId: shift.id },
    });
  });

  it("does not invent a profile setting for unsupported time zones or unavailable tariff data", () => {
    const pay = calculate(forecastProfile).pay;
    const input = {
      month: pay.month,
      profile: forecastProfile,
      settings: automatedSettings("2026-06"),
      shifts: [forecastShift()],
      pay,
    };
    const unsupported = calculateAutomaticNetPayForecast(
      { ...input, profile: { ...forecastProfile, timeZone: "Europe/Vienna" } },
      resolver,
    );
    const incomplete = calculateAutomaticNetPayForecast(
      { ...input, pay: { ...pay, available: false, estimatedGrossAmount: null } },
      resolver,
    );
    for (const forecast of [unsupported, incomplete]) {
      expect(forecast.result.status).toBe("unavailable");
      expect(forecast.recovery).toBeUndefined();
    }
  });

  for (const [label, profile] of models) {
    it.each(["2027-01-01", "2027-01-31", "2027-03-28"])(
      `${label}: forecasts %s with its actual gross and a labelled previous-year deduction model`,
      (date) => {
        const { forecast, pay } = calculate(
          profile,
          forecastShift({ date }),
          automatedSettings("2026-01"),
        );
        expect(forecast.result, JSON.stringify(forecast)).toMatchObject({ status: "available" });
        if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
        expect(forecast.sourceMonth).toBe("2026-01");
        const { classification, pay: net } = forecast.result;
        expect(net.month).toBe(date.slice(0, 7));
        expect(net.calculationBasis).toMatchObject({
          payrollYear: 2027,
          rulesYear: 2026,
          status: "PREVIOUS_YEAR_ESTIMATE",
        });
        expect(classification.calculationBasis).toEqual(net.calculationBasis);
        expect(net.amounts.grossCents).toBe(Math.round(pay.estimatedGrossAmount! * 100));
        expect(classification.paidPremiumCents).toBe(Math.round(pay.timePremiumAmount * 100));
        expect(classification.taxFreeCents).toBeLessThanOrEqual(classification.paidPremiumCents);
        expect(net.netCents + net.tax.totalCents + net.socialInsurance.totalCents).toBe(
          net.amounts.grossCents,
        );
      },
    );
    it.each(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31", "2026-12-31"])(
      `${label}: inherits the complete salary of a cross-month night starting on %s`,
      (date) => {
        const { forecast, pay } = calculate(
          profile,
          forecastShift({ date }),
          automatedSettings("2026-01"),
        );
        expect(forecast.result, JSON.stringify(forecast)).toMatchObject({ status: "available" });
        if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
        const { classification, pay: netPay } = forecast.result;
        expect(classification.paidPremiumCents).toBe(Math.round(pay.timePremiumAmount * 100));
        expect(classification.shifts.map((s) => s.shiftId)).toEqual(
          profile.manualMonthlyGrossCents == null ? ["forecast-shift"] : [],
        );
        expect(netPay.amounts.grossCents).toBe(Math.round(pay.estimatedGrossAmount! * 100));
        expect(netPay.netCents + netPay.tax.totalCents + netPay.socialInsurance.totalCents).toBe(
          netPay.amounts.grossCents,
        );
        if (profile.manualMonthlyGrossCents == null) {
          expect(classification.taxFreeCents).toBeGreaterThan(0);
          expect(classification.taxFreeCents).toBeLessThanOrEqual(classification.paidPremiumCents);
          expect(classification.shifts[0]!.workedMinutes).toBe(540);
        }
      },
    );
    it(`${label}: assigns a boundary shift once and keeps the following month's own shifts`, () => {
      const boundary = forecastShift({ id: "october-night", date: "2026-10-31" });
      const next = forecastShift({ id: "november-night", date: "2026-11-01" });
      const entries = [boundary, next];
      const october = calculateMonth(profile, "2026-10", entries);
      const november = calculateMonth(profile, "2026-11", entries);
      expect(october.forecast.result).toEqual(
        calculateMonth(profile, "2026-10", [boundary]).forecast.result,
      );
      expect(november.forecast.result).toEqual(
        calculateMonth(profile, "2026-11", [next]).forecast.result,
      );
      for (const { forecast, pay } of [october, november]) {
        expect(forecast.result.status).toBe("available");
        if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
        expect(forecast.result.classification.paidPremiumCents).toBe(
          Math.round(pay.timePremiumAmount * 100),
        );
      }
    });
    it.each(["UNKNOWN", "OTHER"] as const)(
      `${label}: provides a labelled forecast before %s pension coverage`,
      (pensionScheme) => {
        const initial = automatedSettings();
        const settings = { ...initial, automation: { ...initial.automation!, pensionScheme } };
        const forecast = calculate(profile, forecastShift(), settings).forecast;
        expect(forecast.pensionOmitted).toBe(true);
        expect(forecast.result).toEqual(calculate(profile).forecast.result);
        expect(settings.automation.pensionScheme).toBe(pensionScheme);
      },
    );
    it(`${label}: classifies public holiday/night premiums without adding unpaid or unearned premiums`, () => {
      const { forecast, pay } = calculate(profile, forecastShift({ date: "2026-10-03" }));
      expect(forecast.result, JSON.stringify(forecast)).toMatchObject({ status: "available" });
      if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
      expect(forecast.result.classification.paidPremiumCents).toBe(
        Math.round(pay.timePremiumAmount * 100),
      );
      expect(forecast.result.classification.taxFreeCents).toBeLessThanOrEqual(
        forecast.result.classification.paidPremiumCents,
      );
      if (profile.manualMonthlyGrossCents == null)
        expect(forecast.result.classification.taxFreeCents).toBeGreaterThan(0);
    });
    it.each([0, 60])(
      `${label}: inherits personal settings and reconciles Sunday/night work with %i pause minutes`,
      (breakMinutes) => {
        const { forecast, pay } = calculate(profile, forecastShift({ breakMinutes }));
        expect(forecast.result, JSON.stringify(forecast)).toMatchObject({ status: "available" });
        if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
        const result = forecast.result;
        expect(result.pay.amounts.grossCents).toBe(Math.round(pay.estimatedGrossAmount! * 100));
        expect(
          result.pay.netCents + result.pay.tax.totalCents + result.pay.socialInsurance.totalCents,
        ).toBe(result.pay.amounts.grossCents);
        expect(result.classification.paidPremiumCents).toBe(
          Math.round(pay.timePremiumAmount * 100),
        );
        if (profile.manualMonthlyGrossCents == null)
          expect(result.classification.taxFreeCents).toBeGreaterThan(0);
        else expect(result.classification.taxFreeCents).toBe(0);
        expect(forecast.sourceMonth).toBe("2026-06");
        expect(forecast.basicHourlyPayCents).toBe(
          Math.round(forecast.regularGrossCents! / ((4.35 * profile.weeklyMinutes) / 60)),
        );
      },
    );
    it(`${label}: recomputes from a changed calendar without repeated gross entry`, () => {
      const before = calculate(profile, forecastShift({ endTime: "02:00", breakMinutes: 0 }))
        .forecast.result;
      const after = calculate(profile, forecastShift({ endTime: "07:00", breakMinutes: 0 }))
        .forecast.result;
      expect(before.status).toBe("available");
      expect(after.status).toBe("available");
      if (
        before.status === "available" &&
        after.status === "available" &&
        profile.manualMonthlyGrossCents == null
      )
        expect(after.pay.netCents).toBeGreaterThan(before.pay.netCents);
    });
  }
  it("still requires a complete tariff gross after the known TVöD table expires", () => {
    const { forecast, pay } = calculateMonth(
      forecastProfile,
      "2027-04",
      [],
      automatedSettings("2026-01"),
    );
    expect(pay.available).toBe(false);
    expect(forecast.result).toMatchObject({
      status: "unavailable",
      reason: "Die vollständige Brutto-Gehaltsprognose fehlt.",
    });
  });
  it("keeps paid TV-H pauses taxable while including their actual cash premiums", () => {
    const { forecast, pay } = calculate(
      models[3]![1],
      forecastShift(),
      automatedSettings(),
      "ALTERNATING_MONTHLY",
    );
    expect(forecast.result, JSON.stringify(forecast)).toMatchObject({ status: "available" });
    if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
    expect(pay.shiftBreakdowns[0]!.netMinutes).toBe(600);
    expect(forecast.result.classification.shifts[0]!.workedMinutes).toBe(540);
    expect(forecast.result.classification.taxFreeCents).toBeLessThan(
      forecast.result.classification.paidPremiumCents,
    );
  });
  it("excludes confirmed paid TV-UK night pauses from SFN work", () => {
    const profile = models[4]![1];
    const shift = forecastShift();
    const { payrollTrace, ...cash } = calculateTvUkNursingShift(
      shift,
      profile,
      profile.tvUkNursingTariff!,
      { regularShiftWork: true, paidNightBreaks: true },
      resolver,
      true,
    );
    expect(payrollTrace!.paidBreaks).toHaveLength(1);
    const result = classifySfnPayroll2026(
      {
        month: "2026-07",
        completeGross: true,
        grossCents: 500000,
        regularMonthlySocialInsuranceGrossCents: 400000,
        basicHourlyPayCents: 2500,
        workplace: { federalState: "BW", holidayRegion: "NONE" },
        workEvidence: "PLANNED",
        shifts: [payrollTrace!],
      },
      resolver,
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);
    expect(result.shifts[0]!.workedMinutes).toBe(540);
    expect(result.paidPremiumCents).toBe(
      Math.round(cash.premiumLines.reduce((sum, line) => sum + line.amount, 0) * 100),
    );
  });
  it("adds a missing recurring allowance exactly once and separates personal deductions", () => {
    const settings = automatedSettings();
    const { forecast, pay } = calculate(forecastProfile, forecastShift(), {
      ...settings,
      automation: {
        ...settings.automation!,
        additionalRecurringGrossCents: 10000,
        additionalNetDeductionCents: 1500,
        pensionScheme: "VBL_WEST",
      },
    });
    expect(forecast.result, JSON.stringify(forecast)).toMatchObject({ status: "available" });
    if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
    expect(forecast.result.pay.amounts.grossCents).toBe(
      Math.round(pay.estimatedGrossAmount! * 100) + 10000,
    );
    expect(forecast.result.pay.additionalNetDeductionCents).toBe(1500);
    expect(forecast.result.pay.pension!.employeeCents).toBeGreaterThan(0);
    expect(forecast.pensionOmitted).toBe(false);
  });
  it.each(
    NET_PAY_PENSION_OPTIONS.filter(
      ({ value }) => !["UNKNOWN", "NONE", "OTHER"].includes(value),
    ).map(({ value }) => value),
  )("integrates the pension model %s with the automatic salary and premiums", (pensionScheme) => {
    const initial = automatedSettings();
    const { forecast } = calculate(forecastProfile, forecastShift(), {
      ...initial,
      automation: {
        ...initial.automation!,
        pensionScheme,
        ...(netPayPensionMaxOwnRate(pensionScheme) === null ? {} : { pensionEmployeeRateBps: 100 }),
      },
    });
    expect(forecast.pensionOmitted).toBe(false);
    expect(forecast.result.status).toBe("available");
    if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
    const pay = forecast.result.pay;
    expect(pay.pension?.scheme).toBe(pensionScheme);
    expect(
      pay.netCents +
        pay.tax.totalCents +
        pay.socialInsurance.totalCents +
        pay.pension!.employeeCents +
        (pay.additionalNetDeductionCents ?? 0),
    ).toBe(pay.amounts.grossCents);
  });
  it.each<["ZVK_DARMSTADT_I" | "ZVK_DARMSTADT_II", number, string]>([
    ["ZVK_DARMSTADT_I", 50, "2026-07-04"],
    ["ZVK_DARMSTADT_II", 40, "2026-07-04"],
    ["ZVK_DARMSTADT_I", 50, "2026-12-25"],
    ["ZVK_DARMSTADT_II", 40, "2026-12-25"],
  ])(
    "%s at %s bps excludes all SFN premiums from pension contributions on %s",
    (scheme, ownBps, date) => {
      const initial = automatedSettings("2026-01");
      const { forecast } = calculate(
        models[3]![1],
        forecastShift({ date, startTime: "20:00", endTime: "06:00" }),
        { ...initial, automation: { ...initial.automation!, pensionScheme: scheme } },
        "ALTERNATING_MONTHLY",
      );
      expect(forecast.result.status).toBe("available");
      if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
      const { pay, classification } = forecast.result;
      const premiums = classification.shifts.flatMap((shift) => shift.premiumBreakdown);
      const saturdayCents =
        premiums.find((premium) => premium.category === "SATURDAY")?.paidPremiumCents ?? 0;
      const expectedBasisCents = forecast.regularGrossCents! + saturdayCents;
      // Paid night pauses remain taxable, but neither they nor other SFN premiums count for ZVK.
      expect(
        premiums.find((premium) => premium.category === "NIGHT")!.taxablePremiumCents,
      ).toBeGreaterThan(0);
      if (date === "2026-07-04") {
        expect(
          premiums.find((premium) => premium.category === "SUNDAY")!.paidPremiumCents,
        ).toBeGreaterThan(0);
      } else {
        expect(
          premiums.find((premium) => premium.category === "HOLIDAY")!.paidPremiumCents,
        ).toBeGreaterThan(0);
      }
      expect(classification.amounts.taxableGrossCents).toBeGreaterThan(expectedBasisCents);
      expect(pay.pension!.contributionBasisCents).toBe(expectedBasisCents);
      expect(pay.pension!.employeeCents).toBe(Math.round((expectedBasisCents * ownBps) / 10000));
    },
  );
  it.each(["ZVK_DARMSTADT_I", "ZVK_DARMSTADT_II"] as const)(
    "%s keeps Saturday premiums in its contribution basis",
    (scheme) => {
      const initial = automatedSettings("2026-01");
      const { forecast } = calculate(
        forecastProfile,
        forecastShift({ date: "2026-07-04", startTime: "13:00", endTime: "21:00" }),
        { ...initial, automation: { ...initial.automation!, pensionScheme: scheme } },
      );
      expect(forecast.result.status).toBe("available");
      if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
      const { pay, classification } = forecast.result;
      const saturdayCents = classification.paidPremiumCents;
      expect(saturdayCents).toBeGreaterThan(0);
      expect(classification.shifts[0]!.premiumBreakdown[0]!.category).toBe("SATURDAY");
      expect(pay.pension!.contributionBasisCents).toBe(forecast.regularGrossCents! + saturdayCents);
    },
  );
  it("keeps an unknown EZVK share distinct from zero and recomputes when the share changes", () => {
    const initial = automatedSettings();
    const withShare = (pensionEmployeeRateBps: number | null) => ({
      ...initial,
      automation: {
        ...initial.automation!,
        pensionScheme: "EZVK_KARLSRUHE" as const,
        pensionEmployeeRateBps,
      },
    });
    const unknown = calculate(forecastProfile, forecastShift(), withShare(null)).forecast;
    const none = calculate(forecastProfile, forecastShift(), withShare(0)).forecast;
    const own = calculate(forecastProfile, forecastShift(), withShare(100)).forecast;
    expect(unknown.pensionOmitted).toBe(true);
    expect(none.pensionOmitted).toBe(false);
    expect(own.pensionOmitted).toBe(false);
    for (const forecast of [unknown, none, own]) expect(forecast.result.status).toBe("available");
    if (none.result.status !== "available" || own.result.status !== "available")
      throw new Error("Expected a forecast");
    expect(none.result.pay.pension?.employeeCents).toBe(0);
    expect(own.result.pay.pension?.employeeCents).toBeGreaterThan(0);
    expect(none.result.pay.netCents).not.toBe(own.result.pay.netCents);
  });
  it("derives Saxony care contributions from the current workplace despite an older personal setting", () => {
    const saxony = { ...forecastProfile, federalState: "SN" as const };
    const initial = automatedSettings();
    const before = calculate(saxony, forecastShift(), initial).forecast.result;
    const corrected = calculate(saxony, forecastShift(), {
      ...initial,
      profile: { ...initial.profile, worksInSaxony: true },
    }).forecast.result;
    expect(before.status).toBe("available");
    expect(before).toEqual(corrected);
  });
  it("rejects a changed shift paired with an old gross result", () => {
    const shift = forecastShift();
    const pay = calculate(forecastProfile, shift).pay;
    expect(
      calculateAutomaticNetPayForecast(
        {
          month: "2026-07",
          profile: forecastProfile,
          settings: automatedSettings(),
          pay,
          shifts: [{ ...shift, endTime: "09:00" }],
        },
        resolver,
      ).result.status,
    ).toBe("unavailable");
  });
  it("does not turn partial/unknown gross or a future personal profile into a net estimate", () => {
    const shift = forecastShift();
    const pay = calculate(forecastProfile).pay;
    expect(
      calculateAutomaticNetPayForecast(
        {
          month: "2026-07",
          profile: forecastProfile,
          settings: automatedSettings(),
          pay: { ...pay, available: false, estimatedGrossAmount: null },
          shifts: [shift],
        },
        resolver,
      ).result.status,
    ).toBe("unavailable");
    expect(
      calculate(forecastProfile, shift, automatedSettings("2026-08")).forecast.result.status,
    ).toBe("unavailable");
  });
});

describe("dated payroll input equivalence", () => {
  function dated(
    profile: UserProfile,
    changes: readonly [string | null, Partial<UserProfile>][] = [
      [null, {}],
      ["2026-07-16", {}],
    ],
  ) {
    return {
      ...profile,
      employmentTimeline: changes.map(([effectiveFrom, patch], index) => {
        const selected = { ...profile, ...patch };
        return {
          effectiveFrom,
          data: remunerationDataFromLegacy(selected),
          employment: captureEmploymentProfile(selected),
          revision: index + 1,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
        };
      }),
    };
  }
  it.each(models)(
    "keeps %s available across an identical correction boundary",
    (_label, profile) => {
      const before = calculate(profile);
      const after = calculate(dated(profile));
      expect(before.forecast.result.status).toBe("available");
      expect(after.forecast).toEqual(before.forecast);
      expect(after.pay.personalBaseAmount).toEqual(before.pay.personalBaseAmount);
      expect(after.pay.estimatedGrossAmount).toEqual(before.pay.estimatedGrossAmount);
    },
  );
  it("does not mistake corrected metadata for a midmonth financial change", () => {
    const profile = dated(forecastProfile);
    const corrected = {
      ...profile,
      employmentTimeline: profile.employmentTimeline.map((p, i) => ({
        ...p,
        revision: 100 + i,
        employmentOverrides: { weeklyMinutes: "2026-07-20" },
        updatedAt: "2026-07-20T00:00:00Z",
      })),
    };
    expect(calculate(corrected).forecast).toEqual(calculate(forecastProfile).forecast);
  });
  it("retains a real hours change even when the latest value is back to the original", () => {
    const profile = dated(forecastProfile, [
      [null, {}],
      ["2026-07-10", { weeklyMinutes: 1800 }],
      ["2026-07-20", {}],
    ]);
    expect(calculate(profile).forecast.result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Beschäftigungsänderungen"),
    });
  });
  it("retains changes to the actual salary selection", () => {
    const profile = dated(forecastProfile, [
      [null, {}],
      ["2026-07-16", { tariff: { ...forecastProfile.tariff!, payLevel: 5 } }],
    ]);
    expect(calculate(profile).forecast.result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Beschäftigungsänderungen"),
    });
  });
  it("restores the October forecast for corrected identical employment periods", () => {
    const shift = forecastShift({ date: "2026-10-04" });
    const before = calculate(forecastProfile, shift, automatedSettings("2026-10"));
    const after = calculate(
      dated(forecastProfile, [
        [null, {}],
        ["2026-10-26", {}],
      ]),
      shift,
      automatedSettings("2026-10"),
    );
    expect(before.forecast.result.status).toBe("available");
    expect(after.forecast).toEqual(before.forecast);
  });
});
