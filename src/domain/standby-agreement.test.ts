import { describe, expect, it } from "vitest";
import { newStandbyAgreement, validateStandbyAgreement } from "./standby-agreement";
import { newSpecialDuty, validateSpecialDuty, plannedSpecialDuty } from "./special-duty";

describe("versioned standby agreements", () => {
  it("preserves old duties and retains the agreement while resetting a copied monthly sequence", () => {
    const old = newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin");
    expect(validateSpecialDuty(old)).toEqual(old);
    const duty = {
      ...old,
      version: 2 as const,
      standbyAgreement: {
        ...newStandbyAgreement("TVL_43"),
        rule: "STANDARD" as const,
        sequence: 9,
        payGroup: "KR_VI",
      },
    };
    expect(validateSpecialDuty(duty)).toEqual(duty);
    expect(plannedSpecialDuty(duty)?.standbyAgreement).toEqual({
      ...duty.standbyAgreement,
      sequence: null,
    });
    expect(duty.standbyAgreement.sequence).toBe(9);
  });
  it("rejects malformed facts and new data disguised as the old format", () => {
    const base = newStandbyAgreement("TVOED_K");
    for (const patch of [
      { sequence: 0 },
      { sequence: 1.5 },
      { sequence: 101 },
      { hourlyCents: -1 },
      { hourlyCents: 1.5 },
      { hourlyCents: 100001 },
      { payGroup: "__proto__.x" },
      { rule: "GUESS" },
      { tariff: "OTHER" },
      { timeOffMode: "ANY" },
      { extra: true },
    ])
      expect(() => validateStandbyAgreement({ ...base, ...patch })).toThrow();
    const old = newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin");
    expect(() => validateSpecialDuty({ ...old, standbyAgreement: base })).toThrow();
    expect(() => validateSpecialDuty({ ...old, version: 2 })).toThrow();
    expect(() =>
      validateSpecialDuty({
        ...newSpecialDuty("ON_CALL", "06:00", "14:00", "Europe/Berlin"),
        version: 2,
        standbyAgreement: base,
      }),
    ).toThrow();
  });
});
