import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyPayEstimate, hasProvisionalPayrollTariff } from "./simple-pay";
import { getTvlKrRulePackage, getTvlKrUniversityFullTimeMinutes } from "./simple-tvl-kr-pay";
import { getTvalPflegeFullTimeMinutes, getTvalPflegeRulePackage } from "./simple-tval-pflege-pay";
import { embeddedReviewedRuleResolver } from "@/rules/embedded-reviewed-rules";
import type { UserProfile } from "@/domain/types";
import type { SimpleTariffFamily } from "./simple-tariff-table-overlay";
import {
  bundledRuleResolver,
  BUNDLED_RULE_CATALOG,
  createRuleResolver,
  requireResolvedPackage,
} from "@/rules/rule-resolver";

const former = requireResolvedPackage(bundledRuleResolver.resolveTariff("2027-03-31"));
const profile = {
  ...forecastProfile,
  tariff: { ...forecastProfile.tariff!, payGroup: "P7" as const, payLevel: 2 as const },
};

describe("provisional TVöD payroll", () => {
  it("uses April work, contract hours and premium dates, including a later actual public holiday", () => {
    const march = calculateMonthlyPayEstimate("2027-03", [], profile, null);
    const april = calculateMonthlyPayEstimate(
      "2027-04",
      [forecastShift({ date: "2027-04-04" })],
      { ...profile, weeklyMinutes: 1155 },
      {
        month: "2027-04",
        allowanceStatus: "SHIFT_MONTHLY",
        revision: 1,
        confirmedAt: profile.updatedAt,
        updatedAt: profile.updatedAt,
      },
    );
    expect(april).toMatchObject({
      provisionalTariffMonths: ["2027-03"],
      available: true,
      personalBaseAmount: 1755.15,
      allowanceAmount: 50,
      shiftBreakdowns: [expect.objectContaining({ date: "2027-04-04", netMinutes: 540 })],
    });
    expect(march.personalBaseAmount).toBe(3510.3);
    expect(april.shiftBreakdowns[0].premiumLines.map((line) => line.key)).toContain("sunday");
    expect(april.shiftBreakdowns[0].premiumLines.map((line) => line.key)).not.toContain("holiday");
    expect(april.estimatedGrossAmount).toBeGreaterThan(april.personalBaseAmount!);

    const may = calculateMonthlyPayEstimate(
      "2027-05",
      [forecastShift({ date: "2027-05-01" })],
      profile,
      null,
    );
    expect(may.shiftBreakdowns[0].premiumLines.map((line) => line.key)).toContain("holiday");
  });

  it("leaves independently ended allowances and a missing personal table entry out of an estimate", () => {
    const changed = {
      ...former,
      rules: {
        ...former.rules,
        allowanceRules: former.rules.allowanceRules.map((rule) =>
          rule.allowanceType === "care" ? { ...rule, validTo: "2027-03-15" } : rule,
        ),
      },
    };
    const resolver = createRuleResolver({
      ...BUNDLED_RULE_CATALOG,
      tariff: BUNDLED_RULE_CATALOG.tariff.map((rule) => (rule === former ? changed : rule)),
    });
    const april = calculateMonthlyPayEstimate(
      "2027-04",
      [],
      profile,
      null,
      undefined,
      undefined,
      resolver,
    );
    expect(april).toMatchObject({
      available: true,
      careAllowanceAmount: 0,
      provisionalTariffMonths: ["2027-03"],
    });
    expect(april.tvoedAllowanceAmount).toBeGreaterThan(0);
    const missing = calculateMonthlyPayEstimate(
      "2027-04",
      [],
      {
        ...profile,
        tariff: { ...profile.tariff, payLevel: 1 },
      },
      null,
    );
    expect(missing).toMatchObject({
      available: false,
      personalBaseAmount: null,
      estimatedGrossAmount: null,
    });
  });

  it("prices each portion of April when a new catalog takes effect on the 16th", () => {
    const latest = structuredClone(former);
    latest.validFrom = "2027-04-16";
    latest.validTo = "2027-12-31";
    latest.versionId = "test-2027-04-16";
    for (const table of latest.rules.payTables)
      for (const row of table.entries) {
        row.monthlyCents += 20000;
        if (row.hourlyCents !== undefined) row.hourlyCents += 100;
      }
    for (const rule of latest.rules.allowanceRules) {
      rule.validFrom = latest.validFrom;
      rule.validTo = latest.validTo;
    }
    const resolver = createRuleResolver({
      ...BUNDLED_RULE_CATALOG,
      tariff: [...BUNDLED_RULE_CATALOG.tariff, latest],
    });
    const shifts = [
      forecastShift({ id: "before-change", date: "2027-04-04" }),
      forecastShift({ id: "after-change", date: "2027-04-18" }),
      forecastShift({
        id: "over-midnight",
        date: "2027-04-15",
        startTime: "22:00",
        endTime: "02:00",
        breakMinutes: 0,
      }),
    ];
    const april = calculateMonthlyPayEstimate(
      "2027-04",
      shifts,
      profile,
      null,
      undefined,
      undefined,
      resolver,
    );
    expect(april).toMatchObject({
      available: true,
      personalBaseAmount: 3610.3,
      provisionalTariffMonths: ["2027-03"],
    });
    const beforeShift = april.shiftBreakdowns.find((item) => item.shiftId === "before-change")!;
    const afterShift = april.shiftBreakdowns.find((item) => item.shiftId === "after-change")!;
    expect(afterShift.totalAmount).toBeGreaterThan(beforeShift.totalAmount);
    const overnight = april.shiftBreakdowns.find((item) => item.shiftId === "over-midnight")!;
    const night = overnight.premiumLines.filter((line) => line.key === "night");
    expect(night.map((line) => line.minutes)).toEqual([120, 120]);
    expect(night[1].hourlyRate).toBeGreaterThan(night[0].hourlyRate);
    const may = calculateMonthlyPayEstimate(
      "2027-05",
      [],
      profile,
      null,
      undefined,
      undefined,
      resolver,
    );
    expect(may.personalBaseAmount).toBe(3710.3);
    expect(may.provisionalTariffMonths).toBeUndefined();
  });

  it("continues the most recent matching table after its own expiry", () => {
    const newer = structuredClone(former);
    newer.validFrom = "2027-04-01";
    newer.validTo = "2027-04-30";
    newer.versionId = "test-dated-2027-04";
    for (const table of newer.rules.payTables)
      for (const row of table.entries) row.monthlyCents += 10000;
    for (const rule of newer.rules.allowanceRules) {
      rule.validFrom = newer.validFrom;
      rule.validTo = newer.validTo;
    }
    const resolver = createRuleResolver({
      ...BUNDLED_RULE_CATALOG,
      tariff: [...BUNDLED_RULE_CATALOG.tariff, newer],
    });
    expect(
      calculateMonthlyPayEstimate("2027-04", [], profile, null, undefined, undefined, resolver),
    ).toMatchObject({ personalBaseAmount: 3610.3 });
    expect(
      calculateMonthlyPayEstimate("2027-05", [], profile, null, undefined, undefined, resolver),
    ).toMatchObject({ personalBaseAmount: 3610.3, provisionalTariffMonths: ["2027-04"] });
  });
});

const otherProfile = { ...forecastProfile, tariff: null };
const cases: readonly [
  family: SimpleTariffFamily,
  profile: UserProfile,
  lastConfirmedMonth: string,
  firstProvisionalMonth: string,
][] = [
  [
    "TVL_KR",
    { ...otherProfile, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } },
    "2028-01",
    "2028-02",
  ],
  [
    "TVAL_PFLEGE",
    { ...otherProfile, tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST" } },
    "2028-01",
    "2028-02",
  ],
  [
    "TVH_KR",
    {
      ...otherProfile,
      federalState: "HE",
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
    "2028-02",
    "2028-03",
  ],
  [
    "TVUK_PUK",
    { ...otherProfile, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } },
    "2028-07",
    "2028-08",
  ],
];

describe("provisional payroll for the other supported profiles", () => {
  it.each(cases)(
    "continues %s at its own end date and uses the actual June shift",
    (family, profile) => {
      const source = embeddedReviewedRuleResolver;
      const data = structuredClone(source.simpleTariffData!);
      const active = data.tables.find(
        (row) =>
          row.tariffId === family &&
          row.validFrom <= "2026-05-31" &&
          (row.validTo === null || row.validTo >= "2026-06-01"),
      );
      if (!active) throw new Error(`No matching bundled table for ${family}`);
      active.validTo = "2026-05-31";
      const resolver = {
        ...source,
        simpleTariffData: data,
      };
      const estimate = (month: string, date: string, selected = resolver) =>
        calculateMonthlyPayEstimate(
          month,
          [forecastShift({ date })],
          profile,
          null,
          undefined,
          undefined,
          selected,
        );
      const may = estimate("2026-05", "2026-05-03");
      const june = estimate("2026-06", "2026-06-07");
      expect(may.provisionalTariffMonths).toBeUndefined();
      expect(june).toMatchObject({
        available: true,
        personalBaseAmount: may.personalBaseAmount,
        provisionalTariffMonths: ["2026-05"],
        shiftBreakdowns: [expect.objectContaining({ date: "2026-06-07" })],
      });
      expect(june.timePremiumAmount).toBeGreaterThan(0);
      const officialJune = calculateMonthlyPayEstimate(
        "2026-06",
        [forecastShift({ date: "2026-06-07" })],
        profile,
        null,
        undefined,
        undefined,
        source,
      );
      expect(officialJune.available).toBe(true);
      expect(officialJune.provisionalTariffMonths).toBeUndefined();
    },
  );
});

describe("review dates for open pay tables", () => {
  it.each(cases)(
    "marks %s after the review date with bundled and catalog data",
    (_family, profile, lastConfirmedMonth, firstProvisionalMonth) => {
      for (const resolver of [bundledRuleResolver, embeddedReviewedRuleResolver]) {
        const estimate = (month: string) =>
          calculateMonthlyPayEstimate(
            month,
            [forecastShift({ date: month + "-04" })],
            profile,
            null,
            undefined,
            undefined,
            resolver,
          );
        const confirmed = estimate(lastConfirmedMonth);
        const provisional = estimate(firstProvisionalMonth);
        expect(confirmed.provisionalTariffMonths).toBeUndefined();
        expect(provisional).toMatchObject({
          available: true,
          personalBaseAmount: confirmed.personalBaseAmount,
          provisionalTariffMonths: [lastConfirmedMonth],
        });
        expect(provisional.timePremiumAmount).toBeGreaterThan(0);
        expect(hasProvisionalPayrollTariff(lastConfirmedMonth, profile, resolver)).toBe(false);
        expect(hasProvisionalPayrollTariff(firstProvisionalMonth, profile, resolver)).toBe(true);
      }
    },
  );

  it.each(cases)(
    "uses a confirmed successor for %s, including a confirmation with unchanged rates",
    (family, profile, _lastConfirmedMonth, firstProvisionalMonth) => {
      const source = embeddedReviewedRuleResolver;
      const firstDay = firstProvisionalMonth + "-01";
      const lastDay = Temporal.PlainDate.from(firstDay).subtract({ days: 1 }).toString();
      const estimate = (resolver: typeof source) =>
        calculateMonthlyPayEstimate(
          firstProvisionalMonth,
          [forecastShift({ date: firstProvisionalMonth + "-04" })],
          profile,
          null,
          undefined,
          undefined,
          resolver,
        );
      const prior = estimate(source);
      for (const increaseCents of [0, 10_000]) {
        const data = structuredClone(source.simpleTariffData!);
        const old = data.tables.find(
          (table) => table.tariffId === family && table.validTo === null,
        )!;
        const successor = { ...structuredClone(old), validFrom: firstDay };
        old.validTo = lastDay;
        for (const entry of successor.entries) entry.monthlyCents += increaseCents;
        data.tables.push(successor);
        const resolver = { ...source, simpleTariffData: data };
        const confirmed = estimate(resolver);
        expect(confirmed.available).toBe(true);
        expect(confirmed.personalBaseAmount).toBe(prior.personalBaseAmount! + increaseCents / 100);
        expect(confirmed.provisionalTariffMonths).toBeUndefined();
        expect(hasProvisionalPayrollTariff(firstProvisionalMonth, profile, resolver)).toBe(false);
      }
    },
  );

  it("keeps the East university working-time step in January 2029", () => {
    for (const resolver of [bundledRuleResolver, embeddedReviewedRuleResolver]) {
      for (const fullTime of [getTvlKrUniversityFullTimeMinutes, getTvalPflegeFullTimeMinutes]) {
        expect(fullTime("2028-12-31", "EAST", resolver)).toBe(2340);
        expect(fullTime("2029-01-01", "EAST", resolver)).toBe(2310);
      }
    }
  });
});

it.each(cases.slice(0, 2))(
  "keeps %s base pay when a shift allowance ended independently",
  (family, profile) => {
    const readPackage = family === "TVL_KR" ? getTvlKrRulePackage : getTvalPflegeRulePackage;
    const value = structuredClone(readPackage("2026-04-01")!);
    value.validTo = "2026-05-31";
    const policies = value.rules.tvlShiftAllowancePolicy
      ? [value.rules.tvlShiftAllowancePolicy]
      : value.rules.tvalShiftAllowancePolicy!.scopes.map((scope) => scope.rates);
    for (const policy of policies) {
      const active = policy.periods.find(
        (period) =>
          period.validFrom <= "2026-04-01" &&
          (period.validTo === null || period.validTo >= "2026-04-01"),
      )!;
      policy.periods = [{ ...active, validTo: "2026-04-30" }];
    }
    const resolver = createRuleResolver({
      ...BUNDLED_RULE_CATALOG,
      tariff: [...BUNDLED_RULE_CATALOG.tariff, value],
    });
    const pay = calculateMonthlyPayEstimate(
      "2026-06",
      [],
      profile,
      {
        month: "2026-06",
        allowanceStatus: "SHIFT_MONTHLY",
        revision: 1,
        confirmedAt: profile.updatedAt,
        updatedAt: profile.updatedAt,
      },
      undefined,
      undefined,
      resolver,
    );
    expect(pay).toMatchObject({
      available: true,
      allowanceAmount: 0,
      provisionalTariffMonths: ["2026-05"],
    });
    expect(pay.personalBaseAmount).toBeGreaterThan(0);
  },
);
