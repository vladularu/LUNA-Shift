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
    ["TVöD-P", profiles.p, "TVOED_K", {}, 13101],
    ["TVöD-E", profiles.e, "TVOED_K", {}, 13916],
    ["TV-L", profiles.l, "TVL_43", {}, 10523],
    ["TV-H", profiles.h, "TVH_43", {}, 10733],
    ["TV-UK", profiles.uk, "TVUK", { hourlyCents: 2000 }, 13125],
    ["TVAöD", profiles.training, "TVOED_K", { hourlyCents: 1200 }, 6750],
    ["TVA-L", profiles.tval, "TVL_43", { hourlyCents: 1250 }, 4688],
  ] as const)(
    "deducts a thirty-minute duty-free break before valuation, gross and net for %s",
    (_name, profile, family, agreement, expected) => {
      const entry = shift(family, agreement, { breakMinutes: 30 });
      const before = JSON.stringify(entry);
      const line = calculateSpecialDutyPay("2026-07", [entry], profile, resolver)[0];
      expect(line.complete).toBe(true);
      expect(line.baseAmountCents).toBe(expected);
      expect(line.standbyPay?.actualMinutes).toBe(450);
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
      expect(JSON.stringify(entry)).toBe(before);
    },
  );

  it("calculates the December screenshot using net duty time before level II valuation", () => {
    expect(
      calculateStandbyPay(
        shift(
          "TVOED_K",
          {},
          {
            date: "2026-12-09",
            startTime: "08:00",
            endTime: "16:00",
            breakMinutes: 30,
          },
        ),
        profiles.p,
        resolver,
      ),
    ).toMatchObject({
      actualMinutes: 450,
      weightedMinutes: 337.5,
      cashAmountCents: 13101,
      notes: [],
    });
  });

  it("deducts a break from a wholly nocturnal period without inventing its position", () => {
    const entry = shift("TVOED_K", {}, { startTime: "22:00", endTime: "06:00", breakMinutes: 30 });
    expect(
      calculateStandbyPay(
        { ...entry, specialDuty: { ...entry.specialDuty!, endDay: 1 } },
        profiles.p,
        resolver,
      ),
    ).toMatchObject({
      actualMinutes: 450,
      weightedMinutes: 337.5,
      baseAmountCents: 13101,
      nightPremiumCents: 2620,
    });
  });

  it.each([
    ["2026-03-28", 390, 292.5, 11047, 2209],
    ["2026-10-24", 510, 382.5, 14847, 2969],
  ] as const)(
    "uses elapsed minutes and deducts the break once through clock change %s",
    (date, actualMinutes, weightedMinutes, baseAmountCents, nightPremiumCents) => {
      const entry = shift(
        "TVOED_K",
        {},
        { date, startTime: "22:00", endTime: "06:00", breakMinutes: 30 },
      );
      expect(
        calculateStandbyPay(
          { ...entry, specialDuty: { ...entry.specialDuty!, endDay: 1 } },
          profiles.p,
          resolver,
        ),
      ).toMatchObject({
        actualMinutes,
        weightedMinutes,
        baseAmountCents,
        nightPremiumCents,
      });
    },
  );

  it("reduces TV-UK deep-night pay and mandatory health leave by the same duty-free break", () => {
    const entry = shift(
      "TVUK",
      { hourlyCents: 2000 },
      { startTime: "02:00", endTime: "04:00", breakMinutes: 30 },
    );
    const pay = calculateStandbyPay(entry, profiles.uk, resolver);
    expect(pay).toMatchObject({
      actualMinutes: 90,
      baseAmountCents: 2100,
      overtimePremiumCents: 525,
      nightPremiumCents: 735,
      cashAmountCents: 3360,
    });
    expect(pay.weightedMinutes).toBeCloseTo(63, 8);
    expect(pay.mandatoryRestMinutes).toBeCloseTo(3.15);
    const off = calculateStandbyPay(
      {
        ...entry,
        specialDuty: {
          ...entry.specialDuty!,
          settlement: "TIME_OFF",
          standbyAgreement: { ...entry.specialDuty!.standbyAgreement!, timeOffMode: "WEIGHTED" },
        },
      },
      profiles.uk,
      resolver,
    );
    expect(off.cashAmountCents).toBe(315);
    expect(off.timeCreditMinutes).toBeCloseTo(94.5, 8);
    expect(off.mandatoryRestMinutes).toBeCloseTo(3.15);
  });

  it("deducts a break from Sunday time in TV-UK without subtracting it twice from leave", () => {
    const entry = shift(
      "TVUK",
      { hourlyCents: 2000, timeOffMode: "WEIGHTED" },
      { date: "2026-07-12", breakMinutes: 30 },
    );
    expect(calculateStandbyPay(entry, profiles.uk, resolver)).toMatchObject({
      weightedMinutes: 315,
      sundayPremiumCents: 4200,
      cashAmountCents: 17325,
    });
    expect(
      calculateStandbyPay(
        { ...entry, specialDuty: { ...entry.specialDuty!, settlement: "TIME_OFF" } },
        profiles.uk,
        resolver,
      ),
    ).toMatchObject({ cashAmountCents: 0, timeCreditMinutes: 519.75, notes: [] });
  });

  it.each([-30, 0.5, 480])(
    "does not calculate pay for invalid break duration %s",
    (breakMinutes) => {
      expect(
        calculateStandbyPay(shift("TVOED_K", {}, { breakMinutes }), profiles.p, resolver)
          .cashAmountCents,
      ).toBeNull();
    },
  );

  it("deducts breaks from holiday remuneration and factorized leave, without posting a balance", () => {
    const entry = shift(
      "TVOED_K",
      { timeOffMode: "FACTORIZED" },
      { date: "2026-12-25", breakMinutes: 30 },
    );
    expect(calculateStandbyPay(entry, profiles.p, resolver)).toMatchObject({
      actualMinutes: 450,
      weightedMinutes: 337.5,
      baseAmountCents: 13101,
      holidayPremiumCents: 3275,
      cashAmountCents: 16376,
    });
    expect(
      calculateStandbyPay(
        { ...entry, specialDuty: { ...entry.specialDuty!, settlement: "TIME_OFF" } },
        profiles.p,
        resolver,
      ),
    ).toMatchObject({
      timeCreditMinutes: 457.5,
      cashAmountCents: 0,
      notes: [],
    });
  });

  it("keeps an unspecified break open when relevant premium periods differ", () => {
    for (const entry of [
      shift("TVOED_K", {}, { startTime: "20:00", endTime: "22:00", breakMinutes: 30 }),
      {
        ...shift(
          "TVUK",
          { hourlyCents: 2000 },
          { startTime: "02:00", endTime: "05:00", breakMinutes: 30 },
        ),
      },
    ]) {
      const result = calculateStandbyPay(
        entry,
        entry.specialDuty!.standbyAgreement!.tariff === "TVUK" ? profiles.uk : profiles.p,
        resolver,
      );
      expect(result.cashAmountCents).toBeNull();
      expect(result.notes.join(" ")).toMatch(/Lage der Pause/);
    }
    const holiday = shift(
      "TVL_43",
      {},
      { date: "2026-04-30", startTime: "22:00", endTime: "06:00", breakMinutes: 30 },
    );
    expect(
      calculateStandbyPay(
        { ...holiday, specialDuty: { ...holiday.specialDuty!, endDay: 1 } },
        profiles.l,
        resolver,
      ).cashAmountCents,
    ).toBeNull();
  });

  it("ignores midnight and night boundaries that do not change a tariff's remuneration", () => {
    const entry = shift("TVL_43", {}, { startTime: "22:00", endTime: "06:00", breakMinutes: 30 });
    expect(
      calculateStandbyPay(
        { ...entry, specialDuty: { ...entry.specialDuty!, endDay: 1 } },
        profiles.l,
        resolver,
      ),
    ).toMatchObject({
      actualMinutes: 450,
      weightedMinutes: 225,
      cashAmountCents: 10523,
      notes: [],
    });
    const b = { ...profiles.p, tariff: { ...profiles.p.tariff!, sector: "BT_B" as const } };
    expect(
      calculateStandbyPay(shift("TVOED_B", {}, { breakMinutes: 30 }), b, resolver),
    ).toMatchObject({
      actualMinutes: 450,
      weightedMinutes: 225,
      cashAmountCents: 10058,
      notes: [],
    });
  });

  it("keeps an elapsed twenty-five-hour service unsupported even when a break brings net time below a day", () => {
    const entry = shift(
      "TVOED_K",
      {},
      { date: "2026-10-25", startTime: "00:00", endTime: "00:00", breakMinutes: 90 },
    );
    const result = calculateStandbyPay(
      { ...entry, specialDuty: { ...entry.specialDuty!, endDay: 1 } },
      profiles.p,
      resolver,
    );
    expect(result.actualMinutes).toBe(1410);
    expect(result.cashAmountCents).toBeNull();
    expect(result.notes.join(" ")).toMatch(/24 Stunden/);
  });
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

  it("keeps unconfirmed facts, conflicts and unsupported intervals open", () => {
    for (const entry of [
      shift("TVOED_K", { rule: "UNKNOWN" }),
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
