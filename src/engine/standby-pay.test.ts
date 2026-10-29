import { describe, expect, it } from "vitest";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement, type StandbyAgreement } from "@/domain/standby-agreement";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { calculateSpecialDutyPay } from "./special-duty-pay";
import { calculateStandbyPay } from "./standby-pay";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import { calculateAutomaticNetPayForecast } from "./net-pay-automatic-forecast";
import { standbyHourlyRate } from "./standby-hourly-rate";

const base: UserProfile = { ...forecastProfile, tariff: null };
const profiles = {
  p: forecastProfile,
  e: {
    ...base,
    vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
  },
  l: { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } },
  h: {
    ...base,
    federalState: "HE",
    tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
  },
  uk: { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } },
  training: {
    ...base,
    nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
  },
  tval: {
    ...base,
    tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST", employerScope: "SECTION_43" },
  },
} satisfies Record<string, UserProfile>;
function shift(
  family: StandbyAgreement["tariff"] = "TVOED_K",
  agreement: Partial<StandbyAgreement> = {},
  overrides: Partial<ShiftEntry> = {},
): ShiftEntry {
  return forecastShift({
    date: "2026-07-07",
    type: "CUSTOM",
    startTime: "06:00",
    endTime: "14:00",
    breakMinutes: 0,
    specialDuty: {
      ...newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin"),
      version: 2,
      standbyLevel: family === "TVUK" ? "I" : family === "TVOED_K" ? "II" : "B",
      settlement: "PAY",
      standbyAgreement: {
        ...newStandbyAgreement(family),
        rule: "STANDARD",
        sequence: 1,
        payGroup: "KR_VI",
        ...agreement,
        ...(agreement.hourlyCents !== undefined ? { rateMode: "AGREED" as const } : {}),
      },
    },
    ...overrides,
  });
}

describe("dated standby remuneration", () => {
  it.each([
    ["TVöD-P", profiles.p, "TVOED_K", {}, 13974],
    ["TVöD-E", profiles.e, "TVOED_K", {}, 14844],
    ["TV-L", profiles.l, "TVL_43", {}, 11224],
    ["TV-H", profiles.h, "TVH_43", {}, 11448],
    ["TV-UK", profiles.uk, "TVUK", { hourlyCents: 2000 }, 14000],
    ["TVAöD", profiles.training, "TVOED_K", { hourlyCents: 1200 }, 7200],
    ["TVA-L", profiles.tval, "TVL_43", { hourlyCents: 1250 }, 5000],
  ] as const)(
    "integrates an agreed ordinary day into taxable gross and net for %s",
    (_name, profile, family, agreement, expected) => {
      const entry = shift(family, agreement);
      const line = calculateSpecialDutyPay("2026-07", [entry], profile, resolver)[0];
      expect(line.complete).toBe(true);
      expect(line.baseAmountCents).toBe(expected);
      expect(line.standbyPay?.actualMinutes).toBe(480);
      const pay = calculateMonthlyPayEstimate("2026-07", [entry], profile, null);
      const without = calculateMonthlyPayEstimate("2026-07", [], profile, null);
      expect(pay.available).toBe(true);
      expect(Math.round((pay.estimatedGrossAmount! - without.estimatedGrossAmount!) * 100)).toBe(
        expected,
      );
      const net = calculateAutomaticNetPayForecast(
        { month: "2026-07", profile, settings: automatedSettings(), shifts: [entry], pay },
        resolver,
      );
      expect(net.result.status).toBe("available");
      if (net.result.status !== "available") throw Error(net.result.reason);
      expect(net.result.classification.amounts.taxableGrossCents).toBe(
        Math.round(pay.estimatedGrossAmount! * 100),
      );
      expect(net.result.classification.shifts).toEqual([]);
    },
  );

  it("uses independent BT-K/BT-B tables and dated April, May and July transitions", () => {
    const rate = (
      date: string,
      profile: UserProfile,
      tariff: StandbyAgreement["tariff"],
      extra: Partial<StandbyAgreement> = {},
    ) =>
      standbyHourlyRate(
        date,
        profile,
        { ...newStandbyAgreement(tariff), rule: "STANDARD", payGroup: "KR_VI", ...extra },
        resolver,
      )?.cents;
    expect(rate("2026-04-30", profiles.p, "TVOED_K")).toBe(2266);
    expect(rate("2026-05-01", profiles.p, "TVOED_K")).toBe(2329);
    const b = { ...profiles.p, tariff: { ...profiles.p.tariff!, sector: "BT_B" as const } };
    expect(rate("2026-04-30", b, "TVOED_B")).toBe(2609);
    expect(rate("2026-05-01", b, "TVOED_B")).toBe(2682);
    expect(rate("2026-03-31", profiles.l, "TVL_43")).toBe(2729);
    expect(rate("2026-04-01", profiles.l, "TVL_43")).toBe(2806);
    const east = {
      ...profiles.l,
      tvlKrTariff: { ...profiles.l.tvlKrTariff!, universityRegion: "EAST" as const },
    };
    expect(rate("2026-04-01", east, "TVL_43")).toBe(2702);
    expect(rate("2026-06-30", profiles.h, "TVH_43")).toBe(2778);
    expect(rate("2026-07-01", profiles.h, "TVH_43")).toBe(2862);
    expect(rate("2026-07-01", { ...profiles.p, weeklyMinutes: 1200 }, "TVOED_K")).toBe(2329);
  });

  it("requires a deliberate BT-B employee/worker table assignment", () => {
    const e = {
      ...profiles.e,
      vkaETariff: { ...profiles.e.vkaETariff!, payGroup: "E8" as const, sector: "BT_B" as const },
    };
    const rate = (payGroup: string | null) =>
      standbyHourlyRate(
        "2026-07-07",
        e,
        { ...newStandbyAgreement("TVOED_B"), rule: "STANDARD", payGroup },
        resolver,
      )?.cents;
    expect(rate(null)).toBeUndefined();
    expect(rate("E8")).toBe(2576);
    expect(rate("WORKER_E8")).toBe(2666);
    expect(rate("E15")).toBeUndefined();
  });

  it.each([
    [1, 5000],
    [8, 5000],
    [9, 6000],
    [12, 6000],
    [13, 7000],
  ])("keeps ordinal %s explicit and applies its monthly band", (sequence, bps) => {
    const result = calculateStandbyPay(shift("TVL_43", { sequence }), profiles.l, resolver);
    expect(result.factorBasisPoints).toBe(bps);
    expect(
      calculateStandbyPay(shift("TVL_43", { sequence: null }), profiles.l, resolver)
        .cashAmountCents,
    ).toBeNull();
  });

  it("distinguishes the special care factors from ordinary level I/A", () => {
    const k = shift("TVOED_K", { rule: "CARE" });
    const entry = { ...k, specialDuty: { ...k.specialDuty!, standbyLevel: "I" as const } };
    const result = calculateStandbyPay(entry, profiles.p, resolver);
    expect(result.weightedMinutes).toBeCloseTo(136.8);
    expect(result.baseAmountCents).toBe(5310);
    const b = { ...profiles.p, tariff: { ...profiles.p.tariff!, sector: "BT_B" as const } };
    const bs = shift("TVOED_B", { rule: "CARE", sequence: 9 });
    expect(calculateStandbyPay(bs, b, resolver).factorBasisPoints).toBe(4000);
  });

  it("separates weighted and factorized leave without paying both", () => {
    const entry = shift("TVOED_K", { timeOffMode: "WEIGHTED" });
    const weighted = {
      ...entry,
      specialDuty: {
        ...entry.specialDuty!,
        standbyLevel: "I" as const,
        settlement: "TIME_OFF" as const,
      },
    };
    const before = JSON.stringify(weighted);
    expect(calculateStandbyPay(weighted, profiles.p, resolver)).toMatchObject({
      actualMinutes: 480,
      weightedMinutes: 288,
      timeCreditMinutes: 288,
      cashAmountCents: 0,
      notes: [],
    });
    const factored = {
      ...weighted,
      specialDuty: {
        ...weighted.specialDuty!,
        standbyAgreement: {
          ...weighted.specialDuty!.standbyAgreement!,
          timeOffMode: "FACTORIZED" as const,
        },
      },
    };
    expect(calculateStandbyPay(factored, profiles.p, resolver).timeCreditMinutes).toBe(296);
    expect(JSON.stringify(weighted)).toBe(before);
  });

  it("adds TV-L holiday percentage points while BT-B has no holiday premium", () => {
    const l = calculateStandbyPay(
      shift("TVL_43", {}, { date: "2026-05-01" }),
      profiles.l,
      resolver,
    );
    expect(l).toMatchObject({
      weightedMinutes: 360,
      cashAmountCents: 16836,
      holidayPremiumCents: 0,
    });
    expect(l.notes).not.toEqual([]);
    const b = { ...profiles.p, tariff: { ...profiles.p.tariff!, sector: "BT_B" as const } };
    expect(
      calculateStandbyPay(shift("TVOED_B", {}, { date: "2026-05-01" }), b, resolver),
    ).toMatchObject({
      weightedMinutes: 240,
      cashAmountCents: 10728,
      holidayPremiumCents: 0,
      notes: [],
    });
  });

  it("keeps TV-UK health leave and the mandatory additional night cash distinct", () => {
    const entry = shift("TVUK", { hourlyCents: 2000 }, { startTime: "22:00", endTime: "06:00" });
    const overnight = { ...entry, specialDuty: { ...entry.specialDuty!, endDay: 1 } };
    expect(calculateStandbyPay(overnight, profiles.uk, resolver)).toMatchObject({
      cashAmountCents: 17080,
      mandatoryRestMinutes: 16.8,
      timeCreditMinutes: 16.8,
    });
    const off = {
      ...overnight,
      specialDuty: {
        ...overnight.specialDuty!,
        settlement: "TIME_OFF" as const,
        standbyAgreement: {
          ...overnight.specialDuty!.standbyAgreement!,
          timeOffMode: "WEIGHTED" as const,
        },
      },
    };
    expect(calculateStandbyPay(off, profiles.uk, resolver)).toMatchObject({
      cashAmountCents: 840,
      timeCreditMinutes: 504,
      mandatoryRestMinutes: 16.8,
    });
  });

  it("uses elapsed night minutes through the autumn clock change", () => {
    const entry = shift(
      "TVOED_K",
      {},
      { date: "2026-10-24", startTime: "20:00", endTime: "08:00" },
    );
    const result = calculateStandbyPay(
      { ...entry, specialDuty: { ...entry.specialDuty!, endDay: 1 } },
      profiles.p,
      resolver,
    );
    expect(result).toMatchObject({
      actualMinutes: 780,
      weightedMinutes: 585,
      nightPremiumCents: 3494,
    });
  });

  it("keeps unconfirmed facts, pauses, conflicts and unsupported intervals open", () => {
    for (const entry of [
      shift("TVOED_K", { rule: "UNKNOWN" }),
      shift("TVOED_K", {}, { breakMinutes: 30 }),
      shift("TVOED_K", {}, { date: "2027-01-05" }),
    ])
      expect(calculateStandbyPay(entry, profiles.p, resolver).cashAmountCents).toBeNull();
    expect(
      calculateStandbyPay(shift(), { ...profiles.p, vkaETariff: profiles.e.vkaETariff }, resolver)
        .cashAmountCents,
    ).toBeNull();
    expect(calculateStandbyPay(shift("TVL_43"), profiles.p, resolver).cashAmountCents).toBeNull();
    expect(
      calculateStandbyPay(shift("TVOED_K"), profiles.training, resolver).cashAmountCents,
    ).toBeNull();
  });
});
