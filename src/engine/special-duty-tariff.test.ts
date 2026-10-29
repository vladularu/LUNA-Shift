import { describe, expect, it } from "vitest";
import {
  standbyNormalFactor,
  onCallBaseHours,
  onCallPaidMinutes,
  dutyTariffFamily,
} from "./special-duty-tariff";
import { work } from "./remuneration-test-fixtures";

describe("dated standby rule reference cases (not full payroll)", () => {
  it.each([
    ["I", 0.6],
    ["II", 0.75],
    ["III", 0.9],
  ] as const)("uses TVöD BT-K %s", (level, expected) => {
    expect(
      standbyNormalFactor({
        family: "TVOED_K",
        level,
        ordinal: null,
        date: "2026-10-29",
        normalCaseConfirmed: true,
      }),
    ).toBe(expected);
  });
  it.each(["TVOED_B", "TVL_43", "TVH_43"] as const)(
    "checks service count boundaries for %s",
    (family) => {
      expect(
        [8, 9, 12, 13].map((ordinal) =>
          standbyNormalFactor({
            family,
            level: "B",
            ordinal,
            date: "2026-10-29",
            normalCaseConfirmed: true,
          }),
        ),
      ).toEqual([0.5, 0.6, 0.6, 0.7]);
    },
  );
  it("uses current TV-UK factors and leaves unknown arrangements open", () => {
    expect(
      standbyNormalFactor({
        family: "TVUK",
        level: "I",
        ordinal: null,
        date: "2026-10-29",
        normalCaseConfirmed: true,
      }),
    ).toBe(0.7);
    expect(
      standbyNormalFactor({
        family: "TVUK",
        level: "II",
        ordinal: null,
        date: "2026-10-29",
        normalCaseConfirmed: true,
      }),
    ).toBe(0.9);
    expect(
      standbyNormalFactor({
        family: "TVUK",
        level: "I",
        ordinal: null,
        date: "2024-10-29",
        normalCaseConfirmed: true,
      }),
    ).toBeNull();
    expect(
      standbyNormalFactor({
        family: "TVOED_B",
        level: "A",
        ordinal: null,
        date: "2026-10-29",
        normalCaseConfirmed: true,
      }),
    ).toBeNull();
    expect(
      standbyNormalFactor({
        family: "TVOED_K",
        level: "I",
        ordinal: null,
        date: "2026-10-29",
        normalCaseConfirmed: false,
      }),
    ).toBeNull();
  });
  it("distinguishes actual from started hours and the 12-hour threshold", () => {
    expect(onCallBaseHours("TVOED_K", 90, false)).toBe(0.1875);
    expect(onCallBaseHours("TVL_43", 90, false)).toBe(0.25);
    expect(onCallBaseHours("TVH_43", 719, false)).toBe(1.5);
    expect(onCallBaseHours("TVH_43", 720, false)).toBe(2);
    expect(onCallBaseHours("TVOED_B", 720, true)).toBe(4);
    expect(onCallBaseHours("TVUK", 720, true)).toBe(1.5);
    expect(onCallBaseHours("TVL_43", 2880, false)).toBeNull();
  });
  it("rounds external events individually and remote events together", () => {
    expect(onCallPaidMinutes("TVOED_K", [25, 35], [10, 5])).toBe(180);
    expect(onCallPaidMinutes("TVL_43", [25, 35], [10, 5])).toBe(150);
    expect(onCallPaidMinutes("TVH_43", [], [20, 20])).toBe(60);
    expect(onCallPaidMinutes("TVUK", [25, 35], [10, 5])).toBe(230);
  });
  it("keeps training referrals dependent on the employer scope", () => {
    expect(dutyTariffFamily(work)).toBe("TVOED_K");
    expect(
      dutyTariffFamily({
        ...work,
        tariff: null,
        tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST", employerScope: "GENERAL" },
      }),
    ).toBeNull();
    expect(
      dutyTariffFamily({
        ...work,
        tariff: null,
        tvalPflegeTariff: {
          trainingYear: 1,
          universityRegion: "WEST",
          employerScope: "SECTION_43",
        },
      }),
    ).toBe("TVL_43");
  });
});
