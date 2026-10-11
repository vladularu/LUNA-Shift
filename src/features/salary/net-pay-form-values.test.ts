import { describe, expect, it } from "vitest";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import { calculateMonthlyNetPay } from "@/engine/net-pay";
import {
  monthlyNetPaySettingsFromForm,
  netPayFormValues,
  parseNetPayDecimal,
  netPayAmountsFromForm,
  NET_PAY_SPECIAL_CASE_OPTIONS,
  type NetPayFormValues,
} from "./net-pay-form-values";

describe("net pay user inputs", () => {
  it("starts a new monthly form without assumed personal values", () => {
    const empty = netPayFormValues(null);
    expect(Object.values(empty).every((value) => value === null || value === "")).toBe(true);
    expect(() => monthlyNetPaySettingsFromForm("2026-07", empty, null)).toThrow();
  });
  it("round-trips all stored fields, including the SFN basis and multiple special cases", () => {
    const value = {
      ...settings(),
      sfnBasicHourlyPayCents: 4000,
      specialCases: ["PRIVATE_INSURANCE", "ADDITIONAL_DEDUCTIONS"] as const,
      profile: {
        ...settings().profile,
        taxClass: 4 as const,
        factorPermille: 753,
        childAllowanceHalfUnits: 3,
        isParent: true,
        childrenUnder25: 2,
        worksInSaxony: true,
        healthAdditionalRateBps: 269,
        monthlyTaxAllowanceCents: 12345,
        churchTaxRatePercent: 9 as const,
      },
    };
    expect(monthlyNetPaySettingsFromForm(value.month, netPayFormValues(value), value)).toEqual(
      value,
    );
  });
  it("edits or explicitly clears the optional SFN hourly basis without assuming a value", () => {
    const original = { ...settings(), sfnBasicHourlyPayCents: 3000 };
    const form = netPayFormValues(original);
    expect(
      monthlyNetPaySettingsFromForm(
        original.month,
        { ...form, sfnBasicHourlyPay: "31,25" },
        original,
      ).sfnBasicHourlyPayCents,
    ).toBe(3125);
    expect(
      monthlyNetPaySettingsFromForm(original.month, { ...form, sfnBasicHourlyPay: "" }, original)
        .sfnBasicHourlyPayCents,
    ).toBeNull();
    for (const value of ["0", "-1", "12,345"]) {
      expect(() =>
        monthlyNetPaySettingsFromForm(
          original.month,
          { ...form, sfnBasicHourlyPay: value },
          original,
        ),
      ).toThrow();
    }
  });
  it.each(["taxClass", "churchTaxRate", "isParent", "worksInSaxony", "specialCases"] as const)(
    "requires explicit %s",
    (key) => {
      const form = { ...netPayFormValues(settings()), [key]: null };
      expect(() => monthlyNetPaySettingsFromForm("2026-07", form, null)).toThrow();
    },
  );
  it.each([
    "birthDate",
    "childAllowance",
    "childrenUnder25",
    "healthAdditionalRate",
    "monthlyTaxAllowance",
  ] as const)("does not replace a blank %s with zero", (key) => {
    expect(() =>
      monthlyNetPaySettingsFromForm(
        "2026-07",
        { ...netPayFormValues(settings()), [key]: "" },
        null,
      ),
    ).toThrow();
  });
  it.each(["31.02.1990", "1.1.1990", "1990-01-15", "15.01.2027"])(
    "rejects an invalid/future birth date %s",
    (birthDate) => {
      expect(() =>
        monthlyNetPaySettingsFromForm(
          "2026-07",
          { ...netPayFormValues(settings()), birthDate },
          null,
        ),
      ).toThrow();
    },
  );
  it("requires an explicit factor procedure for tax class IV", () => {
    const form: NetPayFormValues = {
      ...netPayFormValues(settings()),
      taxClass: 4,
      factorMode: null,
    };
    expect(() => monthlyNetPaySettingsFromForm("2026-07", form, null)).toThrow();
    expect(() =>
      monthlyNetPaySettingsFromForm(
        "2026-07",
        { ...form, factorMode: "FACTOR", factor: "0,7501" },
        null,
      ),
    ).toThrow();
    expect(
      monthlyNetPaySettingsFromForm("2026-07", { ...form, factorMode: "NONE" }, null).profile
        .factorPermille,
    ).toBeNull();
  });
  it("requires half-unit child allowances and a whole child count", () => {
    expect(() =>
      monthlyNetPaySettingsFromForm(
        "2026-07",
        { ...netPayFormValues(settings()), childAllowance: "0,25" },
        null,
      ),
    ).toThrow();
    expect(() =>
      monthlyNetPaySettingsFromForm(
        "2026-07",
        { ...netPayFormValues(settings()), childrenUnder25: "0,5" },
        null,
      ),
    ).toThrow();
  });
  it.each([
    [
      { taxClass: 5, childAllowance: "0,5" },
      "Kinderfreibetrag: Bei Steuerklasse V und VI bitte 0 eintragen.",
    ],
    [
      { taxClass: 6, childAllowance: "1" },
      "Kinderfreibetrag: Bei Steuerklasse V und VI bitte 0 eintragen.",
    ],
    [
      { isParent: false, childrenUnder25: "1" },
      "Kinder unter 25: Bei Elterneigenschaft „Nein“ bitte 0 eintragen oder die Elterneigenschaft prüfen.",
    ],
    [
      { taxClass: 4, factorMode: "FACTOR", factor: "1" },
      "ELStAM-Faktor: Bitte einen Wert von 0,001 bis 0,999 angeben.",
    ],
    [
      { taxClass: 4, factorMode: "FACTOR", factor: "0" },
      "ELStAM-Faktor: Bitte einen Wert von 0,001 bis 0,999 angeben.",
    ],
    [{ childAllowance: "10,5" }, "Kinderfreibetrag: Bitte einen Wert von 0 bis 10 angeben."],
    [
      { isParent: true, childrenUnder25: "21" },
      "Kinder unter 25: Bitte eine ganze Zahl von 0 bis 20 angeben.",
    ],
    [
      { healthAdditionalRate: "100,01" },
      "Voller GKV-Zusatzbeitrag: Bitte den Beitrag als Prozentwert von 0 bis 100 angeben.",
    ],
    [
      { sfnBasicHourlyPay: "0" },
      "SFN-Grundlohn: Bitte einen Betrag über 0 angeben oder das optionale Feld leeren.",
    ],
    [{ birthDate: "31.12.1899" }, "Geburtsdatum: Bitte ein Datum ab dem Jahr 1900 angeben."],
    [
      { birthDate: "15.07.2026" },
      "Das Geburtsdatum liegt nach dem Beginn des gewählten Abrechnungsmonats.",
    ],
  ] satisfies readonly (readonly [Partial<NetPayFormValues>, string])[])(
    "names the field and correction for invalid profile input %j",
    (input, message) => {
      expect(() =>
        monthlyNetPaySettingsFromForm(
          "2026-07",
          { ...netPayFormValues(settings()), ...input },
          null,
        ),
      ).toThrow(message);
    },
  );
  it.each(NET_PAY_SPECIAL_CASE_OPTIONS)(
    "retains unsupported $value rather than silently clearing it",
    ({ value }) => {
      const profile = monthlyNetPaySettingsFromForm(
        "2026-07",
        { ...netPayFormValues(settings()), specialCases: [value] },
        null,
      );
      expect(profile.specialCases).toEqual([value]);
      const result = calculateMonthlyNetPay({
        month: profile.month,
        profile: profile.profile,
        specialCases: profile.specialCases,
        amounts: {
          grossCents: 500000,
          taxableGrossCents: 500000,
          socialInsuranceGrossCents: 500000,
          regularMonthlySocialInsuranceGrossCents: 500000,
        },
      });
      expect(result.status).toBe("unsupported");
    },
  );
  it.each(["", "-1", "1e3", "NaN", "1.234,56", "1,234.56", "12,345", "100000,01"])(
    "rejects ambiguous or overprecise money %s",
    (text) => {
      expect(() => parseNetPayDecimal(text, 100, "den Betrag")).toThrow();
    },
  );
  it("preserves cents, dot/comma decimals and explicitly distinct gross bases", () => {
    expect(
      netPayAmountsFromForm({
        gross: " 5000,05 ",
        taxable: "4900.01",
        socialInsurance: "4950,04",
        regularSocialInsurance: "4500",
      }),
    ).toEqual({
      grossCents: 500005,
      taxableGrossCents: 490001,
      socialInsuranceGrossCents: 495004,
      regularMonthlySocialInsuranceGrossCents: 450000,
    });
  });
});
