import { describe, expect, it } from "vitest";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver, createRuleResolver, type RuleResolver } from "@/rules/rule-resolver";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { calculateVkaEShift } from "./simple-vka-e-pay";
import { calculateNursingTrainingShift } from "./simple-nursing-training-pay";
import { calculateTvhKrShift } from "./simple-tvh-kr-pay";
import { calculateTvalPflegeShift } from "./simple-tval-pflege-pay";

const base = { ...forecastProfile, tariff: null };
const models = [
  {
    name: "VKA-E",
    profile: {
      ...base,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    },
    calculate: (s: ShiftEntry, p: UserProfile, r: RuleResolver, trace: boolean) =>
      calculateVkaEShift(s, p, r, trace),
  },
  {
    name: "TVAöD",
    profile: {
      ...base,
      nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
    },
    calculate: (s: ShiftEntry, p: UserProfile, r: RuleResolver, trace: boolean) =>
      calculateNursingTrainingShift(s, p, r, trace),
  },
  {
    name: "TV-H",
    profile: {
      ...base,
      federalState: "HE",
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
    calculate: (s: ShiftEntry, p: UserProfile, r: RuleResolver, trace: boolean) =>
      calculateTvhKrShift(
        s,
        p,
        p.tvhKrTariff!,
        { allowanceStatus: "NONE", saturdayShiftWork: false },
        r,
        trace,
      ),
  },
  {
    name: "TVA-L",
    profile: { ...base, tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST" } },
    calculate: (s: ShiftEntry, p: UserProfile, r: RuleResolver, trace: boolean) =>
      calculateTvalPflegeShift(s, p, p.tvalPflegeTariff!, false, r, trace),
  },
] satisfies readonly {
  name: string;
  profile: UserProfile;
  calculate: (
    s: ShiftEntry,
    p: UserProfile,
    r: RuleResolver,
    trace: boolean,
  ) => ReturnType<typeof calculateVkaEShift>;
}[];

describe.each(models)("$name shift results", ({ profile, calculate }) => {
  it("reuses equal SQL contents, invalidates edits/catalogs and keeps cash and payroll trace separate", () => {
    const shift = forecastShift({ id: "remaining-cache", date: "2026-10-20" });
    const resolver = { ...bundledRuleResolver };
    const first = calculate(shift, profile, resolver, false);
    expect(calculate({ ...shift }, structuredClone(profile), resolver, false)).toBe(first);
    const changed = calculate({ ...shift, endTime: "08:00" }, profile, resolver, false);
    expect(changed).not.toBe(first);
    expect(changed.netMinutes).toBeGreaterThan(first.netMinutes);
    expect(calculate(shift, profile, { ...resolver }, false)).not.toBe(first);
    const traced = calculate(shift, profile, resolver, true);
    const { payrollTrace, ...cash } = traced;
    expect(payrollTrace).toBeDefined();
    expect(cash).toEqual(first);
    expect(first.payrollTrace).toBeUndefined();
    expect(Object.isFrozen(first.premiumLines)).toBe(true);
    expect(Object.isFrozen(shift)).toBe(false);
    expect(Object.isFrozen(profile)).toBe(false);
  });
  it("retries missing holiday data with the same resolver instead of retaining a failure", () => {
    const empty = createRuleResolver({ tariff: [], legal: [], holiday: [] });
    let ready = false;
    const resolver: RuleResolver = {
      ...bundledRuleResolver,
      resolveHoliday: (...args) => (ready ? bundledRuleResolver : empty).resolveHoliday(...args),
    };
    const shift = forecastShift({ id: "retry-cache", date: "2026-10-20" });
    expect(() => calculate(shift, profile, resolver, false)).toThrow();
    ready = true;
    expect(calculate(shift, profile, resolver, false).netMinutes).toBeGreaterThan(0);
  });
});

it("separates TV-H paid alternating-shift breaks and Saturday options", () => {
  const profile = models[2].profile;
  const shift = forecastShift({ date: "2026-10-17", startTime: "13:00", endTime: "23:00" });
  const resolver = { ...bundledRuleResolver };
  const unpaid = calculateTvhKrShift(
    shift,
    profile,
    profile.tvhKrTariff!,
    { allowanceStatus: "NONE", saturdayShiftWork: false },
    resolver,
  );
  const paid = calculateTvhKrShift(
    shift,
    profile,
    profile.tvhKrTariff!,
    { allowanceStatus: "ALTERNATING_HOURLY", saturdayShiftWork: true },
    resolver,
  );
  expect(paid).not.toBe(unpaid);
  expect(paid.netMinutes).toBe(unpaid.netMinutes + shift.breakMinutes);
  expect(paid.hourlyAllowanceAmount).toBeGreaterThan(0);
});
