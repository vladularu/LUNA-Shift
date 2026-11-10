import { describe, expect, it } from "vitest";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { employmentDataFromProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { standbyBillingCandidates, standbyBillingTransferInputs } from "./standby-billing-transfer";

const profile = {
  ...forecastProfile,
  tariff: null,
  tvlKrTariff: {
    payGroup: "KR8" as const,
    payLevel: 4 as const,
    universityRegion: "WEST" as const,
  },
};
const old = {
  ...newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
  version: 2 as const,
  standbyLevel: "II" as const,
  settlement: "PAY" as const,
  standbyAgreement: { ...newStandbyAgreement("TVOED_K"), rule: "STANDARD" as const, sequence: 1 },
};
const next = {
  ...old,
  standbyLevel: "B" as const,
  standbyAgreement: {
    ...newStandbyAgreement("TVL_43"),
    rule: "STANDARD" as const,
    sequence: 1,
    payGroup: "KR_VII",
  },
};
const original = forecastShift({
  id: "source",
  date: "2026-07-07",
  type: "CUSTOM",
  startTime: "08:00",
  endTime: "16:00",
  breakMinutes: 0,
  specialDuty: old,
});
const target = forecastShift({
  ...original,
  id: "target",
  date: "2026-08-10",
  startTime: "09:00",
  endTime: "18:00",
  breakMinutes: 30,
  note: "Eigene Notiz",
  revision: 3,
  specialDuty: {
    ...old,
    version: 3,
    breakStart: 720,
    standbyAgreement: { ...old.standbyAgreement, sequence: 3 },
  },
});

describe("explicit standby billing transfer", () => {
  it("offers only incomplete entries with the same old shared billing", () => {
    const different = {
      ...target,
      id: "different",
      specialDuty: { ...old, settlement: "TIME_OFF" as const },
    };
    const confirmed = { ...target, id: "confirmed", specialDuty: next };
    const deleted = { ...target, id: "deleted", deletedAt: "2026-09-01" };
    expect(
      standbyBillingCandidates(
        original,
        next,
        [original, target, different, confirmed, deleted],
        profile,
        resolver,
      ),
    ).toEqual([target]);
    expect(standbyBillingCandidates(original, old, [target], profile, resolver)).toEqual([]);
    expect(
      standbyBillingCandidates(
        original,
        { ...next, standbyLevel: "UNKNOWN" },
        [target],
        profile,
        resolver,
      ),
    ).toEqual([]);
  });

  it("does not cross an explicit employment boundary even with the same tariff", () => {
    const data = remunerationDataFromLegacy(profile);
    const employment = employmentDataFromProfile(profile);
    const dated = {
      ...profile,
      employmentTimeline: [
        { effectiveFrom: null, data, employment, revision: 1, createdAt: "now", updatedAt: "now" },
        {
          effectiveFrom: "2026-08-01",
          data,
          employment,
          revision: 1,
          createdAt: "now",
          updatedAt: "now",
        },
      ],
    };
    expect(standbyBillingCandidates(original, next, [target], dated, resolver)).toEqual([]);
  });

  it("copies only shared billing and preserves individual times, pauses, sequence and revision guard", () => {
    const candidates = standbyBillingCandidates(original, next, [target], profile, resolver);
    expect(standbyBillingTransferInputs(original, next, [], candidates)).toEqual([]);
    const [input] = standbyBillingTransferInputs(original, next, [target], candidates);
    expect(input).toMatchObject({
      id: target.id,
      expectedRevision: 3,
      date: target.date,
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 30,
      note: "Eigene Notiz",
      specialDuty: {
        version: 3,
        breakStart: 720,
        standbyLevel: "B",
        standbyAgreement: { tariff: "TVL_43", sequence: 3, payGroup: "KR_VII" },
      },
    });
    expect(input.specialDuty?.parts).toBe(target.specialDuty?.parts);
    expect(input.specialDuty?.callouts).toBe(target.specialDuty?.callouts);
    expect(target.specialDuty).toEqual(expect.objectContaining({ standbyLevel: "II" }));
    expect(() =>
      standbyBillingTransferInputs(original, next, [target], [{ ...target, revision: 4 }]),
    ).toThrow("erneut");
    expect(() =>
      standbyBillingTransferInputs(original, next, [target, target], candidates),
    ).toThrow();
  });
});
