import { describe, expect, it } from "vitest";
import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { work } from "@/engine/remuneration-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { resolveCalendarSpecialDays } from "./calendar-special-days";

const profile = createWorkingTimeCalculationProfile(
  { ...work, federalState: "HE", sundayHolidayWorkEligible: true },
  null,
  [],
);
describe("calendar tariff special days from the target engine", () => {
  it.each(["2026-12", "2027-12"])(
    "keeps %s special days separate from statutory holidays",
    (month) => {
      const result = resolveCalendarSpecialDays(month, profile, bundledRuleResolver);
      expect(result.status).toBe("AVAILABLE");
      expect([...result.days.keys()]).toEqual([month + "-24", month + "-31"]);
      expect([...result.days.values()].every((day) => day.kind === "TARIFF_SPECIAL_DAY")).toBe(
        true,
      );
      expect([...result.days.values()].every((day) => day.status === "PROFILE_ESTIMATE")).toBe(
        true,
      );
    },
  );
  it("does not invent markers without a supported calculation profile", () => {
    expect(resolveCalendarSpecialDays("2026-12", work, bundledRuleResolver).days.size).toBe(0);
    const other = createWorkingTimeCalculationProfile({ ...work, tariff: null }, null, []);
    expect(resolveCalendarSpecialDays("2026-12", other, bundledRuleResolver).days.size).toBe(0);
    expect(resolveCalendarSpecialDays("2028-12", profile, bundledRuleResolver).days.size).toBe(0);
  });
  it("does not mark a normal month", () => {
    expect(resolveCalendarSpecialDays("2027-07", profile, bundledRuleResolver).days.size).toBe(0);
  });
  it.each(["loading", "error"] as const)(
    "reports a %s profile without rendering a claim",
    (status) => {
      const result = resolveCalendarSpecialDays(
        "2026-12",
        { ...profile, workingTimeTarget: { status, notices: [] } },
        bundledRuleResolver,
      );
      expect(result.status).toBe(status === "loading" ? "LOADING" : "UNAVAILABLE");
      expect(result.days.size).toBe(0);
    },
  );
  it("reports invalid histories visibly instead of crashing or guessing", () => {
    const p = {
      ...profile,
      workingTimeTarget: { ...profile.workingTimeTarget!, context: { periods: [], days: [] } },
    };
    const result = resolveCalendarSpecialDays("2026-12", p, bundledRuleResolver);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.days.size).toBe(0);
  });
  it("respects historical tariff boundaries without changing the profile", () => {
    const original = profile.workingTimeTarget!.context!.periods[0];
    const p = {
      ...profile,
      workingTimeTarget: {
        ...profile.workingTimeTarget!,
        context: {
          periods: [
            { ...original, validTo: "2026-12-24" },
            { ...original, validFrom: "2026-12-25", tariff: { kind: "CUSTOM" as const } },
          ],
          days: [],
        },
      },
    };
    const before = JSON.stringify(p);
    expect([...resolveCalendarSpecialDays("2026-12", p, bundledRuleResolver).days.keys()]).toEqual([
      "2026-12-24",
    ]);
    expect(JSON.stringify(p)).toBe(before);
  });
});
