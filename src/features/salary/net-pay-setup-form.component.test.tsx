import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { NetPaySetupForm, type NetPaySetupSection } from "./net-pay-setup-form";

function setup(
  initial: MonthlyNetPaySettings | null = null,
  busy = false,
  section?: NetPaySetupSection,
) {
  const onSave = jest
    .fn<(value: MonthlyNetPaySettings) => Promise<void>>()
    .mockResolvedValue(undefined);
  return {
    onSave,
    element: (
      <NetPaySetupForm
        month="2026-07"
        initial={initial}
        section={section}
        worksInSaxony={false}
        churchTaxDefaultPercent={9}
        busy={busy}
        onSave={onSave}
      />
    ),
  };
}

describe("three short net forecast setup steps", () => {
  it.each([
    ["ZVK_DARMSTADT_I", "ZVK Darmstadt · Verband I"],
    ["ZVK_DARMSTADT_II", "ZVK Darmstadt · Verband II"],
  ])(
    "distinguishes and saves municipal Darmstadt %s from the evangelical fund",
    async (scheme, label) => {
      const prior = automatedSettings();
      const { element, onSave } = setup(
        {
          ...prior,
          automation: {
            ...prior.automation!,
            pensionScheme: "EZVK_DARMSTADT",
            pensionEmployeeRateBps: 100,
          },
        },
        false,
        "insurance",
      );
      const screen = await render(element);
      await fireEvent.press(screen.getByRole("button", { name: /^Zusatzversorgung auswählen/ }));
      await fireEvent.changeText(screen.getByLabelText("Zusatzversorgung suchen"), "darmstadt");
      expect(screen.queryAllByRole("radio")).toHaveLength(3);
      expect(
        screen.getByRole("radio", { name: "Zusatzversorgung: EZVK · Bestand Darmstadt" }),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole("radio", { name: `Zusatzversorgung: ${label}` }));
      expect(screen.queryByLabelText("Dein EZVK-Eigenanteil laut Abrechnung (%)")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          automation: expect.objectContaining({ pensionScheme: scheme }),
        }),
      );
      expect(onSave.mock.calls[0]![0].automation).not.toHaveProperty("pensionEmployeeRateBps");
    },
  );
  it("finds and saves an additional fund through the compact search", async () => {
    const { element, onSave } = setup(automatedSettings(), false, "insurance");
    const screen = await render(element);
    expect(screen.queryByLabelText("Zusatzversorgung suchen")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Zusatzversorgung auswählen/ }));
    await fireEvent.changeText(screen.getByLabelText("Zusatzversorgung suchen"), "  sachsen  ");
    expect(screen.queryAllByRole("radio")).toHaveLength(1);
    await fireEvent.press(
      screen.getByRole("radio", { name: "Zusatzversorgung: ZVK Sachsen · ATV-K" }),
    );
    expect(screen.queryByLabelText("Zusatzversorgung suchen")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: expect.objectContaining({ pensionScheme: "ZVK_SACHSEN" }),
      }),
    );
  });
  it("shows an empty search and resets it on reopening the fund list", async () => {
    const { element } = setup(automatedSettings(), false, "insurance");
    const screen = await render(element);
    const open = () =>
      fireEvent.press(screen.getByRole("button", { name: /^Zusatzversorgung auswählen/ }));
    await open();
    await fireEvent.changeText(
      screen.getByLabelText("Zusatzversorgung suchen"),
      "unbekannte-suche",
    );
    expect(screen.getByText("Keine passende Kasse gefunden.")).toBeTruthy();
    await open();
    await open();
    expect(screen.getByLabelText("Zusatzversorgung suchen").props.value).toBe("");
    expect(screen.getByRole("radio", { name: "Zusatzversorgung: VBL West" })).toBeTruthy();
  });
  it.each<[string, number | null]>([
    ["", null],
    ["0", 0],
    ["1,00", 100],
  ])("saves the optional EZVK own share %s", async (own, expected) => {
    const { element, onSave } = setup(automatedSettings(), false, "insurance");
    const screen = await render(element);
    await fireEvent.press(screen.getByRole("button", { name: /^Zusatzversorgung auswählen/ }));
    await fireEvent.press(
      screen.getByRole("radio", { name: "Zusatzversorgung: EZVK · Bestand Darmstadt" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Dein EZVK-Eigenanteil laut Abrechnung (%)"),
      own,
    );
    expect(Boolean(screen.queryByText(/Netto vor Zusatzversorgung/))).toBe(own === "");
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: expect.objectContaining({
          pensionScheme: "EZVK_DARMSTADT",
          pensionEmployeeRateBps: expected,
        }),
      }),
    );
  });
  it("keeps an existing EZVK share while editing another personal area", async () => {
    const prior = automatedSettings();
    const initial = {
      ...prior,
      automation: {
        ...prior.automation!,
        pensionScheme: "EZVK_KARLSRUHE" as const,
        pensionEmployeeRateBps: 100,
      },
    };
    const { element, onSave } = setup(initial, false, "tax");
    const screen = await render(element);
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).toHaveBeenCalledWith({ ...initial, month: "2026-07" });
  });
  it("opens a compact list, edits one area and discards unsaved changes on back", async () => {
    const onSave = jest
      .fn<(value: MonthlyNetPaySettings) => Promise<void>>()
      .mockResolvedValue(undefined);
    const screen = await render(
      <NetPaySetupForm
        month="2026-07"
        initial={automatedSettings()}
        allowSectionSwitch
        worksInSaxony={false}
        churchTaxDefaultPercent={9}
        busy={false}
        onSave={onSave}
      />,
    );
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Änderungen speichern" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    expect(screen.queryByRole("button", { name: /^Familie ·/ })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 2" }));
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(screen.getByRole("button", { name: /^Steuern · Klasse 1/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    expect(screen.getByRole("radio", { name: "Steuerklasse: 1", checked: true })).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("keeps invalid family answers in the editor and leaves other areas unchanged", async () => {
    const initial = automatedSettings();
    const onSave = jest
      .fn<(value: MonthlyNetPaySettings) => Promise<void>>()
      .mockResolvedValue(undefined);
    const screen = await render(
      <NetPaySetupForm
        month="2026-07"
        initial={initial}
        allowSectionSwitch
        worksInSaxony={false}
        churchTaxDefaultPercent={9}
        busy={false}
        onSave={onSave}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Familie ·/ }));
    await fireEvent.changeText(screen.getByLabelText("Geburtsdatum (TT.MM.JJJJ)"), "31.02.1990");
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("header", { name: "Familie" })).toBeTruthy();
    expect(screen.queryByTestId("net-pay-settings-overview")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Geburtsdatum (TT.MM.JJJJ)"), "15.01.1990");
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).toHaveBeenCalledWith({
      ...initial,
      month: "2026-07",
      profile: { ...initial.profile, birthDate: "1990-01-15" },
    });
    expect(screen.getByTestId("net-pay-settings-overview")).toBeTruthy();
  });
  it("reaches a stored forecast in three steps without technical payroll inputs or confirmations", async () => {
    const { element, onSave } = setup();
    const screen = await render(element);
    expect(screen.getByText("Schritt 1 von 3")).toBeTruthy();
    expect(screen.queryByLabelText("Kinderfreibetrag laut Gehaltsabrechnung")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByText("Bitte deine Steuerklasse auswählen.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 1" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Zahlst du Kirchensteuer?: Nein" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByText("Schritt 2 von 3")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Geburtsdatum (TT.MM.JJJJ)"), "15.01.1990");
    await fireEvent.press(screen.getByRole("radio", { name: "Hast du Kinder?: Nein" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByText("Schritt 3 von 3")).toBeTruthy();
    expect(screen.getByText(/Gesetzlich · Zusatzbeitrag 2,90/)).toBeTruthy();
    expect(screen.queryByLabelText("Zusatzbeitrag deiner Krankenkasse (%)")).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("radio", { name: "Zusatzversorgung: Weiß ich nicht" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Zusatzversorgung auswählen" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Zusatzversorgung: Weiß ich nicht" }));
    expect(screen.queryByRole("radio", { name: "Zusatzversorgung: Keine" })).toBeNull();
    expect(screen.getByText(/Netto vor Zusatzversorgung/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Prognose anzeigen" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        month: "2026-07",
        profile: expect.objectContaining({
          taxClass: 1,
          isParent: false,
          healthAdditionalRateBps: 290,
        }),
        automation: expect.objectContaining({ pensionScheme: "UNKNOWN" }),
      }),
    );
  });
  it("keeps prior factor, child allowance, health rate, pension and deductions without opening details", async () => {
    const prior = automatedSettings();
    const initial = {
      ...prior,
      profile: {
        ...prior.profile,
        taxClass: 4 as const,
        factorPermille: 875,
        healthAdditionalRateBps: 350,
        childAllowanceHalfUnits: 3,
        isParent: true,
        childrenUnder25: 6,
      },
      automation: {
        ...prior.automation!,
        pensionScheme: "VBL_WEST" as const,
        additionalRecurringGrossCents: 10000,
        additionalNetDeductionCents: 1500,
      },
    };
    const { element, onSave } = setup(initial);
    const screen = await render(element);
    for (let i = 0; i < 2; i++)
      await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Prognose anzeigen" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ profile: initial.profile, automation: initial.automation }),
    );
  });
  it("lets the user correct the church home region and separates adult children from under-25 children", async () => {
    const { element, onSave } = setup(automatedSettings());
    const screen = await render(element);
    await fireEvent.press(screen.getByRole("radio", { name: "Zahlst du Kirchensteuer?: Ja" }));
    await fireEvent.press(
      screen.getByRole("radio", { name: "Dein Wohnort: Bayern / Baden-Württemberg" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Hast du Kinder?: Ja" }));
    await fireEvent.press(
      screen.getByRole("radio", { name: "Wie viele Kinder sind unter 25?: 0" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Ändern" }));
    await fireEvent.press(
      screen.getByRole("radio", { name: "Beitrag für die Prognose: Eigener Zusatzbeitrag" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Zusatzbeitrag deiner Krankenkasse (%)"),
      "3,40",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Prognose anzeigen" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          churchTaxRatePercent: 8,
          isParent: true,
          childrenUnder25: 0,
          healthAdditionalRateBps: 340,
        }),
      }),
    );
  });
  it("clears incompatible optional child allowances on tax class change and keeps errors in the current step", async () => {
    const { element, onSave } = setup(automatedSettings());
    const screen = await render(element);
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben" }));
    await fireEvent.changeText(
      screen.getByLabelText("Kinderfreibetrag laut Gehaltsabrechnung"),
      "0,7",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByText(/Schritten von 0,5/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 5" }));
    expect(screen.queryByLabelText("Kinderfreibetrag laut Gehaltsabrechnung")).toBeNull();
    for (let i = 0; i < 2; i++)
      await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Prognose anzeigen" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ taxClass: 5, childAllowanceHalfUnits: 0 }),
      }),
    );
  });
  it("preserves answers when going back and blocks navigation while saving", async () => {
    const { element } = setup(automatedSettings());
    const screen = await render(element);
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(
      screen.getByRole("radio", { name: "Steuerklasse: 1" }).props.accessibilityState.selected,
    ).toBe(true);
    expect(screen.getByRole("radio", { name: "Steuerklasse: 1", checked: true })).toBeTruthy();
    await screen.rerender(setup(automatedSettings(), true).element);
    expect(
      screen.getByRole("button", { name: "Wird gespeichert" }).props.accessibilityState.disabled,
    ).toBe(true);
  });
  it("keeps supplementary pension selection compact and preserves it when reopening", async () => {
    const { element, onSave } = setup(automatedSettings(), false, "insurance");
    const screen = await render(element);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Bearbeitung abbrechen" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Zusatzversorgung auswählen/ }));
    await fireEvent.press(screen.getByRole("radio", { name: "Zusatzversorgung: VBL West" }));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await fireEvent.press(
      screen.getByRole("button", { name: "Zusatzversorgung auswählen: VBL West" }),
    );
    expect(
      screen.getByRole("radio", { name: "Zusatzversorgung: VBL West" }).props.accessibilityState
        .selected,
    ).toBe(true);
    await fireEvent.press(
      screen.getByRole("button", { name: "Zusatzversorgung auswählen: VBL West" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: expect.objectContaining({ pensionScheme: "VBL_WEST" }),
      }),
    );
  });
  it.each(["tax", "family", "insurance"] as const)(
    "edits only %s without repeating setup or dropping stored details",
    async (section) => {
      const initial = automatedSettings();
      const custom: MonthlyNetPaySettings = {
        ...initial,
        profile: {
          ...initial.profile,
          taxClass: 4 as const,
          factorPermille: 875,
          childAllowanceHalfUnits: 3,
          monthlyTaxAllowanceCents: 12000,
          healthAdditionalRateBps: 340,
          isParent: true,
          childrenUnder25: 2,
        },
        automation: {
          ...initial.automation!,
          pensionScheme: "VBL_WEST" as const,
          additionalRecurringGrossCents: 9000,
          additionalNetDeductionCents: 1700,
        },
        specialCases: ["PRIVATE_INSURANCE" as const],
      };
      const { element, onSave } = setup(custom, false, section);
      const screen = await render(element);
      expect(screen.getByText("Gültig ab Juli 2026")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Zurück" })).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
      expect(onSave).toHaveBeenCalledWith({ ...custom, month: "2026-07" });
    },
  );
});
