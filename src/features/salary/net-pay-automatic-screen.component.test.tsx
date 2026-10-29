import type { AllowanceStatus, UserProfile } from "@/domain/types";
import * as MockReact from "react";
import { Temporal } from "@js-temporal/polyfill";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
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
    const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
    return <MockText testID="salary-export-current">{props.period}</MockText>;
  },
}));

let mockParams: { month: string; section?: SalaryDetailSection } = { month: "2026-07" };
let mockSettings: MonthlyNetPaySettings | null = automatedSettings("2026-06");
let mockAnnualPayments: readonly AnnualSalaryPayment[] | undefined;
let mockProfile = forecastProfile;
let mockMonth = "2026-07";
const mockSetMonth = jest.fn<(month: string) => void>((month) => {
  mockMonth = month;
});
const mockCoordinator = { getMonth: () => mockMonth, setMonth: mockSetMonth };
let mockEntries = [forecastShift()];
let mockTestMonths: string[] = [];
const mockResetAnnual = jest.fn<() => Promise<void>>();
const mockSave =
  jest.fn<(value: MonthlyNetPaySettings, effectiveMonth?: string) => Promise<void>>();
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
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void) => MockReact.useEffect(callback, [callback]),
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
      timeline: value ? [{ settings: value, revision: 1 }] : [],
      annualPayments: mockAnnualPayments ?? value?.automation?.annualPayments,
      error: null,
      busy: false,
      reload: jest.fn(),
      resetAnnualPayments: async () => {
        await mockResetAnnual();
        if (value?.automation) {
          const year = mockParams.month.slice(0, 4);
          const next = {
            ...value,
            automation: {
              ...value.automation,
              annualPayments: value.automation.annualPayments?.filter(
                (payment) => !payment.payoutMonth.startsWith(`${year}-`),
              ),
            },
          };
          mockSettings = next;
          mockAnnualPayments = undefined;
          setValue(next);
        }
      },
      save: async (next: MonthlyNetPaySettings, effectiveMonth?: string) => {
        if (effectiveMonth) await mockSave(next, effectiveMonth);
        else await mockSave(next);
        setValue(effectiveMonth ? { ...next, month: effectiveMonth } : next);
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
    mockAnnualPayments = undefined;
    mockEntries = [forecastShift()];
    mockTestMonths = [];
    mockSave.mockReset().mockResolvedValue(undefined);
    mockResetAnnual.mockReset().mockResolvedValue(undefined);
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
  it("passes the chosen effective month from the salary editor to persistence", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByText("Netto-Angaben"));
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Gültig ab auswählen: Juli 2026" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Gültig ab: Januar 2026" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 4" }));
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        month: "2026-07",
        profile: expect.objectContaining({ taxClass: 4 }),
      }),
      "2026-01",
    );
  });
  it("does not show saved November Christmas pay or its explanation in October", async () => {
    mockEntries = [];
    const initial = automatedSettings("2026-01");
    mockSettings = {
      ...initial,
      automation: {
        ...initial.automation!,
        annualPayments: [
          {
            revision: 1,
            payoutMonth: "2026-11",
            grossCents: 381_816,
            netBasis: { kind: "CONSTANT_PAY" },
          },
        ],
      },
    };
    const screen = await overview("2026-10");
    expect(screen.queryByText(/Jahressonderzahlung/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Anpassen,/ })).toBeNull();
    expect(screen.getByRole("header", { name: "Netto-Prognose" })).toBeTruthy();
    await screen.unmount();
    const basis = await details("basis", "2026-10");
    expect(basis.queryByText(/Jahressonderzahlung/)).toBeNull();
    expect(basis.queryByText(/vollem Jahresanspruch/)).toBeNull();
    await basis.unmount();
    const november = await overview("2026-11");
    expect(november.getByRole("header", { name: "Jahressonderzahlung" })).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("includes tariff Christmas pay and net automatically without opening or saving a form", async () => {
    mockEntries = [];
    const screen = await overview("2026-11");
    expect(screen.getByText("Jahressonderzahlung enthalten")).toBeTruthy();
    expect(screen.getByText("Automatisch nach Tarif · November 2026")).toBeTruthy();
    expect(screen.queryByLabelText("Jahressonderzahlung brutto (€)")).toBeNull();
    expect(screen.queryByText(/Jahresprognose mit gleichbleibendem/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Anpassen,/ })).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("keeps the analysis calculation order from components to bonus to gross and net", async () => {
    const screen = await render(
      <PayListCard
        onPress={jest.fn()}
        base={4000}
        premiums={200}
        allowances={150}
        annualPayments={3600}
        gross={7950}
        caption="Unverbindliche Schätzung"
        netRow={<AnalysisNetPayRow month="2026-11" />}
      />,
    );
    const output = JSON.stringify(screen.toJSON());
    const labels = [
      "Grundgehalt",
      "Zeitzuschläge",
      "Weitere Zulagen",
      "Jahressonderzahlung",
      "Brutto geschätzt",
      "Voraussichtliches Netto",
    ];
    for (let i = 1; i < labels.length; i++) {
      expect(output.indexOf(labels[i - 1])).toBeGreaterThan(-1);
      expect(output.indexOf(labels[i])).toBeGreaterThan(output.indexOf(labels[i - 1]));
    }
    expect(screen.queryByText(/Jahresprognose mit gleichbleibendem/)).toBeNull();
  });
  it("opens the affected service rather than tariff settings for missing service times", async () => {
    const spy = jest.spyOn(forecastEngine, "calculateAutomaticNetPayForecast").mockReturnValue({
      sourceMonth: "2026-06",
      recovery: { kind: "entry", date: "2026-07-03", entryId: "missing-times" },
      result: { status: "unavailable", stage: "sfn", reason: "Prüfe die Zeiten dieses Dienstes." },
    });
    try {
      mockEntries = [forecastShift({ id: "recovery-entry" })];
      const screen = await overview();
      await fireEvent.press(screen.getByRole("button", { name: "Dienstzeiten prüfen" }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/shift-editor",
        params: { date: "2026-07-03", mode: "SHIFT", entryId: "missing-times" },
      });
    } finally {
      spy.mockRestore();
    }
  });
  it("does not suggest tariff settings for an unexplained technical forecast failure", async () => {
    const spy = jest.spyOn(forecastEngine, "calculateAutomaticNetPayForecast").mockReturnValue({
      sourceMonth: "2026-06",
      result: {
        status: "unavailable",
        stage: "sfn",
        reason: "Die Berechnung ist nicht verfügbar.",
      },
    });
    try {
      mockEntries = [forecastShift({ id: "recovery-technical" })];
      const screen = await overview();
      expect(screen.queryByRole("button", { name: "Gehaltsgrundlage ansehen" })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
  it("opens the service when its invalid pause prevents the gross calculation", async () => {
    mockEntries = [
      forecastShift({ id: "invalid-pause-ui", date: "2026-07-03", breakMinutes: 9999 }),
    ];
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: "Dienstzeiten prüfen" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/shift-editor",
      params: { date: "2026-07-03", mode: "SHIFT", entryId: "invalid-pause-ui" },
    });
  });
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
    expect(screen.queryByRole("button", { name: "Gehaltsbestandteile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zuschläge je Dienst" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Gesamtbrutto:/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Abzüge:/ })).toHaveLength(1);
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
      expect(table.getByLabelText(/^Brutto geschätzt:/)).toBeTruthy();
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
      "Brutto für Sozialversicherung",
    ])
      expect(screen.getByLabelText(new RegExp("^" + label + ":"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "So rechnen wir" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/info-details",
      params: { section: "CALCULATION" },
    });
  });
  it("keeps gross as the single component entry when the amount is present", async () => {
    const screen = await overview();
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    await fireEvent.press(screen.getByRole("button", { name: /^Gesamtbrutto:/ }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "components" },
    });
    expect(screen.queryByRole("button", { name: "Gehaltsbestandteile" })).toBeNull();
    expect(screen.queryByTestId("net-pay-gross-composition")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Berechnungsgrundlagen" }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "basis" },
    });
    const detail = await details("components");
    expect(detail.getByLabelText(/^Grundentgelt:/)).toBeTruthy();
    expect(detail.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
    expect(detail.queryByRole("button", { name: /^Abzüge:/ })).toBeNull();
    expect(detail.getByLabelText(/^Abzüge:/)).toBeTruthy();
  });
  it("retains a component fallback when there is no gross amount to press", async () => {
    mockSettings = null;
    const screen = await render(
      <NetPayAutomaticEntryCard month="2026-08" proposedGrossCents={null} blocked={false} />,
    );
    expect(screen.queryByRole("button", { name: /^Gesamtbrutto:/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Gehaltsbestandteile" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-08", section: "components" },
    });
    expect(mockSave).not.toHaveBeenCalled();
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
    await fireEvent.press(detail.getByRole("button", { name: "Berechnung der Zuschläge" }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "basis" },
    });
    const basis = await details("basis");
    expect(basis.getByText(/Samstagszuschläge, bezahlte Pausen/)).toBeVisible();
    expect(basis.getByText(/Dafür gelten eigene Höchstgrenzen/)).toBeVisible();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("opens a service sheet on a separate list and retains the list when closing", async () => {
    mockEntries = [forecastShift({ date: "2026-07-03" })];
    const screen = await overview();
    expect(screen.queryByRole("button", { name: "Zuschläge je Dienst" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Aufteilung ansehen" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "premiums" },
    });
    const premium = await details("premiums");
    await fireEvent.press(premium.getByRole("button", { name: "Zuschläge je Dienst" }));
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
  it.each<[AllowanceStatus | null, AllowanceStatus, string]>([
    ["SHIFT_MONTHLY", "ALTERNATING_MONTHLY", "Ständige Schichtzulage"],
    ["SHIFT_HOURLY", "ALTERNATING_MONTHLY", "Nichtständige Schichtzulage"],
    ["ALTERNATING_MONTHLY", "SHIFT_MONTHLY", "Ständige Wechselschichtzulage"],
    ["ALTERNATING_HOURLY", "SHIFT_MONTHLY", "Nichtständige Wechselschichtzulage"],
    [null, "ALTERNATING_MONTHLY", "Ständige Wechselschichtzulage"],
    [null, "SHIFT_MONTHLY", "Ständige Schichtzulage"],
  ])("keeps gross read-only with allowance %s / %s", async (confirmed, suggested, label) => {
    mockSettings = null;
    const calculate = payEngine.calculateMonthlyPayEstimate;
    const spy = jest
      .spyOn(payEngine, "calculateMonthlyPayEstimate")
      .mockImplementation((...args) => {
        const pay = calculate(...args);
        return {
          ...pay,
          allowanceAmount: 250,
          tvoedAllowanceAmount: 25,
          careAllowanceAmount: 141.82,
          confirmedAllowance: confirmed,
          assessment: { ...pay.assessment, suggestedAllowance: suggested },
        };
      });
    try {
      const screen = await details("components");
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      for (const name of [
        /^Zeitzuschläge:/,
        new RegExp(`^${label}:`),
        /^TVöD-Zulage:/,
        /^Pflegezulage TVöD-P:/,
        /^Abzüge:/,
      ]) {
        expect(screen.getByLabelText(name).props.onPress).toBeUndefined();
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      expect(screen.getByLabelText(new RegExp(`^${label}: 250,00`))).toBeTruthy();
      expect(screen.queryByText("Geschätzt") !== null).toBe(confirmed === null);
      if (confirmed === null)
        expect(screen.getByLabelText(new RegExp(`^${label}:.*Geschätzt`))).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Zulage prüfen" })).toBeNull();
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
      expect(mockSave).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it.each([false, true])(
    "opens one allowance review directly from salary (net setup: %s)",
    async (configured) => {
      if (!configured) mockSettings = null;
      mockParams = { month: "2026-08" };
      const screen = await render(<SalaryScreen />);
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(screen.getAllByRole("button", { name: "Zulage prüfen" })).toHaveLength(1);
      await fireEvent.press(screen.getByRole("button", { name: "Zulage prüfen" }));
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/tariff-assessment",
        params: { month: "2026-08" },
      });
      expect(mockSave).not.toHaveBeenCalled();
    },
  );
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
    expect(screen.queryByRole("button", { name: "Zuschläge je Dienst" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Zeitzuschläge" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "premiums" },
    });
    const premium = await details("premiums");
    expect(premium.getByText("Netto-Aufteilung nicht verfügbar")).toBeTruthy();
    await fireEvent.press(premium.getByRole("button", { name: "Zuschläge je Dienst" }));
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
    expect(screen.queryByRole("button", { name: /^Netto-Angaben/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Netto einmal einrichten" })).toHaveLength(1);
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Angaben/ }));
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
      expect(screen.getByRole("button", { name: /^Netto-Angaben.*Steuerklasse 2/ })).toBeTruthy(),
    );
  });
  it("returns to the settings list on back and discards the single-area draft", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Angaben/ }));
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Angaben/ }));
    await fireEvent.press(screen.getByRole("button", { name: /^Steuern ·/ }));
    await fireEvent.press(screen.getByRole("radio", { name: "Steuerklasse: 3" }));
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Angaben/ }));
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Angaben.*Steuerklasse/ }));
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Angaben/ }));
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
    expect(screen.getByText("Zusatzversorgung nicht berücksichtigt")).toBeTruthy();
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
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Angaben/ }));
    await screen.rerender(
      <NetPayAutomaticEntryCard month="2026-08" proposedGrossCents={500000} blocked={false} />,
    );
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("keeps personal settings to three areas without a manual calculator", async () => {
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Angaben/ }));
    expect(screen.queryByRole("button", { name: "Manuellen Rechner öffnen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Weitere Möglichkeiten" })).toBeNull();
    for (const area of [/^Steuern ·/, /^Familie ·/, /^Versicherung & Zusatzversorgung ·/])
      expect(screen.getByRole("button", { name: area })).toBeTruthy();
  });
  it("does not suggest changing salary data when a future tariff is unavailable", async () => {
    mockEntries = [forecastShift({ date: "2027-04-04" })];
    const screen = await overview("2027-04");
    expect(screen.queryByLabelText(/^Voraussichtliches Netto:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Gehaltsgrundlage ansehen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gehaltsangaben prüfen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
  });
  it("blocks personal data and results in test months", async () => {
    mockTestMonths = ["2026-07"];
    const screen = await overview();
    expect(screen.queryByLabelText(/^Voraussichtliches Netto:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Netto-Angaben/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Netto einmal einrichten" })).toBeNull();
    expect(screen.getByText("Für Testdaten gibt es keine Netto-Prognose.")).toBeTruthy();
    const deduction = await details("deductions");
    expect(deduction.getByText("Für Testdaten gibt es keine Netto-Prognose.")).toBeTruthy();
    expect(deduction.queryByLabelText(/^Netto rechnerisch:/)).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it.each(["salary", "components", "deductions", "premiums", "services", "basis"] as const)(
    "reserves %s for native back navigation without changing the selected month",
    async (section) => {
      const screen = section === "salary" ? await render(<SalaryScreen />) : await details(section);
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(screen.queryByTestId("report-period-pager")).toBeNull();
      expect(screen.queryByTestId("report-period-scroll")).toBeNull();
      expect(mockCoordinator.getMonth()).toBe("2026-07");
      expect(screen.getByText("Juli 2026")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.setParams).not.toHaveBeenCalled();
      expect(mockParams).toEqual(
        section === "salary" ? { month: "2026-07" } : { month: "2026-07", section },
      );
      expect(mockCoordinator.getMonth()).toBe("2026-07");
      expect(router.push).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    },
  );
  it("passes the selected month to detail navigation and the header export after switching", async () => {
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    const screen = await render(<SalaryScreen />);
    const before = screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel;
    await fireEvent.press(screen.getByRole("button", { name: /^Nächster Monat/ }));
    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2026-08" });
    mockParams = { month: "2026-08" };
    await screen.rerender(<SalaryScreen />);
    expect(screen.getByText("August 2026")).toBeTruthy();
    expect(mockSetMonth).toHaveBeenLastCalledWith("2026-08");
    expect(mockExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ period: "2026-08", variant: "icon" }),
    );
    expect(screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel).not.toBe(
      before,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Gesamtbrutto:/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-08", section: "components" },
    });
    await fireEvent.press(screen.getByRole("button", { name: /^Vorheriger Monat/ }));
    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2026-07" });
    mockParams = { month: "2026-07" };
    await screen.rerender(<SalaryScreen />);
    expect(screen.getByLabelText(/^Voraussichtliches Netto:/).props.accessibilityLabel).toBe(
      before,
    );
  });
  it("changes the read-only component month without pushing a new route", async () => {
    const screen = await details("components");
    const before = screen.getByLabelText(/^Gesamtbrutto:/).props.accessibilityLabel;
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    await fireEvent.press(screen.getByRole("button", { name: /^Nächster Monat/ }));
    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2026-08" });
    expect(router.push).not.toHaveBeenCalled();
    mockParams = { month: "2026-08", section: "components" };
    await screen.rerender(<SalaryDetailsScreen />);
    expect(mockCoordinator.getMonth()).toBe("2026-08");
    expect(screen.getByText("August 2026")).toBeTruthy();
    expect(screen.getByLabelText(/^Gesamtbrutto:/).props.accessibilityLabel).not.toBe(before);
    expect(screen.getByRole("header", { name: "Zusammensetzung" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Netto-Berechnung" })).toBeTruthy();
    expect(screen.getByLabelText(/^Abzüge:/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Abzüge:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: /^Vorheriger Monat/ }));
    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2026-07" });
    mockParams = { month: "2026-07", section: "components" };
    await screen.rerender(<SalaryDetailsScreen />);
    expect(screen.getByLabelText(/^Gesamtbrutto:/).props.accessibilityLabel).toBe(before);
    expect(mockCoordinator.getMonth()).toBe("2026-07");
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Gehalt" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it.each(["2026-07", "2027-01"])(
    "keeps older basis links, complete explanations and back for %s",
    async (month) => {
      mockEntries = [forecastShift({ date: `${month}-03` })];
      const screen = await details("basis", month);
      expect(screen.getByText("Berechnungsgrundlagen")).toBeTruthy();
      expect(screen.getByLabelText(/^Steuerbrutto:/)).toBeTruthy();
      expect(screen.getByLabelText(/^Brutto für Sozialversicherung:/)).toBeTruthy();
      expect(screen.getByText(/Samstagszuschläge, bezahlte Pausen/)).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Gehalt" }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.push).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    },
  );
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
  it("opens each incomplete December duty and recalculates after the missing facts are saved", async () => {
    mockParams = { month: "2026-12" };
    mockMonth = "2026-12";
    const onCall = forecastShift({
      id: "december-on-call",
      date: "2026-12-05",
      title: "Rufbereitschaft",
      type: "DAY",
      startTime: "08:00",
      endTime: "10:00",
      breakMinutes: 0,
      specialDuty: newSpecialDuty("ON_CALL", "08:00", "10:00", "Europe/Berlin"),
    });
    const standby = forecastShift({
      id: "december-standby",
      date: "2026-12-09",
      title: "Bereitschaftsdienst",
      type: "DAY",
      startTime: "07:00",
      endTime: "14:30",
      breakMinutes: 0,
      specialDuty: newSpecialDuty("STANDBY", "07:00", "14:30", "Europe/Berlin"),
    });
    mockEntries = [onCall, standby];
    const screen = await render(<SalaryScreen />);
    expect(screen.getByText("Gehaltsprognose noch offen")).toBeTruthy();
    expect(screen.getByText(/Rufbereitschaftspauschale: 6,01/)).toBeTruthy();
    expect(screen.getByText("Betrag noch offen")).toBeTruthy();
    expect(screen.queryByLabelText(/^Gesamtbrutto:/)).toBeNull();
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    for (const [entry, label] of [
      [onCall, "Dienst öffnen: 05.12. · Rufbereitschaft"],
      [standby, "Dienst öffnen: 09.12. · Bereitschaftsdienst"],
    ] as const) {
      await fireEvent.press(screen.getByRole("button", { name: label }));
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/shift-editor",
        params: { date: entry.date, mode: "SHIFT", entryId: entry.id },
      });
    }
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockParams.month).toBe("2026-12");
    mockEntries = [
      { ...onCall, specialDuty: { ...onCall.specialDuty!, calloutsComplete: true } },
      {
        ...standby,
        specialDuty: {
          ...standby.specialDuty!,
          version: 2,
          standbyLevel: "I",
          settlement: "PAY",
          standbyAgreement: { ...newStandbyAgreement("TVOED_K"), rule: "STANDARD" },
        },
      },
    ];
    await screen.rerender(<SalaryScreen />);
    expect(screen.queryByText("Gehaltsprognose noch offen")).toBeNull();
    expect(screen.queryByText("Betrag noch offen")).toBeNull();
    expect(screen.getByText(/Auszahlung Bereitschaftsdienst: 104,81/)).toBeTruthy();
    expect(screen.getByLabelText(/^Gesamtbrutto:/)).toBeTruthy();
  });
  it("preserves manual gross salary and its separate component access", async () => {
    mockSettings = null;
    mockProfile = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 450000 };
    const screen = await render(<SalaryScreen />);
    expect(screen.getByLabelText(/^Gesamtbrutto: 4.500,00/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zulage prüfen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zuschläge je Dienst" })).toBeNull();
    const detail = await details("components");
    expect(detail.getByLabelText(/^Monatsbrutto: 4.500,00/)).toBeTruthy();
  });
  it("includes confirmed cash-month gross before the first effective net profile in summary and components", async () => {
    mockSettings = null;
    mockEntries = [];
    mockProfile = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 450000 };
    mockAnnualPayments = [
      { revision: 1, payoutMonth: "2026-07", grossCents: 10000, netBasis: null },
    ];
    const screen = await render(<SalaryScreen />);
    expect(screen.getByLabelText(/^Gesamtbrutto: 4.600,00/)).toBeTruthy();
    await screen.unmount();
    const detail = await details("components");
    expect(detail.getByLabelText(/^Gesamtbrutto: 4.600,00/)).toBeTruthy();
    expect(detail.getByLabelText(/^Jahressonderzahlung: 100,00/)).toBeTruthy();
    expect(detail.queryByRole("button", { name: /^Jahressonderzahlung:/ })).toBeNull();
    expect(detail.queryByText("Voraussichtliches Netto")).toBeNull();
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
  it.each<[string, Pick<UserProfile, "tvalPflegeTariff" | "nursingTrainingTariff">, string]>([
    [
      "TVA-L",
      {
        tvalPflegeTariff: {
          trainingYear: 3 as const,
          universityRegion: "WEST" as const,
          employerScope: "SECTION_43" as const,
        },
      },
      "1.532,35 €",
    ],
    [
      "TVAöD",
      {
        nursingTrainingTariff: {
          trainingYear: 3 as const,
          sector: "BT_K" as const,
          tariffRegion: "OTHER" as const,
        },
      },
      "1.488,04 €",
    ],
  ])(
    "returns %s from the stale own amount to a live tariff estimate in one action",
    async (_, training, expected) => {
      mockParams = { month: "2026-11" };
      mockProfile = { ...forecastProfile, tariff: null, ...training };
      mockEntries = [];
      const initial = automatedSettings("2026-01");
      mockSettings = {
        ...initial,
        automation: {
          ...initial.automation!,
          annualPayments: [
            {
              revision: 1,
              payoutMonth: "2026-11",
              grossCents: 381816,
              netBasis: { kind: "CONSTANT_PAY" },
            },
          ],
        },
      };
      const screen = await render(
        <NetPayAutomaticEntryCard month="2026-11" proposedGrossCents={null} blocked={false} />,
      );
      expect(screen.getByText("3.818,16 €")).toBeTruthy();
      expect(screen.getByText("Eigener Betrag · November 2026")).toBeTruthy();
      await fireEvent.press(
        screen.getByRole("button", { name: /^Automatisch nach Tarif berechnen,/ }),
      );
      expect(mockResetAnnual).toHaveBeenCalledTimes(1);
      expect(screen.getByText(expected)).toBeTruthy();
      expect(screen.getByText("Automatisch nach Tarif · November 2026")).toBeTruthy();
      expect(screen.queryByText("3.818,16 €")).toBeNull();
      expect(screen.queryByLabelText("Jahressonderzahlung brutto (€)")).toBeNull();
      expect(mockSave).not.toHaveBeenCalled();
      await screen.unmount();
      const basis = await details("basis", "2026-11");
      expect(basis.getByText("Jahressonderzahlung")).toBeTruthy();
      expect(
        basis.queryByText(/Für die Berechnung gilt dein gespeicherter eigener Betrag/),
      ).toBeNull();
    },
  );
  it("explains the own amount instead of presenting the current training percentage as its basis", async () => {
    mockEntries = [];
    mockProfile = {
      ...forecastProfile,
      tariff: null,
      tvalPflegeTariff: { trainingYear: 3, universityRegion: "WEST", employerScope: "SECTION_43" },
    };
    const initial = automatedSettings("2026-01");
    mockSettings = {
      ...initial,
      automation: {
        ...initial.automation!,
        annualPayments: [
          {
            revision: 1,
            payoutMonth: "2026-11",
            grossCents: 381816,
            netBasis: { kind: "CONSTANT_PAY" },
          },
        ],
      },
    };
    const screen = await details("basis", "2026-11");
    expect(screen.getByText("Jahressonderzahlung")).toBeTruthy();
    expect(
      screen.getByText(/Für die Berechnung gilt dein gespeicherter eigener Betrag.*1.532,35/),
    ).toBeTruthy();
    expect(screen.queryByText(/^95 % aus/)).toBeNull();
  });
});
