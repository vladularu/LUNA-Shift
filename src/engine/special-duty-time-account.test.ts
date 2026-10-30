import { describe, expect, it } from "vitest";
import type { ShiftEntry } from "@/domain/types";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlySummary } from "./monthly-summary";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { formatPreciseMinutes } from "./working-time";

function standby(settlement: "PAY" | "TIME_OFF" = "TIME_OFF"): ShiftEntry {
  return forecastShift({
    id: "standby-credit",
    date: "2026-12-09",
    type: "CUSTOM",
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 30,
    specialDuty: {
      ...newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
      version: 2,
      standbyLevel: "II",
      settlement,
      standbyAgreement: {
        ...newStandbyAgreement("TVOED_K"),
        rule: "STANDARD",
        timeOffMode: "WEIGHTED",
      },
    },
  });
}
const summary = (entries: readonly ShiftEntry[]) =>
  calculateMonthlySummary("2026-12", entries, forecastProfile, resolver);

describe("derived special-duty time account", () => {
  it("keeps full recorded work while crediting only agreed weighted time", () => {
    const entry = standby(),
      before = JSON.stringify(entry),
      value = summary([entry]);
    expect(value.actualMinutes).toBe(450);
    expect(value.work.minutes).toBe(450);
    expect(value.timeAccountMinutes).toBe(337.5);
    expect(formatPreciseMinutes(value.timeAccountMinutes!)).toBe("5:37:30");
    expect(value.balanceMinutes).toBe(337.5 - value.targetMinutes);
    expect(value.specialDutyNotes).toBeUndefined();
    expect(value.specialDutyTimeCredits![0]).toMatchObject({
      recordedMinutes: 450,
      creditedMinutes: 337.5,
    });
    expect(JSON.stringify(entry)).toBe(before);
  });
  it("never posts a second credit for a separately paid duty", () => {
    const ordinary = forecastShift({
      id: "ordinary",
      date: "2026-12-08",
      startTime: "08:00",
      endTime: "12:00",
      breakMinutes: 0,
    });
    const value = summary([ordinary, standby("PAY")]);
    expect(value.actualMinutes).toBe(690);
    expect(value.timeAccountMinutes).toBe(240);
    expect(value.balanceMinutes).toBe(240 - value.targetMinutes);
  });
  it("is idempotent for refreshes and duplicate references", () => {
    const entry = standby();
    expect(summary([entry, entry]).timeAccountMinutes).toBe(337.5);
    expect(summary([entry])).toEqual(summary([entry]));
  });
  it("replaces credits on edits, deletion and restore without accumulating bookings", () => {
    const entry = standby();
    expect(summary([entry]).timeAccountMinutes).toBe(337.5);
    expect(
      summary([{ ...entry, specialDuty: { ...entry.specialDuty!, settlement: "PAY" } }])
        .timeAccountMinutes,
    ).toBe(0);
    const removed = summary([{ ...entry, deletedAt: "2026-12-10T08:00:00Z" }]);
    expect(removed.timeAccountMinutes ?? removed.actualMinutes).toBe(0);
    expect(summary([entry]).timeAccountMinutes).toBe(337.5);
  });
  it("leaves an unknown agreement open instead of silently posting zero", () => {
    const entry = standby(),
      value = summary([
        {
          ...entry,
          specialDuty: {
            ...entry.specialDuty!,
            standbyAgreement: { ...entry.specialDuty!.standbyAgreement!, rule: "UNKNOWN" },
          },
        },
      ]);
    expect(value.timeAccountMinutes).toBeNull();
    expect(value.specialDutyNotes?.length).toBeGreaterThan(0);
    expect(value.actualMinutes).toBe(450);
  });
  it("does not double-credit overlapping ordinary and standby work", () => {
    const value = summary([
      standby(),
      forecastShift({
        id: "other",
        date: "2026-12-09",
        startTime: "10:00",
        endTime: "11:00",
        breakMinutes: 0,
      }),
    ]);
    expect(value.timeAccountMinutes).toBeNull();
    expect(value.specialDutyNotes?.join(" ")).toContain("überschneiden");
  });
  it("credits no inactive on-call hours even when time off is selected", () => {
    const entry = forecastShift({
      id: "idle",
      date: "2026-12-05",
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "08:00", "16:00", "Europe/Berlin"),
        calloutsComplete: true,
        settlement: "TIME_OFF",
      },
    });
    const value = summary([entry]);
    expect(value.actualMinutes).toBe(0);
    expect(value.timeAccountMinutes).toBe(0);
    expect(value.specialDutyNotes).toBeUndefined();
  });
  it("requires the callout settlement and uses monetary rounding only in the agreed credit", () => {
    const entry = forecastShift({
      id: "call",
      date: "2026-12-07",
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "08:00", "16:00", "Europe/Berlin"),
        calloutsComplete: true,
        callouts: [
          { kind: "REMOTE", departure: 600, start: 600, end: 610, returned: 610, breakMinutes: 0 },
        ],
      },
    });
    expect(summary([entry]).timeAccountMinutes).toBeNull();
    const value = summary([
      { ...entry, specialDuty: { ...entry.specialDuty!, settlement: "TIME_OFF" } },
    ]);
    expect(value.actualMinutes).toBe(10);
    expect(value.timeAccountMinutes).toBe(78);
    expect(value.specialDutyTimeCredits).toHaveLength(1);
    expect(
      summary([{ ...entry, specialDuty: { ...entry.specialDuty!, settlement: "PAY" } }])
        .timeAccountMinutes,
    ).toBe(0);
  });
});
