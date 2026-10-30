import { describe, expect, it } from "vitest";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement, type StandbyAgreement } from "@/domain/standby-agreement";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import { calculateAutomaticNetPayForecast } from "./net-pay-automatic-forecast";
import { calculateMonthlySummary } from "./monthly-summary";

const base = { ...forecastProfile, tariff: null };
const models: readonly [
  string,
  UserProfile,
  StandbyAgreement["tariff"],
  Partial<StandbyAgreement>,
][] = [
  ["TVöD-P", forecastProfile, "TVOED_K", {}],
  [
    "TVöD-E",
    {
      ...base,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    },
    "TVOED_K",
    {},
  ],
  [
    "TV-L",
    { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } },
    "TVL_43",
    {},
  ],
  [
    "TV-H",
    {
      ...base,
      federalState: "HE",
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
    "TVH_43",
    {},
  ],
  [
    "TV-UK",
    { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } },
    "TVUK",
    { rateMode: "AGREED", hourlyCents: 2000 },
  ],
  [
    "TVAöD",
    { ...base, nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" } },
    "TVOED_K",
    { rateMode: "AGREED", hourlyCents: 1200 },
  ],
  [
    "TVA-L",
    {
      ...base,
      tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST", employerScope: "SECTION_43" },
    },
    "TVL_43",
    { rateMode: "AGREED", hourlyCents: 1250 },
  ],
  [
    "TVöD BT-B",
    { ...forecastProfile, tariff: { ...forecastProfile.tariff!, sector: "BT_B" } },
    "TVOED_B",
    {},
  ],
];
function standby(
  family: StandbyAgreement["tariff"] = "TVOED_K",
  agreement: Partial<StandbyAgreement> = {},
  overrides: Partial<ShiftEntry> = {},
): ShiftEntry {
  return forecastShift({
    id: "duty",
    date: "2026-07-07",
    type: "CUSTOM",
    startTime: "22:00",
    endTime: "23:00",
    breakMinutes: 0,
    specialDuty: {
      ...newSpecialDuty("STANDBY", "22:00", "23:00", "Europe/Berlin"),
      version: 2,
      standbyLevel: family === "TVUK" ? "I" : family === "TVOED_K" ? "II" : "B",
      settlement: "PAY",
      standbyAgreement: {
        ...newStandbyAgreement(family),
        rule: "STANDARD",
        sequence: 1,
        payGroup: "KR_VI",
        ...agreement,
      },
    },
    ...overrides,
  });
}
function calculate(
  entry: ShiftEntry,
  profile = forecastProfile,
  additionalRecurringGrossCents = 0,
) {
  const month = entry.date.slice(0, 7);
  const pay = calculateMonthlyPayEstimate(
    month,
    [entry],
    profile,
    null,
    [entry],
    undefined,
    resolver,
  );
  const settings = automatedSettings(month);
  const forecast = calculateAutomaticNetPayForecast(
    {
      month,
      profile,
      shifts: [entry],
      pay,
      settings: {
        ...settings,
        automation: { ...settings.automation!, additionalRecurringGrossCents },
      },
    },
    resolver,
  );
  if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
  return { pay, forecast, classification: forecast.result.classification };
}
function onCall(overrides: Partial<ShiftEntry> = {}): ShiftEntry {
  return forecastShift({
    id: "on-call",
    date: "2026-07-07",
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
    ...overrides,
  });
}

describe("special duties in SFN and net forecasts", () => {
  it.each(models)(
    "uses the existing dated calculation for %s night standby",
    (_label, profile, family, agreement) => {
      const entry = standby(family, agreement),
        before = JSON.stringify(entry);
      const { pay, classification } = calculate(entry, profile);
      expect(pay.available).toBe(true);
      const line = pay.specialDutyBreakdowns![0];
      expect(line.complete).toBe(true);
      expect(classification.taxFreeCents).toBe(line.standbyPay!.nightPremiumCents);
      expect(classification.amounts.grossCents).toBe(Math.round(pay.estimatedGrossAmount! * 100));
      expect(JSON.stringify(entry)).toBe(before);
    },
  );
  it("keeps the readiness base taxable and uses actual time for the separate night supplement", () => {
    const { pay, classification } = calculate(standby());
    const result = pay.specialDutyBreakdowns![0].standbyPay!;
    expect(result.cashAmountCents).toBe(2096);
    expect(result.nightPremiumCents).toBe(349);
    expect(classification.taxFreeCents).toBe(349);
    expect(classification.amounts.taxableGrossCents).toBe(classification.amounts.grossCents - 349);
    expect(classification.shifts[0].workedMinutes).toBe(60);
  });
  it("uses the regular basic wage with separate 50-euro tax and 25-euro social caps", () => {
    const { forecast, classification } = calculate(
      standby("TVOED_K", { rateMode: "AGREED", hourlyCents: 100000 }),
      forecastProfile,
      500000,
    );
    expect(forecast.basicHourlyPayCents).toBeGreaterThan(5000);
    expect(classification.taxFreeCents).toBe(1250);
    expect(classification.socialInsuranceFreeCents).toBe(625);
  });
  it.each(models)(
    "posts the confirmed night time-off valuation once for %s",
    (_label, profile, family, agreement) => {
      const entry = standby(family, { ...agreement, timeOffMode: "WEIGHTED" });
      const timeOff = {
        ...entry,
        specialDuty: { ...entry.specialDuty!, settlement: "TIME_OFF" as const },
      };
      const value = calculateMonthlySummary("2026-07", [timeOff, timeOff], profile, resolver);
      const expected =
        family === "TVOED_K" ? 54 : family === "TVOED_B" ? 39 : family === "TVUK" ? 63 : 30;
      expect(value.actualMinutes).toBe(60);
      expect(value.timeAccountMinutes).toBe(expected);
      expect(value.specialDutyTimeCredits).toHaveLength(1);
      expect(value.balanceMinutes).toBe(expected - value.targetMinutes);
    },
  );
  it("keeps TV-UK's cash-only deep-night premium separate from time off", () => {
    const entry = standby(
      "TVUK",
      { rateMode: "AGREED", hourlyCents: 2000, timeOffMode: "WEIGHTED" },
      { startTime: "00:00", endTime: "04:00" },
    );
    const profile = models.find((model) => model[2] === "TVUK")![1];
    const timeOff = {
      ...entry,
      specialDuty: { ...entry.specialDuty!, settlement: "TIME_OFF" as const },
    };
    const { pay, classification } = calculate(timeOff, profile);
    expect(pay.specialDutyBreakdowns![0].standbyPay!.cashAmountCents).toBe(840);
    expect(classification.taxFreeCents).toBe(840);
    expect(
      calculateMonthlySummary("2026-07", [timeOff], profile, resolver).timeAccountMinutes,
    ).toBe(252);
  });
  it("retains the TV-UK health credit alongside a cash settlement without crediting cash hours", () => {
    const profile = models.find((model) => model[2] === "TVUK")![1];
    const entry = standby("TVUK", { rateMode: "AGREED", hourlyCents: 2000 });
    const value = calculateMonthlySummary("2026-07", [entry], profile, resolver);
    expect(value.actualMinutes).toBe(60);
    expect(value.timeAccountMinutes).toBeCloseTo(2.1);
  });
  it("preserves mandatory TV-UK health time for actual night callouts", () => {
    const profile = models.find((model) => model[2] === "TVUK")![1];
    const entry = onCall();
    const { pay } = calculate(entry, profile);
    expect(pay.specialDutyBreakdowns![0].calloutPay!.mandatoryRestMinutes).toBe(0.5);
    expect(calculateMonthlySummary("2026-07", [entry], profile, resolver).timeAccountMinutes).toBe(
      0.5,
    );
    const timeOff = {
      ...entry,
      specialDuty: { ...entry.specialDuty!, settlement: "TIME_OFF" as const },
    };
    expect(
      calculateMonthlySummary("2026-07", [timeOff], profile, resolver).timeAccountMinutes,
    ).toBe(13);
  });
  it.each(models.filter((m) => m[2] === "TVL_43" || m[2] === "TVH_43"))(
    "keeps the increased unified holiday valuation taxable for %s",
    (_label, profile, family, agreement) => {
      const { pay, classification } = calculate(
        standby(family, agreement, { date: "2026-10-03", startTime: "08:00", endTime: "10:00" }),
        profile,
      );
      expect(pay.available).toBe(true);
      expect(classification.taxFreeCents).toBe(0);
    },
  );
  it("deducts a homogeneous night break once without inventing paid minutes", () => {
    const { pay, classification } = calculate(standby("TVOED_K", {}, { breakMinutes: 15 }));
    expect(pay.specialDutyBreakdowns![0].standbyPay!.actualMinutes).toBe(45);
    expect(classification.shifts[0].workedMinutes).toBe(45);
    expect(classification.taxFreeCents).toBe(262);
  });
  it("leaves the SFN result open when an unlocated break crosses different night caps", () => {
    const entry = standby(
      "TVOED_K",
      {},
      { startTime: "21:00", endTime: "05:00", breakMinutes: 30 },
    );
    const duty = { ...entry, specialDuty: { ...entry.specialDuty!, endDay: 1 } };
    const pay = calculateMonthlyPayEstimate(
      "2026-07",
      [duty],
      forecastProfile,
      null,
      [duty],
      undefined,
      resolver,
    );
    expect(pay.available).toBe(false);
    expect(pay.specialDutyBreakdowns![0].standbyPay!.cashAmountCents).not.toBeNull();
    expect(pay.specialDutyBreakdowns![0].notes.join(" ")).toContain("Lage der Bereitschaftspause");
  });
  it("allocates a confirmed break across the night boundary and tax bands", () => {
    const entry = standby(
      "TVOED_K",
      {},
      { startTime: "20:00", endTime: "05:00", breakMinutes: 30 },
    );
    const duty: ShiftEntry = {
      ...entry,
      specialDuty: { ...entry.specialDuty!, version: 3, endDay: 1, breakStart: 20 * 60 + 45 },
    };
    const { pay, classification } = calculate(duty);
    const result = pay.specialDutyBreakdowns![0].standbyPay!;
    expect(result.actualMinutes).toBe(510);
    expect(result.weightedMinutes).toBe(382.5);
    expect(result.nightPremiumCents).toBe(2707); // 465 actual night minutes × 23.29 × 15%.
    expect(classification.taxFreeCents).toBe(2707);
    expect(classification.shifts[0].workedMinutes).toBe(510);
  });
  it.each(models)(
    "pays only actual callout surcharge minutes for %s",
    (_label, profile, family) => {
      const { pay, classification } = calculate(onCall(), profile);
      const call = pay.specialDutyBreakdowns![0].calloutPay!;
      expect(call.actualMinutes).toBe(10);
      expect(call.paidMinutes).toBe(
        family === "TVUK" ? 10 : family === "TVL_43" || family === "TVH_43" ? 30 : 60,
      );
      expect(call.timePremiumCents).toBeGreaterThan(0);
      expect(classification.shifts[0].workedMinutes).toBe(10);
      expect(classification.shifts[0].sourceShiftId).toBe("on-call");
      expect(classification.taxFreeCents).toBe(call.timePremiumCents);
      expect(Math.round(pay.specialDutyAmount! * 100)).toBe(
        pay.specialDutyBreakdowns![0].baseAmountCents! +
          call.baseAmountCents! +
          call.overtimePremiumCents! +
          call.timePremiumCents!,
      );
    },
  );
  it("includes necessary travel in actual callout work, without a fictitious rounded hour", () => {
    const entry = onCall();
    const { classification } = calculate({
      ...entry,
      specialDuty: {
        ...entry.specialDuty!,
        callouts: [
          {
            kind: "ON_SITE",
            departure: 1320,
            start: 1325,
            end: 1335,
            returned: 1340,
            breakMinutes: 0,
          },
        ],
      },
    });
    expect(classification.shifts[0].workedMinutes).toBe(20);
  });
  it("converts confirmed callout base and overtime once while paying actual time surcharges", () => {
    const entry = onCall();
    const { pay, classification } = calculate({
      ...entry,
      specialDuty: { ...entry.specialDuty!, settlement: "TIME_OFF" },
    });
    const call = pay.specialDutyBreakdowns![0].calloutPay!;
    expect(call.baseAmountCents).toBe(0);
    expect(call.overtimePremiumCents).toBe(0);
    expect(call.timeCreditMinutes).toBe(78);
    expect(call.timePremiumCents).toBeGreaterThan(0);
    expect(classification.taxFreeCents).toBe(call.timePremiumCents);
  });
});
