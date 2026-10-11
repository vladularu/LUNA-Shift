import * as MockReact from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import * as forecastEngine from "@/engine/net-pay-automatic-forecast";
import * as payEngine from "@/engine/simple-pay";
import { NetPayAutomaticScreen } from "./net-pay-automatic-screen";
import { NetPayAutomaticEntryCard } from "./net-pay-automatic-entry-card";
import { NetPayScreen } from "./net-pay-screen";
import { SalaryScreen } from "./salary-screen";

let mockSettings: MonthlyNetPaySettings | null = automatedSettings("2026-06");
const mockProfile = forecastProfile;
let mockEntries = [forecastShift()];
let mockTestMonths: string[] = [];
const mockSave = jest.fn<(value: MonthlyNetPaySettings) => Promise<void>>();
// The native modal measures its own safe area on-device; the JS renderer has no layout events.
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual<typeof import("react-native-safe-area-context")>(
    "react-native-safe-area-context",
  ),
  SafeAreaProvider: ({ children }: MockReact.PropsWithChildren) => children,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ month: "2026-07" }),
  useFocusEffect: jest.fn(),
}));
jest.mock("@/navigation/active-month", () => ({
  useActiveMonthCoordinator: () => ({ getMonth: () => "2026-07", setMonth: jest.fn() }),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: [],
    workPatternSettings: { workplaceCoverage: "UNKNOWN", assignment: "UNKNOWN", updatedAt: null },
  }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
  usePflegeShiftTestData: () => ({ testMonths: mockTestMonths }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({
    resolver:
      jest.requireActual<typeof import("@/rules/rule-resolver")>("@/rules/rule-resolver")
        .bundledRuleResolver,
  }),
}));
jest.mock("./use-net-pay-profile", () => ({
  useNetPayProfile: () => {
    const [value, setValue] = MockReact.useState(mockSettings);
    return {
      status: "ready",
      saved: value ? { settings: value, revision: 1 } : null,
      error: null,
      busy: false,
      reload: jest.fn(),
      save: async (next: MonthlyNetPaySettings) => {
        await mockSave(next);
        setValue(next);
      },
    };
  },
}));

describe("integrated salary-to-net workflow", () => {
  beforeEach(() => {
    mockSettings = automatedSettings("2026-06");
    mockEntries = [forecastShift()];
    mockTestMonths = [];
    mockSave.mockReset().mockResolvedValue(undefined);
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    jest.mocked(router.push).mockClear();
  });
  async function overview(month = "2026-07") {
    return render(<NetPayAutomaticScreen month={month} />);
  }
  it("shows net, gross, deductions and both premium shares together", async () => {
    const screen = await overview();
    expect(screen.getByLabelText(/^Netto-Prognose: ca\./)).toBeTruthy();
    for (const label of [
      "Gesamtbrutto",
      "Abzüge",
      "Zeitzuschläge",
      "Steuerfrei",
      "Steuerpflichtig",
    ])
      expect(screen.getByLabelText(new RegExp(`^${label}:`))).toBeTruthy();
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    expect(screen.queryByLabelText("Gesamtbrutto (€)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manuellen Rechner öffnen" })).toBeNull();
  });
  it("uses the same overview for the existing automatic route", async () => {
    const screen = await render(<NetPayScreen />);
    expect(screen.getByText("Gehaltsprognose")).toBeTruthy();
    expect(screen.getByLabelText(/^Netto-Prognose:/)).toBeTruthy();
  });
  it("opens deductions directly and reuses the computed result", async () => {
    mockEntries = [forecastShift({ id: "direct-details-cache" })];
    const calculate = jest.spyOn(forecastEngine, "calculateAutomaticNetPayForecast");
    try {
      const screen = await overview();
      await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
      expect(screen.getByText("Deine Abzüge")).toBeTruthy();
      expect(screen.getByTestId("net-pay-deduction-details")).toBeTruthy();
      expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
      expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
      expect(screen.queryByLabelText(/^Solidaritätszuschlag:/)).toBeNull();
      expect(screen.getByLabelText(/^Krankenversicherung:/)).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Berechnungsgrundlagen" }));
      expect(screen.getByLabelText(/^Steuerbrutto:/)).toBeTruthy();
      expect(screen.getByText("Krankenversicherung einschließlich Zusatzbeitrag.")).toBeTruthy();
      expect(calculate).toHaveBeenCalledTimes(1);
      await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
      await waitFor(() => expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull());
      expect(screen.getByLabelText(/^Netto-Prognose:/)).toBeTruthy();
    } finally {
      calculate.mockRestore();
    }
  });
  it("shows every nonzero deduction immediately without opening calculation details", async () => {
    const initial = automatedSettings("2026-06");
    mockSettings = {
      ...initial,
      profile: { ...initial.profile, churchTaxRatePercent: 9 },
      automation: {
        ...initial.automation!,
        pensionScheme: "VBL_WEST",
        additionalNetDeductionCents: 1500,
      },
    };
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    for (const label of ["Kirchensteuer", "Zusatzversorgung", "Weitere Netto-Abzüge"])
      expect(screen.getByLabelText(new RegExp(`^${label}:`))).toBeTruthy();
    expect(screen.queryByLabelText(/^Solidaritätszuschlag:/)).toBeNull();
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Berechnungsgrundlagen" }));
    expect(screen.getAllByLabelText(/^Kirchensteuer:/)).toHaveLength(1);
    expect(screen.getByLabelText(/^Solidaritätszuschlag:/)).toBeTruthy();
  });
  it("expands read-only gross rows in the overview without a dialog or further navigation", async () => {
    const screen = await render(
      <NetPayAutomaticEntryCard
        month="2026-07"
        proposedGrossCents={500000}
        blocked={false}
        grossItems={[
          { label: "Grundentgelt", value: "4.000,00 €" },
          { label: "Zeitzuschläge", value: "330,63 €" },
        ]}
        nightCompensatoryMinutes={30}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Gesamtbrutto:/ }));
    expect(screen.getByLabelText("Grundentgelt: 4.000,00 €")).toBeTruthy();
    expect(screen.getByTestId("net-pay-gross-composition")).toBeTruthy();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
    expect(screen.queryByText("Zusammensetzung")).toBeNull();
    expect(screen.queryByRole("button", { name: "Gehaltsgrundlage ansehen" })).toBeNull();
    expect(screen.getByText(/Zusätzlich 30 Min. Freizeitausgleich/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Gesamtbrutto:/ }));
    expect(screen.queryByTestId("net-pay-gross-composition")).toBeNull();
  });
  it("opens the compact real premium table with services immediately accessible", async () => {
    mockEntries = [
      forecastShift({ id: "mixed-night" }),
      forecastShift({
        id: "mixed-saturday",
        date: "2026-07-04",
        type: "DAY",
        startTime: "13:00",
        endTime: "19:00",
        breakMinutes: 0,
      }),
    ];
    const screen = await overview();
    expect(screen.getByLabelText(/^Steuerfrei: (?!0,00)/)).toBeTruthy();
    expect(screen.getByLabelText(/^Steuerpflichtig: (?!0,00)/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Aufschlüsseln" }));
    expect(screen.getByTestId("net-pay-premium-table")).toBeTruthy();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
    expect(screen.getByLabelText(/^Nacht: steuerfrei (?!0,00)/)).toBeTruthy();
    expect(
      screen.getByLabelText(/^Samstag: steuerfrei 0,00.*steuerpflichtig (?!0,00)/),
    ).toBeTruthy();
    expect(screen.getByLabelText(/^Sonntag: steuerfrei/)).toBeTruthy();
    expect(screen.getByLabelText(/^Feiertag: steuerfrei/)).toBeTruthy();
    expect(screen.queryByText(/Die Aufteilung folgt/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Einzelne Dienste" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("net-pay-service-details")).toBeTruthy();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
  });
  it("expands individual services in the net overview without navigation", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: "Einzelne Dienste" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).not.toHaveBeenCalled();
    const services = screen.getByTestId("net-pay-service-details");
    const first = within(services).getAllByRole("button")[0];
    await fireEvent.press(first);
    expect(within(services).getAllByText(/Steuerfrei .*steuerpflichtig/)).toHaveLength(2);
    await fireEvent.press(screen.getByRole("button", { name: "Einzelne Dienste" }));
    expect(screen.queryByTestId("net-pay-service-details")).toBeNull();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
    expect(screen.queryByTestId("net-pay-gross-composition")).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("restores real salary composition routes for services, shift and fixed allowances", async () => {
    mockSettings = null;
    const calculate = payEngine.calculateMonthlyPayEstimate;
    const spy = jest
      .spyOn(payEngine, "calculateMonthlyPayEstimate")
      .mockImplementation((...args) => ({
        ...calculate(...args),
        allowanceAmount: 250,
        tvoedAllowanceAmount: 25,
        careAllowanceAmount: 141.82,
      }));
    try {
      const screen = await render(<SalaryScreen />);
      await fireEvent.press(screen.getByRole("button", { name: /^Gesamtbrutto:/ }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      for (const [label, route] of [
        [/^Zeitzuschläge:/, { pathname: "/premium-details", params: { month: "2026-07" } }],
        [/^Schichtzulage/, { pathname: "/tariff-assessment", params: { month: "2026-07" } }],
        [/^TVöD-Zulage:/, { pathname: "/info-details", params: { section: "TVOED_ALLOWANCE" } }],
        [
          /^Pflegezulage TVöD-P:/,
          { pathname: "/info-details", params: { section: "CARE_ALLOWANCE" } },
        ],
      ] as const) {
        await fireEvent.press(screen.getByRole("button", { name: label }));
        expect(router.push).toHaveBeenLastCalledWith(route);
      }
      expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
      expect(mockSave).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("opens the service breakdown before net setup without expanding gross", async () => {
    mockSettings = null;
    const screen = await render(
      <NetPayAutomaticEntryCard
        month="2026-07"
        proposedGrossCents={500000}
        showPremiumDetails
        blocked={false}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Zuschläge nach Diensten" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/premium-details",
      params: { month: "2026-07" },
    });
    expect(screen.queryByTestId("net-pay-gross-composition")).toBeNull();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("sets up new personal data in three steps while keeping gross visible before setup", async () => {
    mockSettings = null;
    const screen = await render(
      <NetPayAutomaticEntryCard month="2026-07" proposedGrossCents={500000} blocked={false} />,
    );
    expect(screen.getByLabelText(/^Gesamtbrutto:/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Netto einmal einrichten" }));
    expect(screen.getByRole("header", { name: /^Netto einrichten,/ })).toBeTruthy();
    expect(screen.getByRole("header", { name: /^Steuern$/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 1" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Zahlst du Kirchensteuer?: Nein" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByRole("header", { name: /^Familie$/ })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Geburtsdatum (TT.MM.JJJJ)"), "15.01.1990");
    await fireEvent.press(screen.getByRole("radio", { name: "Hast du Kinder?: Nein" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByText("Schritt 3 von 3")).toBeTruthy();
    expect(screen.getAllByRole("header", { name: /^Versicherung & Vorsorge$/ })).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Zusatzversorgung auswählen" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Zusatzversorgung: Weiß ich nicht" }));
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Prognose anzeigen" }));
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ month: "2026-07", version: 2 }),
    );
    expect(screen.getByLabelText(/^Netto vor Zusatzversorgung:/)).toBeTruthy();
  });
  it("cancels setup through the single close action without saving and restarts at the first step", async () => {
    mockSettings = null;
    const screen = await render(
      <NetPayAutomaticEntryCard month="2026-07" proposedGrossCents={500000} blocked={false} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Netto einmal einrichten" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 1" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Zahlst du Kirchensteuer?: Nein" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.queryByRole("button", { name: "Bearbeitung abbrechen" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByText("Schritt 2 von 3")).toBeNull());
    expect(mockSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Netto einmal einrichten" }));
    expect(screen.getByRole("header", { name: /^Netto einrichten,/ })).toBeTruthy();
    expect(screen.getByText("Schritt 1 von 3")).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Steuerklasse: 1" }).props.accessibilityState.checked,
    ).toBe(false);
  });
  it("upgrades an old monthly profile only after explicit setup save", async () => {
    mockSettings = settings();
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: "Netto einmal einrichten" }));
    expect(screen.getByText(/Deine bisherigen Angaben gelten nur/)).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
    for (let step = 0; step < 2; step++)
      await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Zusatzversorgung auswählen" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Zusatzversorgung: Keine" }));
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Prognose anzeigen" }));
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        month: "2026-07",
        automation: expect.objectContaining({ pensionScheme: "NONE" }),
      }),
    );
  });
  it("edits a single section from the current month and retains other data", async () => {
    const initial = automatedSettings("2026-06");
    mockSettings = {
      ...initial,
      profile: { ...initial.profile, healthAdditionalRateBps: 340 },
      automation: {
        ...initial.automation!,
        pensionScheme: "VBL_WEST",
        additionalNetDeductionCents: 1500,
      },
    };
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Meine Netto-Angaben/ }));
    expect(screen.getByText("Gültig ab Juni 2026. Änderungen gelten ab Juli 2026.")).toBeTruthy();
    expect(screen.getByTestId("net-pay-settings-overview")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("button", { name: /Familie · Keine Kinder/ })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /Versicherung & Zusatzversorgung · Gesetzlich · 3,4 % Zusatzbeitrag · VBL West/,
      }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    expect(screen.getAllByTestId("dropdown-modal-content")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 2" }));
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(mockSave).toHaveBeenCalledWith({
      ...mockSettings,
      month: "2026-07",
      profile: { ...mockSettings.profile, taxClass: 2 },
    });
    expect(screen.getByTestId("net-pay-settings-overview")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Meine Netto-Angaben · Klasse 2/ })).toBeTruthy(),
    );
  });
  it("returns to the settings list on back and discards the single-area draft", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Meine Netto-Angaben/ }));
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    expect(screen.queryByRole("button", { name: /^Familie ·/ })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 3" }));
    expect(
      within(screen.getByTestId("selection-sheet-list")).queryByRole("button", {
        name: "Änderungen speichern",
      }),
    ).toBeNull();
    expect(
      within(screen.getByTestId("selection-sheet-footer")).getByRole("button", {
        name: "Änderungen speichern",
      }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zur Angaben-Übersicht" }));
    expect(screen.getByRole("button", { name: /^Steuern · Klasse 1/ })).toBeTruthy();
    expect(screen.getAllByTestId("dropdown-modal-content")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    expect(screen.getByRole("radio", { name: "Steuerklasse: 1", checked: true })).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("closes without saving and restores the stored answers on reopening", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Meine Netto-Angaben/ }));
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 3" }));
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
    await fireEvent.press(screen.getByRole("button", { name: /^Meine Netto-Angaben/ }));
    expect(screen.getByTestId("net-pay-settings-overview")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Steuern · Klasse 1/ })).toBeTruthy();
    expect(screen.getAllByTestId("dropdown-modal-content")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    expect(
      screen.getByRole("radio", { name: "Steuerklasse: 1" }).props.accessibilityState.checked,
    ).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("labels saved private insurance explicitly in the settings overview", async () => {
    mockSettings = { ...automatedSettings("2026-06"), specialCases: ["PRIVATE_INSURANCE"] };
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Meine Netto-Angaben/ }));
    expect(
      screen.getByRole("button", { name: /^Versicherung & Zusatzversorgung · Privat versichert/ }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Versicherung & Zusatzversorgung · Gesetzlich/ }),
    ).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("keeps an edit open on a write conflict without overwriting the result", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Meine Netto-Angaben/ }));
    await fireEvent.press(screen.getByRole("button", { name: /^Familie ·/ }));
    mockSave.mockRejectedValueOnce(
      new Error("Die Angaben wurden zwischenzeitlich geändert. Erneut laden."),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(screen.getByText(/zwischenzeitlich geändert/)).toBeTruthy();
    expect(screen.getByRole("header", { name: "Familie" })).toBeTruthy();
    expect(screen.queryByTestId("net-pay-settings-overview")).toBeNull();
    expect(screen.getAllByTestId("dropdown-modal-content")).toHaveLength(1);
  });
  it("keeps the 2027 marker and unknown pension qualifier visible", async () => {
    mockEntries = [forecastShift({ date: "2027-01-03" })];
    mockSettings = {
      ...automatedSettings("2026-06"),
      automation: { ...automatedSettings().automation!, pensionScheme: "UNKNOWN" },
    };
    const screen = await overview("2027-01");
    expect(screen.getByText("2027 vorläufig · Abzüge nach Stand 2026")).toBeTruthy();
    expect(screen.getByText("Zusatzversorgung offen")).toBeTruthy();
    expect(screen.getByLabelText(/^Netto vor Zusatzversorgung: ca\. [\d.]+\s€$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Berechnungsgrundlagen" }));
    expect(screen.getByLabelText(/^Netto rechnerisch \(vorläufig\):/)).toBeTruthy();
    expect(screen.getByText(/Beiträge zur Zusatzversorgung und ihre Auswirkungen/)).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("updates the displayed net when calendar work changes", async () => {
    const screen = await overview();
    const before = screen.getByLabelText(/^Netto-Prognose:/).props.accessibilityLabel;
    mockEntries = [forecastShift({ endTime: "04:00" })];
    await screen.rerender(<NetPayAutomaticScreen month="2026-07" />);
    expect(screen.getByLabelText(/^Netto-Prognose:/).props.accessibilityLabel).not.toBe(before);
  });
  it("closes prior-month details when changing months", async () => {
    const screen = await render(
      <NetPayAutomaticEntryCard month="2026-07" proposedGrossCents={500000} blocked={false} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    await screen.rerender(
      <NetPayAutomaticEntryCard month="2026-08" proposedGrossCents={500000} blocked={false} />,
    );
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("keeps personal settings to three areas without a manual calculator", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Meine Netto-Angaben/ }));
    expect(screen.queryByRole("button", { name: "Manuellen Rechner öffnen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Weitere Möglichkeiten" })).toBeNull();
    for (const area of [/^Steuern ·/, /^Familie ·/, /^Versicherung & Zusatzversorgung ·/])
      expect(screen.getByRole("button", { name: area })).toBeTruthy();
  });
  it("routes a missing future tariff to salary data without repeating tax setup", async () => {
    mockEntries = [forecastShift({ date: "2027-04-04" })];
    const screen = await overview("2027-04");
    expect(screen.queryByLabelText(/^Netto-Prognose:/)).toBeNull();
    expect(screen.getByRole("button", { name: "Gehaltsgrundlage ansehen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
  });
  it("blocks personal data and results in test months", async () => {
    mockTestMonths = ["2026-07"];
    const screen = await overview();
    expect(screen.queryByLabelText(/^Netto-Prognose:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Meine Netto-Angaben/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Netto einmal einrichten" })).toBeNull();
    expect(screen.getByText(/In einem aktiven Testmonat/)).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
