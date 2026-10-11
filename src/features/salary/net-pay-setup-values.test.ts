import { describe, expect, it } from "vitest";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { NET_PAY_PENSION_OPTIONS } from "@/domain/net-pay-pension-schemes";
import {
  netPaySetupSettings,
  netPaySetupValues,
  validateNetPaySetupStep,
} from "./net-pay-setup-values";

describe("simple forecast setup", () => {
  it.each(NET_PAY_PENSION_OPTIONS.map(({ value }) => value))(
    "saves the selected pension model %s",
    (pensionScheme) => {
      const form = netPaySetupValues(automatedSettings(), false);
      expect(
        netPaySetupSettings("2026-07", form, pensionScheme, "0", "0").automation?.pensionScheme,
      ).toBe(pensionScheme);
    },
  );
  it.each([
    ["", null],
    ["0", 0],
    ["1,00", 100],
    ["3,30", 330],
  ] as const)("stores the EZVK employee share %s without guessing", (own, expected) => {
    const initial = automatedSettings();
    expect(
      netPaySetupSettings(
        "2026-07",
        netPaySetupValues(initial, false),
        "EZVK_DARMSTADT",
        "0",
        "0",
        initial,
        own,
      ).automation?.pensionEmployeeRateBps,
    ).toBe(expected);
  });
  it("rejects invalid EZVK rates and clears the share when switching to a fixed model", () => {
    const initial = automatedSettings();
    const form = netPaySetupValues(initial, false);
    for (const own of ["-1", "3,31", "0,001", "abc"])
      expect(() =>
        netPaySetupSettings("2026-07", form, "EZVK_DARMSTADT", "0", "0", initial, own),
      ).toThrow();
    expect(
      netPaySetupSettings("2026-07", form, "EZVK_KARLSRUHE", "0", "0", initial, "3,50").automation
        ?.pensionEmployeeRateBps,
    ).toBe(350);
    expect(
      netPaySetupSettings("2026-07", form, "VBL_WEST", "0", "0", initial, "1,00").automation,
    ).not.toHaveProperty("pensionEmployeeRateBps");
  });
  it("requires personal choices while supplying only visible forecast assumptions", () => {
    const form = netPaySetupValues(null, true);
    expect(form).toMatchObject({
      taxClass: null,
      churchTaxRate: null,
      birthDate: "",
      isParent: null,
      worksInSaxony: true,
      healthAdditionalRate: "2,90",
      childAllowance: "0",
      specialCases: [],
    });
    expect(() => validateNetPaySetupStep("2026-07", 0, form)).toThrow("Steuerklasse");
    expect(() => validateNetPaySetupStep("2026-07", 0, { ...form, taxClass: 1 })).toThrow(
      "Kirchensteuer",
    );
    const selected = { ...form, taxClass: 1, churchTaxRate: 0 };
    expect(() => validateNetPaySetupStep("2026-07", 0, selected)).not.toThrow();
    expect(() => validateNetPaySetupStep("2026-07", 1, selected)).toThrow("Kinder");
    const complete = { ...selected, isParent: false, birthDate: "15.01.1990" };
    expect(() => netPaySetupSettings("2026-07", complete, null, "0", "0")).toThrow(
      "Weiß ich nicht",
    );
    expect(netPaySetupSettings("2026-07", complete, "UNKNOWN", "0", "0")).toMatchObject({
      version: 2,
      sfnBasicHourlyPayCents: null,
      profile: { healthAdditionalRateBps: 290, childrenUnder25: 0, worksInSaxony: true },
      automation: {
        pensionScheme: "UNKNOWN",
        fullMonthAndPayConfirmed: true,
        plannedWorkConfirmed: true,
      },
    });
  });
  it("preserves all existing optional personal inputs while updating the workplace", () => {
    const initial = automatedSettings();
    const custom = {
      ...initial,
      profile: {
        ...initial.profile,
        taxClass: 4 as const,
        factorPermille: 875,
        healthAdditionalRateBps: 349,
        childAllowanceHalfUnits: 3,
        monthlyTaxAllowanceCents: 15000,
        isParent: true,
        childrenUnder25: 6,
      },
    };
    const result = netPaySetupSettings(
      "2026-08",
      netPaySetupValues(custom, true),
      "VBL_EAST",
      "100",
      "15",
    );
    expect(result.profile).toEqual({ ...custom.profile, worksInSaxony: true });
    expect(result.automation).toMatchObject({
      pensionScheme: "VBL_EAST",
      additionalRecurringGrossCents: 10000,
      additionalNetDeductionCents: 1500,
    });
  });
  it("validates optional tax inputs before leaving their step and keeps date/children validation", () => {
    const form = netPaySetupValues(automatedSettings(), false);
    expect(() => validateNetPaySetupStep("2026-07", 0, { ...form, childAllowance: "0,7" })).toThrow(
      "0,5",
    );
    expect(() =>
      validateNetPaySetupStep("2026-07", 1, { ...form, birthDate: "31.02.1990" }),
    ).toThrow("Geburtsdatum");
    expect(() =>
      validateNetPaySetupStep("2026-07", 1, { ...form, isParent: false, childrenUnder25: "2" }),
    ).toThrow("Kinder unter 25");
    expect(() =>
      validateNetPaySetupStep("2026-07", 2, { ...form, healthAdditionalRate: "" }),
    ).toThrow("GKV");
  });
  it("rejects tampered confirmations instead of silently accepting a regular case", () => {
    const initial = automatedSettings();
    const custom = {
      ...initial,
      automation: {
        ...initial.automation!,
        fullMonthAndPayConfirmed: false,
        plannedWorkConfirmed: false,
      },
    };
    expect(() =>
      netPaySetupSettings(
        "2026-08",
        netPaySetupValues(initial, false),
        custom.automation.pensionScheme,
        "0",
        "0",
        custom as unknown as MonthlyNetPaySettings,
      ),
    ).toThrow("unvollständig");
  });
});
