import { describe, it, expect } from "vitest";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { newSpecialDuty } from "@/domain/special-duty";
import {
  changeRule,
  changeRuleForAllDates,
  rulesAt,
  emptyWorkplaceData,
  validateRule,
  type RuleSet,
} from "@/domain/workplace-rules";
import { topics, ruleInput, draftFor } from "@/features/workplace/questions";
import { calculateMonthlyCompliance } from "./compliance";
import { restFindingKeys } from "./workplace-resolution";
import { workplaceFindings } from "./workplace-check";
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
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
  ...extra,
});

const agreed = { source: "agreed", onRequest: false } as const;
function check(rules: RuleSet, entries: ShiftEntry[], period = "2026", exceptions: string[] = []) {
  return workplaceFindings(
    { handled: true, history: [{ from: "2026-01-01", rules }], exceptions },
    entries,
    period,
    "Europe/Berlin",
  );
}
describe("Ruhezeit mit betrieblicher Vereinbarung", () => {
  const rest = {
    mode: "rest",
    ...agreed,
    minutes: 540,
    duty: "regular",
    basis: "",
    compensation: "",
  } as const;
  const profile: UserProfile = {
    industry: "HEALTHCARE",
    federalState: "NW",
    holidayRegion: "NONE",
    weeklyMinutes: 2310,
    timeZone: "Europe/Berlin",
    regularRotatingNightWork: false,
    sundayHolidayWorkEligible: true,
    allEmploymentWorkRecorded: true,
    tariff: null,
    createdAt: "",
    updatedAt: "",
  };
  function run(
    startTime: string,
    rule: RuleSet["rest"] = rest,
    from = "2026-01-01",
    youth = false,
    extra: ShiftEntry[] = [],
  ) {
    const history = [{ from, rules: { rest: rule } }];
    const shifts = [
      shift("2026-10-06", { startTime: "14:00", endTime: "22:00" }),
      shift("2026-10-07", { startTime }),
      ...extra,
    ];
    const result = calculateMonthlyCompliance("2026-10", shifts, profile.timeZone, {
      employmentProfile: { ...profile, workplaceHistory: history },
      youthProtection: youth,
      referenceDate: "2026-11-21",
      allEmploymentWorkRecorded: true,
    });
    const legal = result.issues.filter(
      (i) =>
        i.rule.includes("REST_10H") || i.rule.includes("REST_11H") || i.rule === "JARBSCHG_13_REST",
    );
    const keys = new Set(restFindingKeys(legal));
    const local = check({ rest: rule }, shifts).filter(
      (f) => !keys.has(f.durationEvidenceKey ?? ""),
    );
    return { legal, local };
  }
  it.each(["07:00", "07:30", "08:30"])("accepts the binding floor at %s", (start) => {
    expect(run(start)).toEqual({ legal: [], local: [] });
  });
  it("shows one legal finding with the applicable 30-minute shortfall", () => {
    const { legal, local } = run("06:30");
    expect(local).toEqual([]);
    expect(legal).toHaveLength(1);
    expect(legal[0]).toMatchObject({
      workplaceRestMinimum: 540,
      facts: { minimumRestMinutes: 540, restMinutes: 510 },
    });
  });
  it("preserves applicable defaults for usual, out-of-scope, future and youth rules", () => {
    for (const result of [
      run("07:30", { ...rest, minutes: 480 }),
      run("07:30", { ...rest, source: "usual" }),
      run("07:30", { ...rest, duty: "standby" }),
      run("07:30", rest, "2026-10-08"),
      run("07:30", rest, undefined, true),
    ])
      expect(result.legal.some((i) => !i.workplaceRestMinimum)).toBe(true);
  });
  it("keeps the statutory compensation check for the ten-hour care preset", () => {
    const preset = validateRule("rest", ruleInput({ ...topics.rest.example, source: "agreed" }));
    expect(draftFor(preset).mode).toBe("short");
    expect(validateRule("rest", ruleInput(draftFor(preset)))).toEqual(preset);
    expect(run("08:30", preset).legal).toMatchObject([{ rule: "ARBZG_5_REST_11H" }]);
    expect(run("08:30", { ...rest, minutes: 600 }).legal).toMatchObject([
      { rule: "ARBZG_5_REST_11H" },
    ]);
  });
  it("retains stricter local protection and checks a defined compensation independently", () => {
    expect(run("09:00", { ...rest, minutes: 720 }).local).toHaveLength(1);
    expect(run("06:30", { ...rest, minutes: 720 }).legal[0]?.workplaceRestMinimum).toBe(720);
    const rule = { ...rest, makeup: { minutes: 720, days: 7 } };
    expect(run("07:30", rule).legal).toMatchObject([
      { rule: "ARBZG_5_REST_11H", severity: "critical" },
    ]);
    expect(run("07:30", rule, undefined, false, [shift("2026-10-08")]).legal).toEqual([]);
  });
  it("replaces the weekend recommendation only for covered dates and retains tariff checks", () => {
    const shifts = [3, 4, 10, 11, 17, 18, 24, 25, 31].map((day) =>
      shift("2026-10-" + String(day).padStart(2, "0")),
    );
    const month = (from: string) =>
      calculateMonthlyCompliance("2026-10", shifts, profile.timeZone, {
        employmentProfile: {
          ...profile,
          tariff: {
            sector: "BT_K",
            payGroup: "P8",
            payLevel: 4,
            tariffRegion: "OTHER",
            fullTimeWeeklyMinutes: 2310,
          },
          workplaceHistory: [
            { from, rules: { weekend: { mode: "alternate", anchor: null, ...agreed } } },
          ],
        },
        referenceDate: "2026-11-21",
        allEmploymentWorkRecorded: true,
        sundayHolidayWorkEligible: true,
      });
    const all = month("2026-01-01");
    expect(all.issues.some((i) => i.rule === "PLANNING_WEEKEND_RECOVERY")).toBe(false);
    const partial = month("2026-10-20");
    expect(partial.weekendAssessment?.windows.map((w) => !!w.workplaceRuleApplies)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(partial.issues.filter((i) => i.kind !== "PLANNING")).toEqual(
      all.issues.filter((i) => i.kind !== "PLANNING"),
    );
  });
  it("allocates each recovery interval once", () => {
    const rule = { ...rest, makeup: { minutes: 1000, days: 7 } };
    const { legal } = run("07:30", rule, undefined, false, [
      shift("2026-10-08", { startTime: "01:00", endTime: "09:00" }),
      shift("2026-10-09"),
    ]);
    expect(legal.filter((i) => i.rule === "ARBZG_5_REST_11H")).toHaveLength(1);
  });
});
describe("Betriebliche Sonderregelungen", () => {
  it("applies an all-period change to this rule only, including before the first entry", () => {
    const other = { ...agreed, mode: "limit" as const, count: 3 };
    const a = changeRule(
      changeRule(emptyWorkplaceData, "2026-04-01", "night", other),
      "2027-01-01",
      "series",
      other,
    );
    const r = { ...agreed, mode: "limit" as const, count: 7 };
    const result = changeRuleForAllDates(a, "series", r);
    expect(rulesAt(result.history, "2020-01-01")).toEqual({ series: r });
    expect(rulesAt(result.history, "2027-03-01")).toEqual({ night: other, series: r });
    const dated = changeRule(result, "2026-06-01", "series", other);
    expect(rulesAt(dated.history, "2026-05-31").series).toEqual(r);
    expect(rulesAt(dated.history, "2026-06-01").series).toEqual(other);
  });
  it("shows one occupied weekend and preserves individual exceptions when requested", () => {
    const weekend = { ...agreed, mode: "alternate" as const, anchor: null };
    const shifts = ["2026-11-14", "2026-11-21", "2026-11-22"].map((d) => shift(d));
    const rows = check({ weekend }, shifts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain("Zwei Wochenenden");
    expect(rows[0]?.periodStart).toBe("2026-11-14");
    expect(rows[0]?.evidence().map((s) => s.date)).toEqual(shifts.map((s) => s.date));
    const exceptions = check({ weekend: { ...weekend, onRequest: true } }, shifts);
    expect(exceptions).toHaveLength(2);
    expect(
      check({ weekend: { ...weekend, onRequest: true } }, shifts, "2026", [exceptions[0]!.key]).map(
        (row) => row.confirmed,
      ),
    ).toEqual([true, false]);
  });
  it("counts starts once across Monday and the first of the month", () => {
    const entries = ["2026-05-30", "2026-05-31", "2026-06-01"].map((d) => shift(d));
    const same = shift("2026-05-31", { id: "extra", startTime: "17:00", endTime: "19:00" });
    const rule = { ...agreed, mode: "limit", count: 2 } as const;
    expect(
      check({ series: rule, week: rule }, [...entries, same], "2026-06").map((f) => f.text),
    ).toEqual(["3 Arbeitstage am Stück · vereinbart: höchstens 2"]);
  });
  it("accepts six days in a week with a four-week average of five", () => {
    const data = Array.from({ length: 21 }, (_, i) =>
      shift("2026-06-" + String(i + 1).padStart(2, "0")),
    );
    const rules: RuleSet = {
      week: validateRule("week", ruleInput({ ...topics.week.example, source: "agreed" })),
    };
    expect(check(rules, data.slice(0, 6))).toHaveLength(0);
    expect(check(rules, data)).toHaveLength(1);
  });
  it("checks complete free weekends across months, including Friday nights", () => {
    const nights = ["2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20"].map((d) =>
      shift(d, { type: "NIGHT", startTime: "22:00", endTime: "06:00" }),
    );
    expect(
      check({ weekend: { ...agreed, mode: "monthly", count: 2 } }, nights.slice(0, 3), "2026-11"),
    ).toHaveLength(0);
    expect(
      check({ weekend: { ...agreed, mode: "monthly", count: 2 } }, nights, "2026-11"),
    ).toHaveLength(1);
    expect(
      check({ weekend: { ...agreed, mode: "alternate", anchor: "2026-10-31" } }, nights, "2026-11"),
    ).toHaveLength(2);
  });
  it("counts full recovery days from the end of the final night", () => {
    const nights = ["2026-06-05", "2026-06-06", "2026-06-07"].map((d) =>
      shift(d, { type: "NIGHT", startTime: "22:00", endTime: "06:00" }),
    );
    const rule = validateRule(
      "recovery",
      ruleInput({ ...topics.recovery.example, source: "usual" }),
    );
    expect(check({ recovery: rule }, [...nights, shift("2026-06-10")])[0]?.text).toContain(
      "1 voller Kalendertag",
    );
    expect(check({ recovery: rule }, [...nights, shift("2026-06-11")])).toHaveLength(0);
  });
  it("binds an exception to the same finding and shift revision", () => {
    const rule = { ...agreed, mode: "off", onRequest: true } as const;
    const shifts = ["2026-06-02", "2026-06-03"].map((d) => shift(d, { type: "NIGHT" }));
    const findings = check({ night: rule }, shifts);
    expect(
      check({ night: rule }, shifts, "2026", [findings[0]!.key]).map((f) => f.confirmed),
    ).toEqual([true, false]);
    expect(
      check({ night: rule }, [{ ...shifts[0]!, revision: 2 }], "2026", [findings[0]!.key])[0]
        ?.confirmed,
    ).toBe(false);
  });
  it("keeps day counts and exposes incomplete duration evidence at the autumn clock change", () => {
    const entry = shift("2026-10-25", { startTime: "02:30", endTime: "09:00" });
    const rest = {
      ...agreed,
      mode: "rest",
      duty: "all",
      minutes: 660,
      basis: "",
      compensation: "",
    } as const;
    expect(check({ rest }, [entry])[0]?.text).toContain("Zeitumstellung");
  });
  it.each([
    ["06:29", true],
    ["06:30", false],
    ["07:00", false],
    ["08:00", false],
  ] as const)(
    "only flags a gap below the agreed nine hours (next start %s)",
    (startTime, expected) => {
      const previous = shift("2026-10-26", { startTime: "13:18", endTime: "21:30" });
      const next = shift("2026-10-27", { startTime });
      const data = changeRuleForAllDates(emptyWorkplaceData, "rest", {
        ...agreed,
        mode: "rest",
        minutes: 540,
        duty: "regular",
        basis: "",
        compensation: "",
        onRequest: true,
      });
      for (const period of ["2026-10", "2026"]) {
        const findings = workplaceFindings(data, [previous, next], period, "Europe/Berlin");
        if (expected) {
          expect(findings).toHaveLength(1);
          expect(findings[0]).toMatchObject({
            topic: "rest",
            title: "8 Std. 59 Min. Ruhezeit",
            canConfirm: false,
          });
          expect(findings[0]?.evidence()).toEqual([previous, next]);
        } else expect(findings).toEqual([]);
      }
    },
  );
  it("checks a local duration per service even on a day with two shifts", () => {
    const entries = [
      shift("2026-06-02", { startTime: "06:00", endTime: "12:00" }),
      shift("2026-06-02", { id: "late", startTime: "15:00", endTime: "21:00" }),
    ];
    expect(
      check(
        {
          duration: {
            ...agreed,
            mode: "duration",
            minutes: 420,
            duty: "all",
            gross: true,
            basis: "",
          },
        },
        entries,
      ),
    ).toHaveLength(0);
  });
  it("checks actual calls independently of the on-call window and of standby duty", () => {
    const duty = newSpecialDuty("ON_CALL", "08:00", "20:00", "Europe/Berlin");
    const rule = {
      ...agreed,
      mode: "duration",
      duty: "callout",
      gross: true,
      basis: "",
      minutes: 60,
    } as const;
    const base = shift("2026-06-10", {
      startTime: "08:00",
      endTime: "20:00",
      specialDuty: { ...duty, calloutsComplete: true },
    });
    expect(check({ duration: rule }, [base])).toHaveLength(0);
    const call = {
      kind: "ON_SITE",
      start: 600,
      end: 660,
      departure: 590,
      returned: 670,
      breakMinutes: 0,
    } as const;
    expect(
      check({ duration: rule }, [
        { ...base, specialDuty: { ...duty, calloutsComplete: true, callouts: [call] } },
      ])[0]?.text,
    ).toContain("80 Minuten");
    expect(
      check({ duration: rule }, [{ ...base, specialDuty: { ...duty, kind: "STANDBY" } }]),
    ).toHaveLength(0);
  });
  it("checks the latest revision and ignores a deleted shift", () => {
    const earlier = shift("2026-06-10", { type: "NIGHT" });
    const rule = { ...agreed, mode: "off" } as const;
    expect(
      check({ night: rule }, [{ ...earlier, revision: 2, deletedAt: "2026-06-11" }, earlier]),
    ).toHaveLength(0);
  });
  it("compares a twelve-hour service with and without included breaks", () => {
    const entries = [
      shift("2026-05-10", { startTime: "06:00", endTime: "18:00", breakMinutes: 120 }),
    ];
    const rule = {
      ...agreed,
      mode: "duration",
      duty: "regular",
      gross: false,
      basis: "Dienstvereinbarung",
      minutes: 600,
    } as const;
    expect(check({ duration: rule }, entries)).toHaveLength(0);
    expect(check({ duration: { ...rule, gross: true } }, entries)[0]?.text).toContain(
      "720 Minuten mit Pausen",
    );
    expect(
      check({ duration: { ...rule, gross: true, minutes: 720 } }, [
        { ...entries[0]!, breakMinutes: 30 },
      ]),
    ).toHaveLength(0);
  });
  it("distinguishes an undesired switch from statutory rest and respects the effective date", () => {
    const entries = [
      shift("2026-05-10", { type: "LATE", endTime: "20:00" }),
      shift("2026-05-11", { type: "EARLY", startTime: "07:00" }),
    ];
    const switchRule = validateRule(
      "switch",
      ruleInput({ ...topics.switch.example, source: "usual" }),
    );
    const before = changeRule(emptyWorkplaceData, "2026-05-12", "switch", switchRule);
    expect(workplaceFindings(before, entries, "2026", "Europe/Berlin")).toHaveLength(0);
    expect(
      check(
        {
          switch: switchRule,
          rest: { ...agreed, mode: "rest", minutes: 660, duty: "all", basis: "", compensation: "" },
        },
        entries,
      ).map((f) => f.text),
    ).toEqual(["Eingetragener Dienstwechsel · bei euch üblich: diesen Wechsel vermeiden"]);
  });
});
