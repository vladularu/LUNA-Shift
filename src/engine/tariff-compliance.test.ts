import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { checkTariffWorkingTimeSteps } from "./tariff-compliance";
import { captureEmploymentProfile } from "@/domain/employment-history";
import { newSpecialDuty } from "@/domain/special-duty";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import * as tariffContexts from "./tariff-compliance-context";

const profile: UserProfile = {
  federalState: "NW",
  holidayRegion: "NONE",
  weeklyMinutes: 2310,
  timeZone: "Europe/Berlin",
  regularRotatingNightWork: null,
  sundayHolidayWorkEligible: true,
  allEmploymentWorkRecorded: true,
  tariff: {
    payGroup: "P8",
    payLevel: 4,
    sector: "BT_K",
    tariffRegion: "OTHER",
    fullTimeWeeklyMinutes: 2310,
  },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const shift = (date: string, extra: Partial<ShiftEntry> = {}): ShiftEntry => ({
  kind: "SHIFT",
  id: date,
  date,
  templateId: null,
  title: "Tag",
  type: "DAY",
  startTime: "08:00",
  endTime: "16:00",
  breakMinutes: 30,
  color: "#000000",
  symbol: "sun",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
  deletedAt: null,
  ...extra,
});
const days = (start: string, count: number) =>
  Array.from({ length: count }, (_, n) =>
    shift(Temporal.PlainDate.from(start).add({ days: n }).toString()),
  );
function calculate(
  shifts: readonly ShiftEntry[],
  p = profile,
  month = "2026-08",
  referenceDate = "2026-09-20",
) {
  const generator = checkTariffWorkingTimeSteps(month, shifts, p.timeZone, {
    employmentProfile: p,
    referenceDate,
  });
  while (true) {
    const result = generator.next();
    if (result.done) return result.value;
  }
}

describe("tariff rules integrated as legal findings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not resolve any tariff calendar for an empty recorded-work window", () => {
    const lookup = vi.spyOn(tariffContexts, "tariffContextAt");
    expect(calculate([])).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("checks recorded days for scope but skips all impossible sparse-calendar candidates", () => {
    const lookup = vi.spyOn(tariffContexts, "tariffContextAt");
    const shifts = [
      "2026-08-03",
      "2026-08-04",
      "2026-08-10",
      "2026-08-11",
      "2026-08-17",
      "2026-08-18",
      "2026-08-24",
      "2026-08-25",
    ].map((date) => shift(date));
    expect(calculate(shifts)).toEqual([]);
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(shifts.length);
  });

  it("retains an explicit persisted-context scope finding before a five-day early exit", () => {
    const calculated = createWorkingTimeCalculationProfile(profile, null, []);
    const p = {
      ...calculated,
      workingTimeTarget: { ...calculated.workingTimeTarget!, status: "error" as const },
    };
    const lookup = vi.spyOn(tariffContexts, "tariffContextAt");
    const shifts = days("2026-08-03", 3);
    const result = calculate(shifts, p);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("TARIFF_SCOPE");
    expect(result[0].tariff?.status).toBe("UNAVAILABLE");
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(shifts.length);
  });

  it("does not create missing-scope notices for an ordinary five-day week", () => {
    expect(calculate(days("2026-08-03", 5))).toEqual([]);
  });

  it("does not create a legal finding from six recorded days alone", () => {
    const result = calculate(days("2026-08-03", 6));
    expect(result).toEqual([]);
  });

  it("reviews two occupied Sundays even with only two recorded duties", () => {
    const result = calculate([shift("2026-08-09"), shift("2026-08-16")]);
    const sunday = result.find((item) => item.rule === "TARIFF_FREE_SUNDAY");
    expect(sunday).toMatchObject({
      kind: "LEGAL",
      severity: "info",
      date: "2026-08-16",
      relatedShiftIds: ["2026-08-09", "2026-08-16"],
      tariff: {
        ruleId: "TARIFF_FREE_SUNDAY",
        status: "REVIEW",
        count: 2,
        recordedDates: ["2026-08-09", "2026-08-16"],
        period: { from: "2026-08-03", until: "2026-08-16" },
        source: { section: "§ 49 Abs. 3" },
      },
    });
    expect(sunday?.description).toContain("Beobachtungszeitraum");
    expect(sunday?.description).not.toMatch(/Verstoß|verletzt|überschritten/);
    expect(sunday?.tariff?.ruleText).toContain("soll");
    expect(sunday?.tariff?.requirements.join(" ")).toMatch(/Bezugszeitraum/);
    expect(result.some((item) => item.rule === "TARIFF_FREE_DAYS")).toBe(false);
  });

  it.each([true, false, null])(
    "does not mistake Sunday eligibility %s for regular Sunday work",
    (sundayHolidayWorkEligible) => {
      const sunday = calculate([shift("2026-08-09"), shift("2026-08-16")], {
        ...profile,
        sundayHolidayWorkEligible,
      }).find((item) => item.rule === "TARIFF_FREE_SUNDAY");
      expect(sunday?.tariff?.requirements.join(" ")).toMatch(/regelmäßig/);
      expect(sunday?.tariff?.requirements.join(" ")).toMatch(/Geltungsbereich/);
      expect(sunday?.tariff?.status).toBe("REVIEW");
    },
  );

  it("keeps the Sunday observation pending until its second Sunday has passed", () => {
    const result = calculate(
      [shift("2026-08-09"), shift("2026-08-16")],
      profile,
      "2026-08",
      "2026-08-16",
    );
    expect(result.find((item) => item.rule === "TARIFF_FREE_SUNDAY")?.tariff?.status).toBe(
      "PENDING",
    );
  });

  it("does not infer Sunday work from one duty or whole on-call availability", () => {
    const duty = newSpecialDuty("ON_CALL", "08:00", "08:00", profile.timeZone);
    const result = calculate([
      shift("2026-08-09"),
      shift("2026-08-16", {
        endTime: "08:00",
        specialDuty: { ...duty, calloutsComplete: true },
      }),
    ]);
    expect(result.some((item) => item.rule === "TARIFF_FREE_SUNDAY")).toBe(false);
    expect(calculate([shift("2026-08-09")])).toEqual([]);
  });

  it("uses actual overnight intersections for both Sundays but excludes midnight endpoints", () => {
    const overnight = ["2026-08-08", "2026-08-15"].map((date) =>
      shift(date, { startTime: "22:00", endTime: "06:00", type: "NIGHT" }),
    );
    const sunday = calculate(overnight).find((item) => item.rule === "TARIFF_FREE_SUNDAY");
    expect(sunday?.tariff?.recordedDates).toEqual(["2026-08-09", "2026-08-16"]);
    expect(
      calculate(overnight.map((item) => ({ ...item, endTime: "00:00" }))).some(
        (item) => item.rule === "TARIFF_FREE_SUNDAY",
      ),
    ).toBe(false);
  });

  it("keeps a cross-month Sunday observation in the month of its second Sunday", () => {
    const entries = [shift("2026-08-30"), shift("2026-09-06")];
    expect(
      calculate(entries, profile, "2026-08").some((item) => item.rule === "TARIFF_FREE_SUNDAY"),
    ).toBe(false);
    const sunday = calculate(entries, profile, "2026-09").find(
      (item) => item.rule === "TARIFF_FREE_SUNDAY",
    );
    expect(sunday?.tariff?.period).toEqual({ from: "2026-08-24", until: "2026-09-06" });
    expect(sunday?.assessmentRanges).toEqual([{ from: "2026-08-24", through: "2026-09-07" }]);
  });

  it("does not apply a free-Sunday tariff norm without its reviewed employer scope", () => {
    const entries = [shift("2026-08-09"), shift("2026-08-16")];
    const p = {
      ...profile,
      tariff: null,
      tvalPflegeTariff: {
        trainingYear: 1 as const,
        universityRegion: "WEST" as const,
        employerScope: null,
      },
    };
    expect(calculate(entries, p).some((item) => item.rule === "TARIFF_FREE_SUNDAY")).toBe(false);
  });

  it("reviews all seven recorded week dates against a six-day tariff ceiling without alleging a violation", () => {
    const result = calculate(days("2026-08-03", 7));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "LEGAL", severity: "info", date: "2026-08-09" });
    expect(result[0].tariff).toMatchObject({ status: "REVIEW", count: 7, limit: 6 });
    expect(result[0].tariff?.period).toEqual({ from: "2026-08-03", until: "2026-08-09" });
    expect(result[0].description).not.toMatch(/Verstoß|verletzt|überschritten/);
  });

  it("keeps seven days in one week distinct from seven spanning two weeks", () => {
    expect(
      calculate(days("2026-08-03", 7)).filter((i) => i.rule === "TARIFF_WEEK_DAYS"),
    ).toHaveLength(1);
    expect(
      calculate(days("2026-08-05", 7)).filter((i) => i.rule === "TARIFF_WEEK_DAYS"),
    ).toHaveLength(0);
  });

  it("counts both touched calendar dates of an overnight shift", () => {
    const result = calculate([
      ...days("2026-08-03", 5),
      shift("2026-08-08", { type: "NIGHT", startTime: "22:00", endTime: "06:00" }),
    ]);
    const week = result.find((i) => i.rule === "TARIFF_WEEK_DAYS")!;
    expect(week.tariff?.count).toBe(7);
    expect(week.relatedShiftIds).toHaveLength(6);
  });

  it("does not count a midnight endpoint as work on the next day", () => {
    const result = calculate([
      ...days("2026-08-03", 5),
      shift("2026-08-08", { startTime: "16:00", endTime: "00:00" }),
    ]);
    expect(result.find((i) => i.rule === "TARIFF_WEEK_DAYS")).toBeUndefined();
  });

  it("does not count deleted, all-day absence, duplicate IDs or paid overtime twice", () => {
    const result = calculate([
      ...days("2026-08-03", 5),
      shift("2026-08-08", { deletedAt: profile.updatedAt }),
      shift("2026-08-09", { type: "FREE", allDay: true }),
      shift("2026-08-07", { overtimeMinutes: 120 }),
    ]);
    expect(result).toEqual([]);
  });

  it("does not prove work on a short midnight slice fully coverable by an unlocated pause", () => {
    const result = calculate([
      ...days("2026-08-03", 5),
      shift("2026-08-08", {
        type: "NIGHT",
        startTime: "23:50",
        endTime: "06:00",
        breakMinutes: 30,
      }),
    ]);
    expect(result.find((i) => i.rule === "TARIFF_WEEK_DAYS")).toBeUndefined();
  });

  it("uses TV-L's stronger wording and does not relabel it as TVöD", () => {
    const p = {
      ...profile,
      tariff: null,
      tvlKrTariff: {
        payGroup: "KR8" as const,
        payLevel: 4 as const,
        universityRegion: "WEST" as const,
      },
    };
    expect(calculate(days("2026-08-03", 6), p)).toEqual([]);
    expect(calculate(days("2026-08-03", 7), p)[0].tariff?.ruleText).toMatch(/dringende/);
  });

  it("does not impose a fixed five-day cap on one UK six-day week", () => {
    const p = {
      ...profile,
      tariff: null,
      tvUkNursingTariff: { payGroup: "PUK8" as const, payLevel: 4 as const },
    };
    const result = calculate(days("2026-08-03", 6), p);
    expect(result).toEqual([]);
    const seven = calculate(days("2026-08-03", 7), p)[0];
    expect(seven.tariff?.ruleText).toMatch(/durchschnittlich/);
    expect(seven.tariff).toMatchObject({ status: "REVIEW", limit: 6 });
    expect(seven.description).not.toMatch(/überschritten|verletzt/);
  });

  it("finds too little possible free time without calling blank days confirmed free", () => {
    const result = calculate(days("2026-08-03", 13));
    const finding = result.find((i) => i.rule === "TARIFF_FREE_DAYS");
    expect(finding?.tariff?.status).toBe("REVIEW");
    expect(finding?.tariff?.requirements.join(" ")).toMatch(/Bezugszeitraum/);
  });

  it("distinguishes possible two-day blocks from two isolated free days for TV-UK", () => {
    const p = {
      ...profile,
      tariff: null,
      tvUkNursingTariff: { payGroup: "PUK8" as const, payLevel: 4 as const },
    };
    const fortnight = days("2026-08-03", 14);
    const isolated = fortnight.filter((_, n) => n !== 4 && n !== 10);
    const together = fortnight.filter((_, n) => n !== 5 && n !== 6);
    expect(calculate(isolated, p).some((i) => i.rule === "TARIFF_FREE_DAYS")).toBe(true);
    expect(calculate(together, p).some((i) => i.rule === "TARIFF_FREE_DAYS")).toBe(false);
  });

  it("does not make the youth checkbox an adulthood confirmation", () => {
    const gen = checkTariffWorkingTimeSteps("2026-08", days("2026-08-03", 7), profile.timeZone, {
      employmentProfile: profile,
      youthProtection: true,
    });
    let result = gen.next();
    while (!result.done) result = gen.next();
    expect(result.value).toEqual([]);
  });

  it("holds an unfinished observed week pending", () => {
    const result = calculate(days("2026-08-03", 7), profile, "2026-08", "2026-08-08");
    expect(result[0].tariff?.status).toBe("PENDING");
  });

  it("carries a week across a month boundary and yields before bulk work completes", () => {
    const shifts = days("2026-08-31", 7);
    const august = calculate(shifts, profile, "2026-08");
    const september = calculate(shifts, profile, "2026-09");
    expect(august.find((i) => i.rule === "TARIFF_WEEK_DAYS")).toBeUndefined();
    expect(september.find((i) => i.rule === "TARIFF_WEEK_DAYS")?.tariff?.count).toBe(7);
    expect(september.find((i) => i.rule === "TARIFF_WEEK_DAYS")?.assessmentRanges).toEqual([
      { from: "2026-08-31", through: "2026-09-07" },
    ]);
    expect(
      checkTariffWorkingTimeSteps("2026-08", shifts, profile.timeZone, {
        employmentProfile: profile,
      }).next().done,
    ).toBe(false);
  });

  it("keeps mixed tariff weeks reviewable instead of assigning the last tariff to all days", () => {
    const old: UserProfile = {
      ...profile,
      tariff: null,
      tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
    };
    const p: UserProfile = {
      ...profile,
      employmentTimeline: [
        {
          effectiveFrom: null,
          employment: captureEmploymentProfile(old),
          data: { version: 1, weeklyMinutes: 2310, selection: { kind: "unconfigured" } },
          revision: 1,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        },
        {
          effectiveFrom: "2026-08-06",
          employment: captureEmploymentProfile(profile),
          data: { version: 1, weeklyMinutes: 2310, selection: { kind: "unconfigured" } },
          revision: 1,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        },
      ],
    };
    const result = calculate(days("2026-08-03", 7), p);
    expect(result[0].tariff?.requirements.join(" ")).toMatch(/Tarifzuordnung/);
    expect(result[0].tariff?.status).toBe("REVIEW");
  });

  it("keeps touched dates stable over the autumn clock change", () => {
    const shifts = [
      ...days("2026-10-19", 5),
      shift("2026-10-24", { type: "NIGHT", startTime: "22:00", endTime: "06:00" }),
    ];
    const result = calculate(shifts, profile, "2026-10", "2026-11-03");
    expect(result[0].tariff?.recordedDates).toContain("2026-10-25");
    expect(result[0].tariff?.count).toBe(7);
  });

  it("does not treat whole on-call availability as observed work without callouts", () => {
    const duty = newSpecialDuty("ON_CALL", "08:00", "08:00", profile.timeZone);
    const result = calculate([
      ...days("2026-08-03", 5),
      shift("2026-08-08", { specialDuty: { ...duty, calloutsComplete: true }, endTime: "08:00" }),
    ]);
    expect(result).toEqual([]);
  });

  it("counts actual on-call travel and service touching another calendar day", () => {
    const duty = newSpecialDuty("ON_CALL", "08:00", "08:00", profile.timeZone);
    const result = calculate([
      ...days("2026-08-03", 5),
      shift("2026-08-08", {
        specialDuty: {
          ...duty,
          calloutsComplete: true,
          callouts: [
            {
              start: 1430,
              end: 1450,
              departure: 1420,
              returned: 1460,
              breakMinutes: 0,
              kind: "ON_SITE",
            },
          ],
        },
        endTime: "08:00",
      }),
    ]);
    expect(result[0].tariff?.count).toBe(7);
  });

  it("shows one targeted coverage notice for an unreviewed year even with few duties", () => {
    const result = calculate(days("2027-01-04", 3), profile, "2027-01", "2027-02-01");
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("TARIFF_SCOPE");
    expect(result[0].tariff?.status).toBe("UNAVAILABLE");
  });

  it("does not impose regular Sunday-work rules after an explicit negative answer", () => {
    const result = calculate(days("2026-08-03", 13), {
      ...profile,
      sundayHolidayWorkEligible: false,
    });
    expect(result.some((issue) => issue.rule === "TARIFF_FREE_DAYS")).toBe(false);
  });

  it("retains earlier unconfirmed scope inside a later-confirmed same-family week", () => {
    const calculated = createWorkingTimeCalculationProfile(profile, null, []);
    const target = calculated.workingTimeTarget!;
    const period = target.context!.periods[0];
    const p = {
      ...calculated,
      workingTimeTarget: {
        ...target,
        mode: "ROSTER" as const,
        context: {
          ...target.context!,
          periods: [
            {
              ...period,
              validTo: "2026-08-05",
              tariff: { kind: "TVOED_K" as const, version: "2026-01-01", scopeConfirmed: null },
            },
            {
              ...period,
              validFrom: "2026-08-06",
              tariff: { kind: "TVOED_K" as const, version: "2026-01-01", scopeConfirmed: true },
            },
          ],
        },
      },
    };
    const result = calculate(days("2026-08-03", 7), p);
    const requirements = result[0].tariff!.requirements.join(" ");
    expect(requirements).toMatch(/Teilzeiträume/);
    expect(requirements).toMatch(/Geltungsbereich/);
  });

  it("yields bounded progress with an active tariff and a thousand recorded duties", () => {
    const shifts = Array.from({ length: 1000 }, (_, n) =>
      shift(
        Temporal.PlainDate.from("2026-07-01")
          .add({ days: n % 90 })
          .toString(),
        { id: `stress-${n}` },
      ),
    );
    const generator = checkTariffWorkingTimeSteps("2026-08", shifts, profile.timeZone, {
      employmentProfile: profile,
      referenceDate: "2026-10-01",
    });
    let previous = -1;
    let yields = 0;
    let maxStep = 0;
    while (true) {
      const started = performance.now();
      const step = generator.next();
      maxStep = Math.max(maxStep, performance.now() - started);
      if (step.done) {
        expect(step.value.some((issue) => issue.rule === "TARIFF_WEEK_DAYS")).toBe(true);
        expect(step.value.some((issue) => issue.rule === "TARIFF_FREE_DAYS")).toBe(true);
        break;
      }
      expect(step.value).toBeGreaterThan(previous);
      if (previous >= 0) expect(step.value - previous).toBeLessThanOrEqual(8);
      previous = step.value;
      yields++;
    }
    expect(yields).toBeGreaterThan(1000 / 4);
    expect(maxStep).toBeLessThan(250);
  });
});
