import * as MockReact from "react";
import { Temporal } from "@js-temporal/polyfill";
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
import { SalaryDetailsScreen } from "./salary-details-screen";
import type { SalaryDetailSection } from "@/navigation/routes";
import * as Native from "react-native";
import * as PaletteModule from "@/theme/palette";
import { DARK_PALETTE } from "@/theme/palette-values";
import { AppErrorBoundary } from "@/ui/app-error-boundary";
import { AnalysisNetPayRow } from "@/features/analysis/analysis-net-pay-row";
import { PayListCard } from "@/features/analysis/dashboard-cards";
const mockExport = jest.fn<(props: { period: string; variant: string }) => void>();
jest.mock("@/features/report-export/report-export-button", () => ({
  ReportExportButton: (props: { period: string; variant: string }) => {
    mockExport(props);
    return null;
  },
}));

let mockParams: { month: string; section?: SalaryDetailSection } = { month: "2026-07" };
let mockSettings: MonthlyNetPaySettings | null = automatedSettings("2026-06");
let mockProfile = forecastProfile;
let mockMonth = "2026-07";
const mockSetMonth = jest.fn<(month: string) => void>((month) => {
  mockMonth = month;
});
const mockCoordinator = { getMonth: () => mockMonth, setMonth: mockSetMonth };
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
  router: {
    back: jest.fn(),
    push: jest.fn(),
    setParams: jest.fn<(mockNextParams: Partial<typeof mockParams>) => void>((mockNextParams) => {
      mockParams = { ...mockParams, ...mockNextParams };
    }),
  },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: jest.fn(),
}));
jest.mock("@/navigation/active-month", () => ({
  useActiveMonthCoordinator: () => mockCoordinator,
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
    mockParams = { month: "2026-07" };
    mockMonth = "2026-07";
    mockProfile = forecastProfile;
    mockExport.mockClear();
    mockSettings = automatedSettings("2026-06");
    mockEntries = [forecastShift()];
    mockTestMonths = [];
    mockSave.mockReset().mockResolvedValue(undefined);
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    jest.mocked(router.push).mockClear();
    jest.mocked(router.back).mockClear();
    jest.mocked(router.setParams).mockClear();
  });
  async function overview(month = "2026-07") {
    return render(<NetPayAutomaticScreen month={month} />);
  }
  async function details(section: SalaryDetailSection, month = "2026-07") {
    mockParams = { month, section };
    return render(<SalaryDetailsScreen />);
  }
  it("shows a compact overview with unchanged computed values and no inline details", async () => {
    mockEntries = [forecastShift({ id: "new-overview-values" })];
    const calculate = jest.spyOn(forecastEngine, "calculateAutomaticNetPayForecast");
    const screen = await overview();
    const computed = calculate.mock.results.at(-1)!.value as ReturnType<
      typeof forecastEngine.calculateAutomaticNetPayForecast
    >;
    const result = computed.result;
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Fixture unavailable");
    const euro = (cents: number) =>
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
    expect(
      screen.getByLabelText("Voraussichtliches Netto: " + euro(result.pay.netCents)),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Gesamtbrutto: " + euro(result.pay.amounts.grossCents)),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Steuerfrei: " + euro(result.classification.taxFreeCents)),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Steuerpflichtig: " +
          euro(result.classification.paidPremiumCents - result.classification.taxFreeCents),
      ),
    ).toBeTruthy();
    expect(screen.getByRole("header", { name: "Netto-Prognose" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gehaltsbestandteile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zuschläge je Dienst" })).toBeTruthy();
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    expect(screen.queryByTestId("net-pay-gross-composition")).toBeNull();
    calculate.mockRestore();
  });
  it("uses the same overview for the existing automatic route", async () => {
    const screen = await render(<NetPayScreen />);
    expect(screen.getByText("Gehaltsprognose")).toBeTruthy();
    expect(screen.getByLabelText(/^Voraussichtliches Netto:/)).toBeTruthy();
  });
  it("shows the same calculated net in the monthly analysis salary table", async () => {
    mockEntries = [forecastShift({ id: "analysis-net-value" })];
    const calculate = jest.spyOn(forecastEngine, "calculateAutomaticNetPayForecast");
    try {
      const salary = await overview();
      const expectedLabel =
        salary.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel;
      const computed = calculate.mock.results.at(-1)!.value as ReturnType<
        typeof forecastEngine.calculateAutomaticNetPayForecast
      >;
      if (computed.result.status !== "available") throw new Error("Fixture unavailable");
      const openSalary = jest.fn();
      const table = await render(
        <PayListCard
          onPress={openSalary}
          gross={computed.result.pay.amounts.grossCents / 100}
          caption="Unverbindliche Brutto-Schätzung"
          netRow={<AnalysisNetPayRow month="2026-07" />}
        />,
      );
      expect(table.getByLabelText(expectedLabel)).toBeTruthy();
      expect(within(table.getByTestId("analysis-net-pay-row")).queryByRole("button")).toBeNull();
      await fireEvent.press(table.getByRole("button", { name: /^Gehalt,/ }));
      expect(openSalary).toHaveBeenCalledTimes(1);
      expect(table.getByLabelText(/^Brutto gesamt:/)).toBeTruthy();
      expect(calculate).toHaveBeenCalledTimes(1);
      expect(mockSave).not.toHaveBeenCalled();
    } finally {
      calculate.mockRestore();
    }
  });
  it("updates the informational analysis net when the month changes", async () => {
    const screen = await render(<AnalysisNetPayRow month="2026-07" />);
    const before = screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel;
    await screen.rerender(<AnalysisNetPayRow month="2026-08" />);
    const next = screen.getByLabelText(/^Voraussichtliches Netto:/);
    expect(next.props.accessibilityLabel).not.toBe(before);
    expect(screen.queryByRole("button")).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("does not invent a net amount without setup or in a test month", async () => {
    mockSettings = null;
    const screen = await render(<AnalysisNetPayRow month="2026-07" />);
    expect(screen.getByLabelText("Voraussichtliches Netto: Noch nicht eingerichtet")).toBeTruthy();
    mockTestMonths = ["2026-07"];
    await screen.rerender(<AnalysisNetPayRow month="2026-07" />);
    expect(screen.getByLabelText("Voraussichtliches Netto: Im Testmonat gesperrt")).toBeTruthy();
    expect(screen.queryByText(/€/)).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("opens a separate deduction route and reuses the computed result", async () => {
    mockEntries = [forecastShift({ id: "direct-details-cache" })];
    const calculate = jest.spyOn(forecastEngine, "calculateAutomaticNetPayForecast");
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "deductions" },
    });
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    const detail = await details("deductions");
    expect(detail.getByLabelText(/^Krankenversicherung:/)).toBeTruthy();
    expect(detail.getByLabelText(/^Steuerbrutto:/)).toBeTruthy();
    expect(detail.getByLabelText(/^Solidaritätszuschlag:/)).toBeTruthy();
    expect(detail.getByText("Krankenversicherung einschließlich Zusatzbeitrag.")).toBeTruthy();
    expect(calculate).toHaveBeenCalledTimes(1);
    calculate.mockRestore();
  });
  it("shows every deduction and its calculation basis on the dedicated page", async () => {
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
    const screen = await details("deductions");
    for (const label of [
      "Kirchensteuer",
      "Zusatzversorgung",
      "Weitere Netto-Abzüge",
      "Solidaritätszuschlag",
      "Steuerbrutto",
      "SV-Brutto",
    ])
      expect(screen.getByLabelText(new RegExp("^" + label + ":"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
  });
  it("routes gross and the component entry to the same dedicated page", async () => {
    const screen = await overview();
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    for (const name of [/^Gesamtbrutto:/, /^Gehaltsbestandteile$/]) {
      await fireEvent.press(screen.getByRole("button", { name }));
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/salary-details",
        params: { month: "2026-07", section: "components" },
      });
    }
    expect(screen.queryByTestId("net-pay-gross-composition")).toBeNull();
    const detail = await details("components");
    expect(detail.getByLabelText(/^Grundentgelt:/)).toBeTruthy();
    expect(detail.getByRole("button", { name: "Berechnungsgrundlagen" })).toBeTruthy();
  });
  it("shows relevant premium types on their own page without zero-filled columns", async () => {
    mockEntries = [
      forecastShift({ id: "mixed-night", date: "2026-07-03" }),
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
    await fireEvent.press(screen.getByRole("button", { name: "Aufteilung ansehen" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "premiums" },
    });
    const detail = await details("premiums");
    expect(detail.getByLabelText(/^Nacht:/)).toBeTruthy();
    expect(detail.getByLabelText(/^Samstag:/)).toBeTruthy();
    expect(detail.queryByTestId("net-pay-premium-table")).toBeNull();
    expect(detail.queryByLabelText(/^Sonntag:/)).toBeNull();
    expect(detail.getByLabelText(/^Sozialversicherungsfrei:/)).toBeTruthy();
    expect(detail.getByRole("button", { name: "Berechnung der Zuschläge" })).toBeTruthy();
  });
  it("opens a service sheet on a separate list and retains the list when closing", async () => {
    mockEntries = [forecastShift({ date: "2026-07-03" })];
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: "Zuschläge je Dienst" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "services" },
    });
    expect(screen.queryByTestId("net-pay-service-details")).toBeNull();
    const detail = await details("services");
    const list = detail.getByTestId("net-pay-service-details");
    const row = within(list).getByRole("button", { name: /03\.07/ });
    const label = row.props.accessibilityLabel;
    await fireEvent.press(row);
    expect(detail.getByTestId("dropdown-modal-content")).toBeTruthy();
    expect(detail.getByText(/endet am 04\.07/)).toBeTruthy();
    expect(detail.getByLabelText(/^Gesamt:/)).toBeTruthy();
    await fireEvent.press(detail.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(detail.queryByTestId("dropdown-modal-content")).toBeNull());
    expect(detail.getByTestId("net-pay-service-details")).toBe(list);
    expect(detail.getByRole("button", { name: label })).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("opens the service list and next-day sheet without Temporal runtime localization", async () => {
    const locale = jest
      .spyOn(Temporal.PlainDate.prototype, "toLocaleString")
      .mockImplementation(() => {
        throw new RangeError("Unsupported runtime localization");
      });
    try {
      mockParams = { month: "2026-07", section: "services" };
      mockEntries = [
        forecastShift({
          id: "runtime-locale-service",
          date: "2026-07-03",
          startTime: "21:00",
          endTime: "07:30",
        }),
      ];
      const screen = await render(
        <AppErrorBoundary>
          <SalaryDetailsScreen />
        </AppErrorBoundary>,
      );
      expect(screen.queryByText("Diagnosecode: APP_RENDER_FAILED")).toBeNull();
      expect(screen.getByTestId("net-pay-service-details")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: /^Fr\. 03\.07\.:/ }));
      expect(screen.getByText(/endet am 04\.07\./)).toBeTruthy();
      expect(screen.getByText("Beginn: Fr. 03.07. · 21:00")).toBeTruthy();
      expect(screen.getByText("Ende: Sa. 04.07. · 07:30")).toBeTruthy();
      expect(screen.getByLabelText(/^Gesamt:/)).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
      await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
      expect(screen.getByRole("button", { name: /^Fr\. 03\.07\.:/ })).toBeTruthy();
      expect(locale).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    } finally {
      locale.mockRestore();
    }
  });
  it("keeps the selected service filter and month after closing a shift sheet", async () => {
    mockEntries = [
      forecastShift({ id: "filtered-night", date: "2026-07-03" }),
      forecastShift({
        id: "filtered-sunday",
        date: "2026-07-05",
        startTime: "08:00",
        endTime: "16:00",
      }),
    ];
    const screen = await details("services");
    const summary = screen.getByLabelText(/^Zeitzuschläge:/).props.accessibilityLabel;
    const list = within(screen.getByTestId("net-pay-service-details"));
    expect(list.getByRole("radio", { name: "Alle" }).props.accessibilityState.checked).toBe(true);
    expect(list.getByRole("button", { name: /^So\. 05\.07\.:/ })).toBeTruthy();
    await fireEvent.press(list.getByRole("radio", { name: "Nacht" }));
    expect(list.getByRole("radio", { name: "Alle" }).props.accessibilityState.checked).toBe(false);
    expect(list.getByRole("radio", { name: "Nacht" }).props.accessibilityState.checked).toBe(true);
    expect(list.queryByRole("button", { name: /^So\. 05\.07\.:/ })).toBeNull();
    const night = list.getByRole("button", { name: /^Fr\. 03\.07\.:/ });
    const filteredAmount = night.props.accessibilityLabel;
    await fireEvent.press(night);
    expect(screen.getByText(/endet am 04\.07\./)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
    expect(list.getByRole("radio", { name: "Nacht" }).props.accessibilityState.checked).toBe(true);
    expect(list.getByRole("button", { name: filteredAmount })).toBeTruthy();
    expect(screen.getByText("Juli 2026")).toBeTruthy();
    expect(screen.getByLabelText(/^Zeitzuschläge:/).props.accessibilityLabel).toBe(summary);
    await fireEvent.press(list.getByRole("radio", { name: "Alle" }));
    expect(list.getByRole("button", { name: /^So\. 05\.07\.:/ })).toBeTruthy();
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
      const screen = await details("components");
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      for (const [label, route] of [
        [
          /^Zeitzuschläge:/,
          { pathname: "/salary-details", params: { month: "2026-07", section: "premiums" } },
        ],
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
    await fireEvent.press(screen.getByRole("button", { name: "Zuschläge je Dienst" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "services" },
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
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
      expect(screen.getByRole("button", { name: /Netto-Einstellungen.*Klasse 2/ })).toBeTruthy(),
    );
  });
  it("returns to the settings list on back and discards the single-area draft", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 3" }));
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
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
    expect(screen.getByLabelText(/^Netto vor Zusatzversorgung: [\d.]+\s€$/)).toBeTruthy();
    const deduction = await details("deductions", "2027-01");
    expect(deduction.getByLabelText(/^Netto rechnerisch \(vorläufig\):/)).toBeTruthy();
    expect(deduction.getByText(/Beiträge zur Zusatzversorgung und ihre Auswirkungen/)).toBeTruthy();
    for (const section of ["premiums", "services"] as const) {
      const detail = await details(section, "2027-01");
      expect(detail.getByText("2027 vorläufig · Abzüge nach Stand 2026")).toBeTruthy();
    }
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("updates the displayed net when calendar work changes", async () => {
    const screen = await overview();
    const before = screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel;
    mockEntries = [forecastShift({ endTime: "04:00" })];
    await screen.rerender(<NetPayAutomaticScreen month="2026-07" />);
    expect(screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel).not.toBe(
      before,
    );
  });
  it("closes prior-month settings when changing months", async () => {
    const screen = await render(
      <NetPayAutomaticEntryCard month="2026-07" proposedGrossCents={500000} blocked={false} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
    await screen.rerender(
      <NetPayAutomaticEntryCard month="2026-08" proposedGrossCents={500000} blocked={false} />,
    );
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("keeps personal settings to three areas without a manual calculator", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
    expect(screen.queryByRole("button", { name: "Manuellen Rechner öffnen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Weitere Möglichkeiten" })).toBeNull();
    for (const area of [/^Steuern ·/, /^Familie ·/, /^Versicherung & Zusatzversorgung ·/])
      expect(screen.getByRole("button", { name: area })).toBeTruthy();
  });
  it("routes a missing future tariff to salary data without repeating tax setup", async () => {
    mockEntries = [forecastShift({ date: "2027-04-04" })];
    const screen = await overview("2027-04");
    expect(screen.queryByLabelText(/^Voraussichtliches Netto:/)).toBeNull();
    expect(screen.getByRole("button", { name: "Gehaltsgrundlage ansehen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
  });
  it("blocks personal data and results in test months", async () => {
    mockTestMonths = ["2026-07"];
    const screen = await overview();
    expect(screen.queryByLabelText(/^Voraussichtliches Netto:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Netto-Einstellungen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Netto einmal einrichten" })).toBeNull();
    expect(screen.getByText(/In einem aktiven Testmonat/)).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("passes the selected month to detail navigation and the header export after switching", async () => {
    const screen = await render(<SalaryScreen />);
    const before = screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel;
    await fireEvent.press(screen.getByRole("button", { name: /^Nächster Monat/ }));
    expect(screen.getByText("August 2026")).toBeTruthy();
    expect(mockSetMonth).toHaveBeenLastCalledWith("2026-08");
    expect(mockExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ period: "2026-08", variant: "icon" }),
    );
    expect(screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel).not.toBe(
      before,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Gehaltsbestandteile" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-08", section: "components" },
    });
    await fireEvent.press(screen.getByRole("button", { name: /^Vorheriger Monat/ }));
    expect(screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel).toBe(
      before,
    );
  });
  it("switches the component month without adding history and updates all linked details", async () => {
    const screen = await details("components");
    const before = screen.getByLabelText(/^Gesamtbrutto:/).props.accessibilityLabel;
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    await fireEvent.press(screen.getByRole("button", { name: /^Nächster Monat/ }));
    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2026-08" });
    expect(router.push).not.toHaveBeenCalled();
    expect(mockCoordinator.getMonth()).toBe("2026-08");
    await screen.rerender(<SalaryDetailsScreen />);
    expect(screen.getByText("August 2026")).toBeTruthy();
    expect(screen.getByLabelText(/^Gesamtbrutto:/).props.accessibilityLabel).not.toBe(before);
    expect(screen.getByRole("header", { name: "Zusammensetzung" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Netto-Berechnung" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-08", section: "deductions" },
    });
    await fireEvent.press(screen.getByRole("button", { name: "Berechnungsgrundlagen" }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-08", section: "basis" },
    });
    await fireEvent.press(screen.getByRole("button", { name: /^Vorheriger Monat/ }));
    await screen.rerender(<SalaryDetailsScreen />);
    expect(screen.getByLabelText(/^Gesamtbrutto:/).props.accessibilityLabel).toBe(before);
    expect(mockCoordinator.getMonth()).toBe("2026-07");
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("rejects invalid detail links without calculating a different month", async () => {
    mockParams = { month: "2026-99", section: "services" };
    const calculate = jest.spyOn(payEngine, "calculateMonthlyPayEstimate");
    const screen = await render(<SalaryDetailsScreen />);
    expect(screen.getByText("Der Link enthält keinen gültigen Monat oder Bereich.")).toBeTruthy();
    expect(calculate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("net-pay-service-details")).toBeNull();
  });
  it("shows an empty month without hiding fixed salary or adding premium rows", async () => {
    mockEntries = [];
    const screen = await render(<SalaryScreen />);
    expect(screen.getByText("Noch keine Dienste in diesem Monat")).toBeTruthy();
    expect(screen.getByLabelText(/^Gesamtbrutto:/)).toBeTruthy();
    const detail = await details("services");
    expect(detail.getByLabelText(/^Keine Zeitzuschläge\./)).toBeTruthy();
    expect(detail.queryByTestId("dropdown-modal-content")).toBeNull();
  });
  it("preserves manual gross salary and its separate component access", async () => {
    mockSettings = null;
    mockProfile = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 450000 };
    const screen = await render(<SalaryScreen />);
    expect(screen.getByLabelText(/^Gesamtbrutto: 4.500,00/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zuschläge je Dienst" })).toBeNull();
    const detail = await details("components");
    expect(detail.getByLabelText(/^Monatsbrutto: 4.500,00/)).toBeTruthy();
  });
  it("keeps full labels and money at small widths, larger type and in dark mode", async () => {
    jest
      .spyOn(Native, "useWindowDimensions")
      .mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 2 });
    jest.spyOn(PaletteModule, "usePalette").mockReturnValue(DARK_PALETTE);
    const screen = await details("deductions");
    const amount = screen.getByLabelText(/^Arbeitslosenversicherung:/);
    const content = amount.children[0];
    if (typeof content === "string") throw new Error("Missing amount row content");
    expect(Native.StyleSheet.flatten(content.props.style).flexDirection).toBe("column");
    expect(screen.getByText("Arbeitslosenversicherung").props.numberOfLines).toBeUndefined();
    expect(
      Native.StyleSheet.flatten(screen.getByText("Arbeitslosenversicherung").props.style).color,
    ).toBe(DARK_PALETTE.textMuted);
    const summary = await overview();
    const gross = summary.getByLabelText(/^Gesamtbrutto:/);
    const metricStyle =
      typeof gross.props.style === "function"
        ? gross.props.style({ pressed: false })
        : gross.props.style;
    expect(Native.StyleSheet.flatten(metricStyle).flexBasis).toBe("100%");
    expect(summary.getByLabelText(/^Voraussichtliches Netto:/).props.numberOfLines).toBeUndefined();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
