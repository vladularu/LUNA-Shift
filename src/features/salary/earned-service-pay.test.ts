import { describe, expect, it } from "vitest";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import {
  earnedServiceRows,
  earnedSpecialDutyCents,
  SPECIAL_DUTY_FILTER,
} from "./earned-service-pay";

function standby(settlement: "PAY" | "TIME_OFF" = "PAY") {
  const shift = forecastShift({
    id: "standby",
    date: "2026-07-07",
    startTime: "06:00",
    endTime: "14:00",
    breakMinutes: 30,
    specialDuty: {
      ...newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin"),
      version: 2,
      standbyLevel: "II",
      settlement,
      standbyAgreement: {
        ...newStandbyAgreement("TVOED_K"),
        rule: "STANDARD",
        sequence: 1,
        payGroup: "KR_VI",
        timeOffMode: "WEIGHTED",
      },
    },
  });
  const pay = calculateMonthlyPayEstimate("2026-07", [shift], forecastProfile, null);
  if (!pay.available) throw new Error("Readiness fixture unavailable");
  return { shift, pay, line: pay.specialDutyBreakdowns![0] };
}

describe("earned readiness cash presentation", () => {
  it("does not confuse a duty's time credit with paid cash", () => {
    const { shift, pay, line } = standby("TIME_OFF");
    expect(line.standbyPay!.timeCreditMinutes).toBeGreaterThan(0);
    expect(earnedSpecialDutyCents(line)).toBe(0);
    expect(earnedServiceRows(pay, null, [shift], null)).toMatchObject([
      { id: shift.id, date: shift.date, amountCents: 0 },
    ]);
  });

  it("preserves unknown cash instead of presenting a completed partial amount", () => {
    const { line } = standby();
    expect(earnedSpecialDutyCents({ ...line, complete: false })).toBeNull();
    expect(earnedSpecialDutyCents({ ...line, baseAmountCents: null })).toBeNull();
  });

  it("includes on-call flat pay, all rounded callouts and their cash premiums once", () => {
    const shift = forecastShift({
      id: "callout",
      date: "2026-07-12",
      startTime: "20:00",
      endTime: "23:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "20:00", "23:00", "Europe/Berlin"),
        settlement: "PAY",
        calloutsComplete: true,
        callouts: [1320, 1340].map((start) => ({
          kind: "REMOTE" as const,
          start,
          end: start + 10,
          departure: start,
          returned: start + 10,
          breakMinutes: 0,
        })),
      },
    });
    const pay = calculateMonthlyPayEstimate("2026-07", [shift], forecastProfile, null);
    expect(pay.available).toBe(true);
    const line = pay.specialDutyBreakdowns![0];
    expect(line.calloutPay!.timePremiumCents).toBeGreaterThan(0);
    expect(earnedSpecialDutyCents(line)).toBe(Math.round(pay.specialDutyAmount! * 100));
    expect(earnedServiceRows(pay, null, [shift], SPECIAL_DUTY_FILTER)).toMatchObject([
      { id: shift.id, date: shift.date, amountCents: Math.round(pay.specialDutyAmount! * 100) },
    ]);
    expect(
      earnedSpecialDutyCents({
        ...line,
        calloutPay: { ...line.calloutPay!, timePremiumCents: null },
      }),
    ).toBeNull();
  });
});
