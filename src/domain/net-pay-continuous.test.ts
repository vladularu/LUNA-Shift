import { describe, expect, it } from "vitest";
import { automatedSettings } from "./net-pay-automation-test-fixtures";
import { settings } from "./net-pay-profile-test-fixtures";
import { NET_PAY_PENSION_OPTIONS } from "./net-pay-pension-schemes";
import {
  resolveNetPaySettings,
  validateMonthlyNetPaySettings,
  type MonthlyNetPaySettings,
} from "./net-pay-profile";

const saved = (value: MonthlyNetPaySettings) => ({
  settings: value,
  revision: 1,
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:00:00Z",
});

describe("effective net-pay profile history", () => {
  it.each(NET_PAY_PENSION_OPTIONS.map(({ value }) => value))(
    "validates and inherits the pension model %s",
    (pensionScheme) => {
      const initial = automatedSettings();
      const value = { ...initial, automation: { ...initial.automation!, pensionScheme } };
      expect(validateMonthlyNetPaySettings(value)).toEqual(value);
      expect(resolveNetPaySettings("2026-12", [saved(value)])?.settings).toEqual(value);
    },
  );
  it.each([null, 0, 100, 330])("preserves the EZVK employee share %s", (pensionEmployeeRateBps) => {
    const initial = automatedSettings();
    const value = {
      ...initial,
      automation: {
        ...initial.automation!,
        pensionScheme: "EZVK_DARMSTADT" as const,
        pensionEmployeeRateBps,
      },
    };
    expect(validateMonthlyNetPaySettings(value)).toEqual(value);
  });
  it("rejects malformed or incompatible employee shares", () => {
    const initial = automatedSettings();
    for (const [pensionScheme, pensionEmployeeRateBps] of [
      ["EZVK_DARMSTADT", -1],
      ["EZVK_DARMSTADT", 331],
      ["EZVK_KARLSRUHE", 351],
      ["EZVK_DARMSTADT", "100"],
      ["EZVK_DARMSTADT", 0.1],
      ["EZVK_DARMSTADT", undefined],
      ["VBL_WEST", null],
      ["VBL_WEST", 100],
      ["NONE", 0],
    ])
      expect(() =>
        validateMonthlyNetPaySettings({
          ...initial,
          automation: { ...initial.automation!, pensionScheme, pensionEmployeeRateBps },
        }),
      ).toThrow();
  });
  it("inherits forwards, preserves an old monthly override and selects a later dated change", () => {
    const june = saved(automatedSettings("2026-06"));
    const july = saved(settings("2026-07"));
    const september = saved({
      ...automatedSettings("2026-09"),
      profile: { ...settings().profile, taxClass: 3 },
    });
    const rows = [september, july, june];
    expect(resolveNetPaySettings("2026-05", rows)).toBeNull();
    expect(resolveNetPaySettings("2026-07", rows)).toBe(july);
    expect(resolveNetPaySettings("2026-08", rows)).toBe(june);
    expect(resolveNetPaySettings("2026-10", rows)).toBe(september);
    expect(resolveNetPaySettings("2026-08", [july])).toBeNull();
  });
  it("rejects duplicate months, missing confirmations and unknown fields instead of guessing", () => {
    const row = saved(automatedSettings());
    expect(() => resolveNetPaySettings("2026-08", [row, row])).toThrow();
    for (const automation of [
      undefined,
      { ...row.settings.automation, plannedWorkConfirmed: false },
      { ...row.settings.automation, additionalRecurringGrossCents: -1 },
      { ...row.settings.automation, pensionScheme: "INVALID" },
      { ...row.settings.automation, extra: true },
    ])
      expect(() => validateMonthlyNetPaySettings({ ...row.settings, automation })).toThrow();
  });
  it("retains unknown pension coverage distinctly from none when inheriting a forecast", () => {
    const value = automatedSettings();
    const unknown = validateMonthlyNetPaySettings({
      ...value,
      automation: { ...value.automation, pensionScheme: "UNKNOWN" },
    });
    expect(
      resolveNetPaySettings("2026-09", [saved(unknown)])?.settings.automation?.pensionScheme,
    ).toBe("UNKNOWN");
  });
});
