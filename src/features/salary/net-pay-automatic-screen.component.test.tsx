import type { AllowanceStatus, MonthlyTariffDecision, UserProfile } from "@/domain/types";
import * as MockReact from "react";
import { Temporal } from "@js-temporal/polyfill";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { employmentDataFromProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import * as forecastEngine from "./automatic-net-pay-preparation";
import * as paymentEngine from "@/engine/net-pay-payment-forecast";
import * as payEngine from "@/engine/simple-pay";
import type { NavigationAction } from "expo-router/react-navigation";
import { NetPaySettingsScreen } from "./net-pay-settings-screen";
import { NetPayAutomaticEntryCard } from "./net-pay-automatic-entry-card";
import { NetPayScreen } from "./net-pay-screen";
import { SalaryScreen } from "./salary-screen";
import { SalaryDetailsScreen } from "./salary-details-screen";
import { netPayEuro } from "./net-pay-format";
import type { SalaryDetailSection } from "@/navigation/routes";
import * as Native from "react-native";
import * as PaletteModule from "@/theme/palette";
import { DARK_PALETTE } from "@/theme/palette-values";
import { AppErrorBoundary } from "@/ui/app-error-boundary";
import { AnalysisNetPayRow } from "@/features/analysis/analysis-net-pay-row";
import { PayListCard } from "@/features/analysis/dashboard-cards";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  setSalaryPaymentPeriod,
  type SalaryPaymentPreferences,
} from "@/domain/salary-payment";
let mockPaymentPreferences: SalaryPaymentPreferences = DEFAULT_SALARY_PAYMENT_PREFERENCES;
let mockPaymentError: string | null = null;
const mockPaymentSave = jest.fn<(preferences: SalaryPaymentPreferences) => Promise<void>>();
jest.mock("./salary-payment-preferences", () => ({
  useSalaryPaymentPreferences: () => ({
    preferences: mockPaymentPreferences,
    perspective: "PAYOUT" as const,
    ready: true,
    saving: false,
    error: mockPaymentError,
    save: mockPaymentSave,
    reload: jest.fn(),
  }),
}));
const mockExport = jest.fn<(props: { period: string; variant: string }) => void>();
jest.mock("@/features/report-export/report-export-button", () => ({
  ReportExportButton: (props: { period: string; variant: string }) => {
    mockExport(props);
    const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
    return <MockText testID="salary-export-current">{props.period}</MockText>;
  },
}));

const mockNativeGuard = {
  active: false,
  callback: (_event: { data: { action: NavigationAction } }) => {},
};
const mockNavigation = { dispatch: jest.fn() };
let mockSettingsEnabled = true;
const mockNativeToolbar = { placement: "", hidesSharedBackground: false };
jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 100,
  HeaderBackButton: () => null,
  usePreventRemove: (active: boolean, callback: typeof mockNativeGuard.callback) => {
    mockNativeGuard.active = active;
    mockNativeGuard.callback = callback;
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
let mockTariffDecisions: readonly MonthlyTariffDecision[] = [];
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
    canGoBack: () => true,
    replace: jest.fn(),
    push: jest.fn(),
    setParams: jest.fn<(mockNextParams: Partial<typeof mockParams>) => void>((mockNextParams) => {
      mockParams = { ...mockParams, ...mockNextParams };
    }),
  },
  Stack: {
    Screen: () => null,
    Toolbar: Object.assign(
      ({ children, placement }: MockReact.PropsWithChildren<{ placement: string }>) => {
        mockNativeToolbar.placement = placement;
        return children;
      },
      {
        View: ({
          children,
          hidesSharedBackground,
        }: MockReact.PropsWithChildren<{ hidesSharedBackground: boolean }>) => {
          mockNativeToolbar.hidesSharedBackground = hidesSharedBackground;
          const { View: MockView } =
            jest.requireActual<typeof import("react-native")>("react-native");
          return <MockView testID="net-pay-native-header-right">{children}</MockView>;
        },
      },
    ),
  },
  useNavigation: () => mockNavigation,
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
    tariffDecisions: mockTariffDecisions,
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
  useNetPayProfile: (_month: string, enabled: boolean) => {
    mockSettingsEnabled = enabled;
    const [value, setValue] = MockReact.useState(mockSettings);
    return {
      status: "ready",
      saved: value ? { settings: value, revision: 1 } : null,
      timeline: value ? [{ settings: value, revision: 1 }] : [],
      annualPayments: mockAnnualPayments ?? value?.automation?.annualPayments,
      error: null,
      busy: false,
      reload: async () => setValue(mockSettings),
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
        mockSettings = effectiveMonth ? { ...next, month: effectiveMonth } : next;
        setValue(mockSettings);
      },
    };
  },
}));

async function selectSettingOption(
  screen: Awaited<ReturnType<typeof render>>,
  label: string,
  option: string,
) {
  const name = label + ": " + option;
  if (!screen.queryByRole("radio", { name })) {
    const selector = screen
      .getAllByRole("button")
      .find((button) => button.props.accessibilityLabel?.startsWith(label + " auswählen"));
    if (!selector) throw new Error("Auswahlzeile fehlt: " + label);
    let nativeSelection = false;
    const native = jest
      .spyOn(Native.ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementationOnce((config, callback) => {
        nativeSelection = true;
        const index = config.options.indexOf(option);
        expect(index).toBeGreaterThanOrEqual(0);
        callback(index);
      });
    try {
      await fireEvent.press(selector);
    } finally {
      native.mockRestore();
    }
    if (nativeSelection) return;
  }
  await fireEvent.press(screen.getByRole("radio", { name }));
  // Inline controls stay open; modal selectors finish their dismissal animation.
  if (screen.queryByTestId("dropdown-modal-content")) {
    await waitFor(() => expect(screen.queryByRole("radio", { name })).toBeNull());
  }
}

async function chooseBirthDate(screen: Awaited<ReturnType<typeof render>>, value: string) {
  const input = screen.queryByLabelText("Geburtsdatum (TT.MM.JJJJ)");
  if (input) {
    await fireEvent.changeText(input, value);
    return;
  }
  await fireEvent.press(screen.getByRole("button", { name: /^Geburtsdatum auswählen:/ }));
  const [day, month, year] = value.split(".").map(Number);
  await fireEvent(screen.getByLabelText("Geburtsdatum im Kalender"), "change", {
    nativeEvent: { timestamp: new Date(year, month - 1, day, 12).getTime(), utcOffset: 0 },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Datum übernehmen" }));
}
describe("integrated salary-to-net workflow", () => {
  beforeEach(() => {
    mockPaymentPreferences = DEFAULT_SALARY_PAYMENT_PREFERENCES;
    mockPaymentError = null;
    mockPaymentSave.mockReset().mockResolvedValue(undefined);
    mockTariffDecisions = [];
    mockNativeGuard.active = false;
    mockNavigation.dispatch.mockClear();
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
  async function edit(month = "2026-07") {
    mockParams = { month };
    return render(<NetPaySettingsScreen />);
  }
  async function overview(month = "2026-07") {
    mockParams = { month };
    return render(<SalaryScreen />);
  }
  const statement = (screen: Awaited<ReturnType<typeof render>>) =>
    within(screen.getByTestId("salary-payroll-statement"));
  const totals = (screen: Awaited<ReturnType<typeof render>>) =>
    within(screen.getByTestId("salary-payroll-totals"));
  async function details(section: SalaryDetailSection, month = "2026-07") {
    mockParams = { month, section };
    return render(<SalaryDetailsScreen />);
  }

  it("shows the payroll statement without tabs or extra payment cards at zero lag", async () => {
    mockParams = { month: "2026-07" };
    const screen = await render(<SalaryScreen />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getAllByText("Zulagen aus Juli 2026")).toHaveLength(1);
    expect(screen.queryByText("Herkunft der Zeitzuschläge")).toBeNull();
    expect(screen.getByRole("header", { name: "Zusammensetzung" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zusammensetzung" })).toBeNull();
    expect(screen.queryByText("Monatliche Schichtzulagen")).toBeNull();
    expect(screen.queryByText("Zahlungsrhythmus")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Zulage prüfen/ })).toHaveLength(1);
  });
  it.each([1, 2] as const)(
    "shows only one muted origin hint at lag %s and keeps the old allowance route",
    async (lag) => {
      mockPaymentPreferences = setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
        effectiveMonth: "2025-01",
        delays: {
          PREMIUMS: lag,
          MONTHLY_ALLOWANCE: lag,
          HOURLY_ALLOWANCE: lag,
          OVERTIME: lag,
          SPECIAL_DUTY: lag,
        },
      });
      const sourceMonth = lag === 1 ? "2026-09" : "2026-08";
      const sourceTitle = lag === 1 ? "September 2026" : "August 2026";
      mockEntries = [
        forecastShift({ id: `shifted-source-${lag}`, date: `${sourceMonth}-06` }),
        forecastShift({ id: `current-source-${lag}`, date: "2026-10-04" }),
      ];
      mockTariffDecisions = [sourceMonth, "2026-10"].map((month) => ({
        month,
        allowanceStatus: "NONE",
        revision: 1,
        confirmedAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }));
      mockParams = { month: "2026-10" };
      const screen = await render(<SalaryScreen />);
      expect(screen.getAllByText(`Zulagen aus ${sourceTitle}`)).toHaveLength(1);
      expect(screen.queryByRole("tab")).toBeNull();
      expect(screen.queryByText("Herkunft der Zeitzuschläge")).toBeNull();
      expect(screen.getByRole("header", { name: "Zusammensetzung" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Zusammensetzung" })).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: /^Zulage prüfen/ }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/tariff-assessment",
        params: { month: sourceMonth },
      });
      await screen.unmount();
      mockSettings = null;
      const services = await details("services", "2026-10");
      expect(services.getByTestId("net-pay-service-details")).toBeTruthy();
      expect(services.queryByRole("tab")).toBeNull();
      expect(services.queryByText(/^Zulagen aus /)).toBeNull();
      const sourceDate = lag === 1 ? /06\.09/ : /06\.08/;
      expect(services.getByRole("button", { name: sourceDate })).toBeTruthy();
      expect(services.queryByRole("button", { name: /04\.10/ })).toBeNull();
    },
  );

  it("opens standalone settings, persists the chosen effective month and reloads salary on return", async () => {
    const salary = await overview();
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    await fireEvent.press(salary.getByRole("button", { name: /^Netto-Einstellungen/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/net-pay-settings",
      params: { month: "2026-07" },
    });
    await salary.unmount();
    const screen = await edit();
    await fireEvent.press(screen.getByRole("button", { name: "Gültig ab auswählen: Juli 2026" }));
    await selectSettingOption(screen, "Gültig ab", "Januar 2026");
    await selectSettingOption(screen, "Steuerklasse", "4");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        month: "2026-07",
        profile: expect.objectContaining({ taxClass: 4 }),
      }),
      "2026-01",
    );
    expect(router.back).toHaveBeenCalledTimes(1);
    await screen.unmount();
    const returned = await overview();
    expect(
      returned.getByRole("button", { name: /^Netto-Einstellungen\. Steuerklasse 4/ }),
    ).toBeTruthy();
    expect(router.push).toHaveBeenCalledTimes(1);
  });
  it("places the settings entry and timing selector before the summary and statement", async () => {
    const screen = await overview();
    const output = JSON.stringify(screen.toJSON());
    expect(output.indexOf("net-pay-settings-entry")).toBeGreaterThan(-1);
    expect(output.indexOf("Zulagen werden ausgezahlt auswählen")).toBeGreaterThan(
      output.indexOf("net-pay-settings-entry"),
    );
    expect(output.indexOf("salary-payroll-totals")).toBeGreaterThan(
      output.indexOf("Zulagen werden ausgezahlt auswählen"),
    );
    expect(output.indexOf("salary-payroll-statement")).toBeGreaterThan(
      output.indexOf("salary-payroll-totals"),
    );
    expect(screen.getAllByRole("button", { name: /^Netto-Einstellungen/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Netto-Angaben speichern" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Steuerklasse: 1" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Steuerklasse auswählen/ })).toBeNull();
    expect(
      screen.getAllByRole("button", { name: /^Zulagen werden ausgezahlt auswählen/ }),
    ).toHaveLength(1);
  });
  it("retains the last valid payroll after a payment write conflict and guards the separate tax draft", async () => {
    mockEntries = [forecastShift({ id: "payment-write-conflict-draft" })];
    const beforePreferences = mockPaymentPreferences;
    const screen = await overview();
    const beforeNet = totals(screen).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel;
    mockPaymentSave.mockImplementationOnce(async () => {
      mockPaymentError = "Der Auszahlungsmonat wurde zwischenzeitlich geändert. Erneut laden.";
      throw new Error(mockPaymentError);
    });
    await fireEvent.press(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    );
    await selectSettingOption(screen, "Zulagen werden ausgezahlt", "Im Folgemonat");
    expect(mockPaymentSave).toHaveBeenCalledTimes(1);
    // A provider error update must not turn the ready salary page into an error screen.
    await screen.rerender(<SalaryScreen />);
    expect(
      screen.getByText(
        "Der Auszahlungsmonat wurde nicht gespeichert. Bitte erneut laden und versuchen.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    ).toBeTruthy();
    expect(mockPaymentPreferences).toBe(beforePreferences);
    expect(totals(screen).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel).toBe(
      beforeNet,
    );
    expect(mockSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
    await screen.unmount();
    const settingsScreen = await edit();
    await selectSettingOption(settingsScreen, "Steuerklasse", "3");
    expect(mockNativeGuard.active).toBe(true);
    const alert = jest.spyOn(Native.Alert, "alert");
    try {
      await act(() => mockNativeGuard.callback({ data: { action: { type: "GO_BACK" } } }));
      const cancel = alert.mock.calls[0]![2]!.find(
        (button) => button.text === "Weiter bearbeiten",
      )!;
      await act(() => cancel.onPress?.());
      expect(
        settingsScreen.getByRole("button", { name: "Steuerklasse auswählen: 3" }),
      ).toBeTruthy();
      expect(mockNavigation.dispatch).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockSettings?.profile.taxClass).toBe(1);
    } finally {
      alert.mockRestore();
    }
  });
  it("keeps a standalone tax draft on cancelled back and changes the salary month only after discard", async () => {
    const salary = await overview();
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    await fireEvent.press(salary.getByRole("button", { name: /^Netto-Einstellungen/ }));
    await salary.unmount();
    const screen = await edit();
    const alert = jest.spyOn(Native.Alert, "alert");
    try {
      await selectSettingOption(screen, "Steuerklasse", "3");
      expect(mockNativeGuard.active).toBe(true);
      const action = { type: "GO_BACK" };
      await act(() => mockNativeGuard.callback({ data: { action } }));
      expect(alert).toHaveBeenCalledWith(
        "Änderungen verwerfen?",
        "Deine Änderungen sind noch nicht gespeichert.",
        expect.any(Array),
      );
      const cancel = alert.mock.calls[0]![2]!.find(
        (button) => button.text === "Weiter bearbeiten",
      )!;
      expect(cancel.style).toBe("cancel");
      await act(() => cancel.onPress?.());
      expect(router.setParams).not.toHaveBeenCalled();
      expect(mockParams.month).toBe("2026-07");
      expect(screen.getByRole("button", { name: "Steuerklasse auswählen: 3" })).toBeTruthy();
      expect(mockNavigation.dispatch).not.toHaveBeenCalled();
      await act(() => mockNativeGuard.callback({ data: { action } }));
      const discard = alert.mock.calls[1]![2]!.find(
        (button) => button.text === "Änderungen verwerfen",
      )!;
      await act(() => discard.onPress!());
      expect(mockNavigation.dispatch).toHaveBeenLastCalledWith(action);
      expect(mockSettings?.profile.taxClass).toBe(1);
      await screen.unmount();
      const returned = await overview();
      await fireEvent.press(returned.getByRole("button", { name: /^Nächster Monat/ }));
      expect(router.setParams).toHaveBeenLastCalledWith({ month: "2026-08" });
      await returned.rerender(<SalaryScreen />);
      expect(mockParams.month).toBe("2026-08");
      expect(returned.getByText("August 2026")).toBeTruthy();
      expect(
        returned.getByRole("button", { name: /^Netto-Einstellungen\. Steuerklasse 1/ }),
      ).toBeTruthy();
      expect(mockSave).not.toHaveBeenCalled();
      expect(router.push).toHaveBeenCalledTimes(1);
    } finally {
      alert.mockRestore();
    }
  });
  it("reloads the real payroll after returning from settings while preserving pension and personal deductions", async () => {
    const initial = automatedSettings("2026-06");
    mockSettings = {
      ...initial,
      automation: {
        ...initial.automation!,
        pensionScheme: "VBL_WEST",
        additionalNetDeductionCents: 1500,
      },
    };
    mockEntries = [forecastShift({ id: "settings-return-recalculate" })];
    const calculate = jest.spyOn(forecastEngine, "prepareAutomaticNetPay");
    try {
      const salary = await overview();
      const before = totals(salary).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel;
      await fireEvent.press(salary.getByRole("button", { name: /^Netto-Einstellungen/ }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/net-pay-settings",
        params: { month: "2026-07" },
      });
      await salary.unmount();
      const settingsScreen = await edit();
      await selectSettingOption(settingsScreen, "Steuerklasse", "3");
      expect(mockSettings?.profile.taxClass).toBe(1);
      await fireEvent.press(
        settingsScreen.getByRole("button", { name: "Speichern und schließen" }),
      );
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({ taxClass: 3 }),
          automation: expect.objectContaining({
            pensionScheme: "VBL_WEST",
            additionalNetDeductionCents: 1500,
          }),
        }),
      );
      expect(router.back).toHaveBeenCalledTimes(1);
      await settingsScreen.unmount();
      const screen = await overview();
      await waitFor(() => {
        expect(
          totals(screen).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel,
        ).not.toBe(before);
      });
      const computed = calculate.mock.results.at(-1)!.value as ReturnType<
        typeof forecastEngine.prepareAutomaticNetPay
      >;
      if (computed.result.status !== "available") throw new Error("Saved fixture unavailable");
      const pay = computed.result.pay;
      expect(
        statement(screen).getByLabelText(`Netto geschätzt: ${netPayEuro(pay.netCents)}`),
      ).toBeTruthy();
      expect(
        statement(screen).getByLabelText(
          `Abzüge: ${netPayEuro(pay.netCents - pay.amounts.grossCents)}`,
        ),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/salary-details",
        params: { month: "2026-07", section: "deductions" },
      });
      await screen.unmount();
      const deduction = await details("deductions");
      expect(
        deduction.getByLabelText(`Zusatzversorgung: ${netPayEuro(pay.pension!.employeeCents)}`),
      ).toBeTruthy();
      expect(deduction.getByLabelText("Weitere Netto-Abzüge: 15,00\u00a0€")).toBeTruthy();
      expect(
        deduction.getByLabelText(
          `Abzüge insgesamt: ${netPayEuro(pay.amounts.grossCents - pay.netCents)}, Juli 2026`,
        ),
      ).toBeTruthy();
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledTimes(2);
    } finally {
      calculate.mockRestore();
    }
  });
  it("keeps partial annual net honest while retaining calculated regular pension deductions", async () => {
    const initial = automatedSettings("2026-01");
    mockSettings = {
      ...initial,
      automation: {
        ...initial.automation!,
        pensionScheme: "VBL_WEST",
        additionalNetDeductionCents: 1500,
        annualPayments: [
          { revision: 1, payoutMonth: "2026-10", grossCents: 100_000, netBasis: null },
        ],
      },
    };
    mockEntries = [];
    const calculate = jest.spyOn(forecastEngine, "prepareAutomaticNetPay");
    try {
      const screen = await overview("2026-10");
      const computed = calculate.mock.results.at(-1)!.value as ReturnType<
        typeof forecastEngine.prepareAutomaticNetPay
      >;
      if (computed.result.status !== "available") throw new Error("Annual fixture unavailable");
      const pay = computed.result.pay;
      expect(computed.annualPayment?.netIncluded).toBe(false);
      expect(pay.pension!.employeeCents).toBeGreaterThan(0);
      expect(
        statement(screen).getByLabelText(
          `Gesamtbrutto: ${netPayEuro(pay.amounts.grossCents + 100_000)}`,
        ),
      ).toBeTruthy();
      expect(
        statement(screen).getByLabelText(
          `Brutto für Netto-Prognose: ${netPayEuro(pay.amounts.grossCents)}`,
        ),
      ).toBeTruthy();
      expect(
        statement(screen).getByLabelText(
          `Netto ohne Jahressonderzahlung: ${netPayEuro(pay.netCents)}`,
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          "Jahressonderzahlung im Brutto enthalten; die Netto-Berechnung dafür ist noch offen.",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText("Zusatzversorgung auf die Jahressonderzahlung nicht berücksichtigt."),
      ).toBeTruthy();
      expect(
        statement(screen).getByLabelText(
          `Abzüge: ${netPayEuro(pay.netCents - pay.amounts.grossCents)}`,
        ),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/salary-details",
        params: { month: "2026-10", section: "deductions" },
      });
      await screen.unmount();
      const deduction = await details("deductions", "2026-10");
      expect(
        deduction.getByLabelText(`Zusatzversorgung: ${netPayEuro(pay.pension!.employeeCents)}`),
      ).toBeTruthy();
      expect(
        deduction.getByLabelText(
          `Abzüge insgesamt: ${netPayEuro(pay.amounts.grossCents - pay.netCents)}, Oktober 2026`,
        ),
      ).toBeTruthy();
      expect(deduction.getByLabelText("Weitere Netto-Abzüge: 15,00\u00a0€")).toBeTruthy();
      expect(mockSave).not.toHaveBeenCalled();
    } finally {
      calculate.mockRestore();
    }
  });
  it("shows positive solidarity and church deductions from a real high-income forecast", async () => {
    const initial = automatedSettings("2026-01");
    mockSettings = { ...initial, profile: { ...initial.profile, churchTaxRatePercent: 9 } };
    mockProfile = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 1_200_000 };
    mockEntries = [];
    const calculate = jest.spyOn(forecastEngine, "prepareAutomaticNetPay");
    try {
      const screen = await overview();
      const computed = calculate.mock.results.at(-1)!.value as ReturnType<
        typeof forecastEngine.prepareAutomaticNetPay
      >;
      if (computed.result.status !== "available")
        throw new Error("High-income fixture unavailable");
      const pay = computed.result.pay;
      expect(pay.tax.solidarityCents).toBeGreaterThan(0);
      expect(pay.tax.churchTaxCents).toBeGreaterThan(0);
      await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/salary-details",
        params: { month: "2026-07", section: "deductions" },
      });
      await screen.unmount();
      const deduction = await details("deductions");
      expect(
        deduction.getByLabelText(`Solidaritätszuschlag: ${netPayEuro(pay.tax.solidarityCents)}`),
      ).toBeTruthy();
      expect(
        deduction.getByLabelText(`Kirchensteuer: ${netPayEuro(pay.tax.churchTaxCents)}`),
      ).toBeTruthy();
      expect(pay.amounts.grossCents - pay.netCents).toBe(
        pay.tax.totalCents + pay.socialInsurance.totalCents + (pay.pension?.employeeCents ?? 0),
      );
      expect(mockSave).not.toHaveBeenCalled();
    } finally {
      calculate.mockRestore();
    }
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
    expect(screen.getByRole("header", { name: "Zusammensetzung" })).toBeTruthy();
    await screen.unmount();
    const basis = await details("basis", "2026-10");
    expect(basis.queryByText(/Jahressonderzahlung/)).toBeNull();
    expect(basis.queryByText(/vollem Jahresanspruch/)).toBeNull();
    await basis.unmount();
    const november = await overview("2026-11");
    expect(statement(november).getByLabelText(/^Jahressonderzahlung: 3.818,16/)).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("includes tariff Christmas pay and net automatically without opening or saving a form", async () => {
    mockEntries = [];
    const screen = await overview("2026-11");
    expect(statement(screen).getByLabelText(/^Jahressonderzahlung:/)).toBeTruthy();
    expect(totals(screen).getByLabelText(/^Netto geschätzt: [\d.,]+\s€/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Jahressonderzahlung bearbeiten" }));
    expect(screen.getByText("Automatisch nach Tarif · November 2026")).toBeTruthy();
    expect(screen.queryByLabelText("Jahressonderzahlung brutto (€)")).toBeNull();
    expect(screen.queryByText(/Jahresprognose mit gleichbleibendem/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Anpassen,/ })).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("keeps components, gross and net in order in one salary card", async () => {
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
    const card = within(screen.getByTestId("analysis-card-body-Gehalt"));
    const labels = card.getAllByText(
      /^(Grundgehalt|Zeitzuschläge|Weitere Zulagen|Jahressonderzahlung|Brutto geschätzt|Voraussichtliches Netto)$/u,
    );
    expect(labels.map((node) => node.props.children)).toEqual([
      "Grundgehalt",
      "Zeitzuschläge",
      "Weitere Zulagen",
      "Jahressonderzahlung",
      "Brutto geschätzt",
      "Voraussichtliches Netto",
    ]);
    expect(screen.getAllByTestId("analysis-card-body-Gehalt")).toHaveLength(1);
    expect(screen.queryByText(/Jahresprognose mit gleichbleibendem/)).toBeNull();
  });
  it("opens the affected service rather than tariff settings for missing service times", async () => {
    mockEntries = [
      forecastShift({ id: "missing-times", date: "2026-07-03", startTime: null, endTime: null }),
    ];
    const screen = await overview();
    await fireEvent.press(screen.getByRole("button", { name: "Dienstzeiten prüfen" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/shift-editor",
      params: { date: "2026-07-03", mode: "SHIFT", entryId: "missing-times" },
    });
  });
  it("does not suggest tariff settings for an unexplained technical forecast failure", async () => {
    const spy = jest.spyOn(forecastEngine, "prepareAutomaticNetPay").mockReturnValue({
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
      expect(spy).toHaveBeenCalled();
      expect(screen.getByText("Die Berechnung ist nicht verfügbar.")).toBeTruthy();
      expect(screen.queryByLabelText(/^Voraussichtliches Netto:/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Gehaltsgrundlage ansehen" })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
  it("opens missing source-month settings and saves that month's historical Saxony status", async () => {
    const oldProfile = { ...forecastProfile, federalState: "SN" as const };
    const currentProfile = { ...forecastProfile, federalState: "BY" as const };
    mockProfile = {
      ...currentProfile,
      employmentTimeline: [
        {
          effectiveFrom: null,
          data: remunerationDataFromLegacy(oldProfile),
          employment: employmentDataFromProfile(oldProfile),
          revision: 1,
          createdAt: forecastProfile.createdAt,
          updatedAt: forecastProfile.updatedAt,
        },
        {
          effectiveFrom: "2026-06-01",
          data: remunerationDataFromLegacy(currentProfile),
          employment: employmentDataFromProfile(currentProfile),
          revision: 1,
          createdAt: forecastProfile.createdAt,
          updatedAt: forecastProfile.updatedAt,
        },
      ],
    };
    const spy = jest.spyOn(forecastEngine, "prepareAutomaticNetPay").mockReturnValue({
      sourceMonth: "2026-06",
      recovery: { kind: "net-settings", month: "2026-05" },
      result: {
        status: "unavailable",
        stage: "net-pay",
        reason: "Die Netto-Angaben für den Zulagenmonat fehlen.",
      },
    });
    try {
      mockEntries = [forecastShift({ id: "recover-source-net-settings" })];
      const screen = await overview();
      expect(spy).toHaveBeenCalled();
      expect(screen.getByText("Die Netto-Angaben für den Zulagenmonat fehlen.")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Netto-Angaben ergänzen" }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/net-pay-settings",
        params: { month: "2026-05" },
      });
      expect(screen.queryByRole("radio", { name: "Steuerklasse: 1" })).toBeNull();
      expect(mockSave).not.toHaveBeenCalled();
      await screen.unmount();
      const settingsScreen = await edit("2026-05");
      await selectSettingOption(settingsScreen, "Zahlst du Kirchensteuer?", "Ja");
      await fireEvent.press(
        settingsScreen.getByRole("button", { name: "Speichern und schließen" }),
      );
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          month: "2026-05",
          profile: expect.objectContaining({ worksInSaxony: true, churchTaxRatePercent: 9 }),
        }),
      );
      expect(router.back).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
  it("shows source-adjustment metadata only in the existing calculation basis", async () => {
    const original = forecastEngine.prepareAutomaticNetPay;
    const spy = jest
      .spyOn(forecastEngine, "prepareAutomaticNetPay")
      .mockImplementation((...args) => ({
        ...original(...args),
        payrollTimingEstimate: { method: "SOURCE_ADJUSTMENT", sourceMonth: "2026-06", lag: 1 },
      }));
    try {
      mockEntries = [forecastShift({ id: "source-adjustment-basis-note" })];
      const screen = await overview();
      expect(spy).toHaveBeenCalled();
      expect(screen.queryByText(/Netto-Schätzung auf Basis des Zulagenmonats/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/salary-details",
        params: { month: "2026-07", section: "deductions" },
      });
      await screen.unmount();
      const deduction = await details("deductions");
      expect(
        deduction.getByText("Netto-Schätzung auf Basis des Zulagenmonats Juni 2026."),
      ).toBeTruthy();
      await deduction.unmount();
      const basis = await details("basis");
      expect(
        basis.getByText(
          "Zulagen aus Juni 2026 nachberechnet. Abzüge mit der Auszahlung angenommen; frühere Einbehalte sind nicht bekannt.",
        ),
      ).toBeTruthy();
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
  it("shows finalized payroll values and keeps their calculation basis on the deduction page", async () => {
    mockEntries = [forecastShift({ id: "new-overview-values" })];
    const calculate = jest.spyOn(forecastEngine, "prepareAutomaticNetPay");
    const screen = await overview();
    const computed = calculate.mock.results.at(-1)!.value as ReturnType<
      typeof forecastEngine.prepareAutomaticNetPay
    >;
    const result = computed.result;
    expect(calculate).toHaveBeenCalledWith(
      "2026-07",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ perspective: "PAYOUT" }),
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Fixture unavailable");
    const euro = (cents: number) =>
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
    expect(
      statement(screen).getByLabelText("Netto geschätzt: " + euro(result.pay.netCents)),
    ).toBeTruthy();
    expect(
      statement(screen).getByLabelText("Gesamtbrutto: " + euro(result.pay.amounts.grossCents)),
    ).toBeTruthy();
    expect(
      statement(screen).getByLabelText(
        "Zeitzuschläge: " + euro(result.classification.paidPremiumCents),
      ),
    ).toBeTruthy();
    expect(screen.getByRole("header", { name: "Zusammensetzung" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gehaltsbestandteile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zuschläge je Dienst" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Gesamtbrutto:/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Abzüge:/ })).toHaveLength(1);
    expect(
      statement(screen).getByRole("button", { name: /^Abzüge:/ }).props.accessibilityState.expanded,
    ).toBeUndefined();
    expect(
      statement(screen).getByLabelText(
        "Abzüge: " + euro(result.pay.netCents - result.pay.amounts.grossCents),
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^Lohnsteuer:/)).toBeNull();
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    expect(screen.queryByTestId("net-pay-gross-composition")).toBeNull();
    expect(screen.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    await screen.unmount();
    const deduction = await details("deductions");
    expect(
      deduction.getByLabelText("Steuerbrutto: " + euro(result.pay.amounts.taxableGrossCents)),
    ).toBeTruthy();
    expect(result.pay.amounts.taxableGrossCents).toBe(
      result.pay.amounts.grossCents - result.classification.taxFreeCents,
    );
    calculate.mockRestore();
  });
  it("keeps the legacy automatic route available with its computed overview", async () => {
    const screen = await render(<NetPayScreen />);
    expect(screen.getByText("Gehaltsprognose")).toBeTruthy();
    expect(screen.getByLabelText(/^Voraussichtliches Netto:/)).toBeTruthy();
  });
  it("shows the same calculated net in the monthly analysis salary table", async () => {
    mockEntries = [forecastShift({ id: "analysis-net-value" })];
    const calculate = jest.spyOn(forecastEngine, "prepareAutomaticNetPay");
    const compute = jest.spyOn(paymentEngine, "calculateAutomaticPaymentNetPayForecastSteps");
    try {
      const salary = await overview();
      const computed = calculate.mock.results.at(-1)!.value as ReturnType<
        typeof forecastEngine.prepareAutomaticNetPay
      >;
      if (computed.result.status !== "available") throw new Error("Fixture unavailable");
      const initialComputations = compute.mock.calls.length;
      expect(initialComputations).toBeGreaterThan(0);
      const openSalary = jest.fn();
      const table = await render(
        <PayListCard
          onPress={openSalary}
          gross={computed.result.pay.amounts.grossCents / 100}
          caption="Unverbindliche Brutto-Schätzung"
          netRow={<AnalysisNetPayRow month="2026-07" />}
        />,
      );
      const expectedEuro = new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(computed.result.pay.netCents / 100);
      expect(statement(salary).getByLabelText(`Netto geschätzt: ${expectedEuro}`)).toBeTruthy();
      expect(table.getByLabelText(`Voraussichtliches Netto: ${expectedEuro}`)).toBeTruthy();
      expect(within(table.getByTestId("analysis-net-pay-row")).queryByRole("button")).toBeNull();
      await fireEvent.press(table.getByRole("button", { name: /^Gehalt,/ }));
      expect(openSalary).toHaveBeenCalledTimes(1);
      expect(table.getByLabelText(/^Brutto geschätzt:/)).toBeTruthy();
      expect(calculate.mock.results.at(-1)?.value).toBe(computed);
      expect(compute.mock.calls).toHaveLength(initialComputations);
      expect(mockSave).not.toHaveBeenCalled();
    } finally {
      calculate.mockRestore();
      compute.mockRestore();
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
  it("opens separate deductions and reuses the computed result on return and deep links", async () => {
    mockEntries = [forecastShift({ id: "direct-details-cache" })];
    const calculate = jest.spyOn(forecastEngine, "prepareAutomaticNetPay");
    const screen = await overview();
    const computed = calculate.mock.results.at(-1)?.value as
      ReturnType<typeof forecastEngine.prepareAutomaticNetPay> | undefined;
    expect(computed?.result.status).toBe("available");
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "deductions" },
    });
    expect(statement(screen).queryByLabelText(/^Krankenversicherung:/)).toBeNull();
    expect(statement(screen).queryByLabelText(/^Solidaritätszuschlag:/)).toBeNull();
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    const computations = calculate.mock.results.length;
    expect(calculate.mock.results).toHaveLength(computations);
    await screen.unmount();
    const detail = await details("deductions");
    expect(detail.getByLabelText(/^Krankenversicherung:/)).toBeTruthy();
    expect(detail.getByLabelText(/^Steuerbrutto:/)).toBeTruthy();
    expect(detail.queryByLabelText(/^Solidaritätszuschlag:/)).toBeNull();
    expect(detail.getByText("Krankenversicherung einschließlich Zusatzbeitrag.")).toBeTruthy();
    expect(calculate.mock.results.at(-1)?.value).toBe(computed);
    await fireEvent.press(detail.getByRole("button", { name: "Zurück" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    await detail.unmount();
    const returned = await overview();
    expect(returned.getByLabelText(/^Abzüge:/)).toBeTruthy();
    expect(statement(returned).queryByLabelText(/^Krankenversicherung:/)).toBeNull();
    expect(calculate.mock.results.at(-1)?.value).toBe(computed);
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
      "Steuerbrutto",
      "Brutto für Sozialversicherung",
    ])
      expect(screen.getByLabelText(new RegExp("^" + label + ":"))).toBeTruthy();
    expect(screen.queryByLabelText(/^Solidaritätszuschlag:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "So rechnen wir" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/info-details",
      params: { section: "CALCULATION" },
    });
  });
  it("shows salary components directly and opens calculation basis through deductions", async () => {
    const screen = await overview();
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(statement(screen).getByLabelText(/^Grundentgelt:/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Gesamtbrutto:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gehaltsbestandteile" })).toBeNull();
    expect(screen.queryByTestId("net-pay-gross-composition")).toBeNull();
    expect(screen.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
    expect(screen.queryByLabelText(/^Steuerbrutto:/)).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-07", section: "deductions" },
    });
    await screen.unmount();
    const deduction = await details("deductions");
    expect(deduction.getByRole("header", { name: "Berechnungsgrundlagen" })).toBeTruthy();
    expect(deduction.getByLabelText(/^Steuerbrutto:/)).toBeTruthy();
    await deduction.unmount();
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
    expect(statement(screen).getByLabelText(/^Zeitzuschläge: [\d.,]+\s€/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aufteilung ansehen" })).toBeNull();
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).not.toHaveBeenCalled();
    await screen.unmount();
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
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(statement(screen).getByLabelText(/^Zeitzuschläge: [\d.,]+\s€/)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
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
    const filteredSummary = screen.getByLabelText(/^Zeitzuschläge:/).props.accessibilityLabel;
    expect(filteredSummary).not.toBe(summary);
    await fireEvent.press(night);
    expect(screen.getByText(/endet am 04\.07\./)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
    expect(list.getByRole("radio", { name: "Nacht" }).props.accessibilityState.checked).toBe(true);
    expect(list.getByRole("button", { name: filteredAmount })).toBeTruthy();
    expect(screen.getByText("Juli 2026")).toBeTruthy();
    expect(screen.getByLabelText(/^Zeitzuschläge:/).props.accessibilityLabel).toBe(filteredSummary);
    await fireEvent.press(list.getByRole("radio", { name: "Alle" }));
    expect(list.getByRole("button", { name: /^So\. 05\.07\.:/ })).toBeTruthy();
    expect(screen.getByLabelText(/^Zeitzuschläge:/).props.accessibilityLabel).toBe(summary);
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
      expect(screen.getAllByRole("button", { name: /^Zulage prüfen/ })).toHaveLength(1);
      await fireEvent.press(screen.getByRole("button", { name: /^Zulage prüfen/ }));
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: "/tariff-assessment",
        params: { month: "2026-08" },
      });
      expect(mockSave).not.toHaveBeenCalled();
    },
  );
  it.each([1, 2] as const)(
    "shows delayed readiness net with different automatic monthly claims without a manual reconciliation (lag %i)",
    async (lag) => {
      const month = Temporal.PlainYearMonth.from("2026-07").add({ months: lag }).toString();
      mockParams = { month };
      mockProfile = {
        ...forecastProfile,
        workPattern: {
          workplaceCoverage: "AROUND_THE_CLOCK",
          assignment: "PERMANENT",
        },
      };
      const regular = (serviceMonth: string, types: readonly ("EARLY" | "LATE" | "NIGHT")[]) =>
        types.map((type, index) =>
          forecastShift({
            id: `${serviceMonth}-${index}`,
            date: `${serviceMonth}-${String(index * 2 + 1).padStart(2, "0")}`,
            type,
            startTime: type === "EARLY" ? "06:00" : type === "LATE" ? "13:00" : "21:00",
            endTime: type === "EARLY" ? "14:00" : type === "LATE" ? "21:00" : "07:00",
            breakMinutes: 30,
          }),
        );
      mockEntries = [
        ...regular("2026-07", ["EARLY", "LATE", "EARLY", "LATE", "NIGHT"]),
        ...regular(month, ["EARLY", "LATE", "NIGHT", "NIGHT", "NIGHT", "EARLY"]),
        forecastShift({
          id: "readiness-july",
          date: "2026-07-17",
          startTime: "06:00",
          endTime: "14:00",
          breakMinutes: 30,
          specialDuty: {
            ...newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin"),
            version: 2,
            standbyLevel: "II",
            settlement: "PAY",
            standbyAgreement: {
              ...newStandbyAgreement("TVOED_K"),
              rule: "STANDARD",
              sequence: 1,
              payGroup: "KR_VI",
            },
          },
        }),
      ];
      mockPaymentPreferences = setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
        effectiveMonth: "2026-01",
        delays: {
          PREMIUMS: lag,
          MONTHLY_ALLOWANCE: lag,
          HOURLY_ALLOWANCE: lag,
          OVERTIME: lag,
          SPECIAL_DUTY: lag,
        },
      });
      expect(mockTariffDecisions).toEqual([]);
      const july = payEngine.calculateMonthlyPayEstimate(
        "2026-07",
        mockEntries.filter((entry) => entry.date.startsWith("2026-07")),
        mockProfile,
        null,
      );
      expect(july.confirmedAllowance).toBeNull();
      expect(july.assessment.suggestedAllowance).toBe("SHIFT_MONTHLY");
      expect(july.allowanceAmount).toBe(100);
      const alert = jest.spyOn(Native.Alert, "alert").mockImplementation(() => {});
      const legacy = await render(
        <NetPayAutomaticEntryCard month={month} proposedGrossCents={null} blocked={false} />,
      );
      expect(legacy.queryByRole("button", { name: "Monatszulagen prüfen" })).toBeNull();
      expect(legacy.queryByRole("button", { name: "Netto-Angaben prüfen" })).toBeNull();
      expect(legacy.getByText("Netto-Prognose")).toBeTruthy();
      await legacy.unmount();
      const screen = await render(<SalaryScreen />);
      expect(screen.queryByRole("button", { name: "Monatszulagen prüfen" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Netto-Angaben ergänzen" })).toBeNull();
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      expect(router.push).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockPaymentSave).not.toHaveBeenCalled();
      expect(screen.queryByText("Noch offen")).toBeNull();
      expect(screen.getByTestId("salary-payroll-totals")).toBeTruthy();
      expect(statement(screen).getByLabelText(/^Netto geschätzt: [\d.]+,/)).toBeTruthy();
      expect(
        statement(screen).getByLabelText(/^Ständige Schichtzulage: 100,00.*Geschätzt/),
      ).toBeTruthy();
      expect(statement(screen).getByLabelText(/^Bereitschaftsvergütung: [\d.]+,/)).toBeTruthy();
      expect(mockTariffDecisions).toEqual([]);
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

  it("opens first setup as a full page and saves the whole profile once", async () => {
    mockSettings = null;
    const entry = await render(
      <NetPayAutomaticEntryCard month="2026-07" proposedGrossCents={500000} blocked={false} />,
    );
    expect(entry.getByLabelText(/^Gesamtbrutto:/)).toBeTruthy();
    await fireEvent.press(entry.getByRole("button", { name: "Netto einmal einrichten" }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/net-pay-settings",
      params: { month: "2026-07" },
    });
    await entry.unmount();
    const screen = await edit();
    for (const title of ["Steuern", "Familie", "Versicherung & Vorsorge", "Weitere Angaben"])
      expect(screen.getByRole("header", { name: title })).toBeTruthy();
    expect(screen.queryByTestId("dropdown-modal-content")).toBeNull();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
    await selectSettingOption(screen, "Steuerklasse", "1");
    await selectSettingOption(screen, "Zahlst du Kirchensteuer?", "Nein");
    await chooseBirthDate(screen, "15.01.1990");
    await selectSettingOption(screen, "Hast du Kinder?", "Nein");
    await fireEvent.press(screen.getByRole("button", { name: "Zusatzversorgung auswählen" }));
    await selectSettingOption(screen, "Zusatzversorgung", "Weiß ich nicht");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ month: "2026-07", version: 2 }),
    );
    expect(router.back).toHaveBeenCalledTimes(1);
  });
  it("upgrades an old monthly profile only after saving the full form", async () => {
    mockSettings = settings();
    const screen = await edit();
    expect(screen.getByText(/Deine bisherigen Angaben gelten nur/)).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Zusatzversorgung auswählen" }));
    await selectSettingOption(screen, "Zusatzversorgung", "Keine");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        month: "2026-07",
        automation: expect.objectContaining({ pensionScheme: "NONE" }),
      }),
    );
  });
  it("saves tax and family changes together while preserving custom pension and deductions", async () => {
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
    const prior = mockSettings;
    const screen = await edit();
    await selectSettingOption(screen, "Steuerklasse", "2");
    await chooseBirthDate(screen, "15.01.1990");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
    expect(mockSave).toHaveBeenCalledWith({
      ...prior,
      month: "2026-07",
      profile: { ...prior.profile, taxClass: 2, birthDate: "1990-01-15" },
    });
  });
  it("uses the template-style save action in the right header and removes the floating footer", async () => {
    const screen = await edit();
    expect(mockNativeToolbar.placement).toBe("right");
    expect(mockNativeToolbar.hidesSharedBackground).toBe(true);
    expect(
      within(screen.getByTestId("net-pay-native-header-right")).getByRole("button", {
        name: "Speichern und schließen",
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Speichern und schließen" })).toHaveLength(1);
    expect(
      within(screen.getByTestId("net-pay-settings-screen")).queryByRole("button", {
        name: "Speichern und schließen",
      }),
    ).toBeNull();
    expect(screen.queryByTestId("net-pay-settings-footer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Änderungen speichern" })).toBeNull();
    expect(screen.getByTestId("net-pay-settings-screen").props.keyboardShouldPersistTaps).toBe(
      "handled",
    );
    await selectSettingOption(screen, "Steuerklasse", "2");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ profile: expect.objectContaining({ taxClass: 2 }) }),
    );
  });
  it("keeps edits on cancelled native back and discards only after explicit confirmation", async () => {
    const screen = await edit();
    await selectSettingOption(screen, "Steuerklasse", "3");
    expect(mockNativeGuard.active).toBe(true);
    const alert = jest.spyOn(Native.Alert, "alert");
    try {
      const action = { type: "GO_BACK" };
      await act(() => mockNativeGuard.callback({ data: { action } }));
      expect(alert).toHaveBeenCalledWith(
        "Änderungen verwerfen?",
        expect.any(String),
        expect.any(Array),
      );
      const buttons = alert.mock.calls[0]![2]!;
      await act(() => buttons.find((b) => b.text === "Weiter bearbeiten")!.onPress!());
      expect(mockNavigation.dispatch).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Steuerklasse auswählen: 3" })).toBeTruthy();
      await act(() => mockNativeGuard.callback({ data: { action } }));
      const discard = alert.mock.calls[1]![2]!.find((b) => b.text === "Änderungen verwerfen")!;
      await act(() => discard.onPress!());
      expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
      expect(mockSave).not.toHaveBeenCalled();
      await screen.unmount();
      const reopened = await edit();
      expect(reopened.getByRole("button", { name: "Steuerklasse auswählen: 1" })).toBeTruthy();
    } finally {
      alert.mockRestore();
    }
  });
  it("labels saved private insurance on the entry and on the full settings page", async () => {
    mockSettings = { ...automatedSettings("2026-06"), specialCases: ["PRIVATE_INSURANCE"] };
    const entry = await overview();
    await fireEvent.press(
      entry.getByRole("button", { name: /^Netto-Einstellungen.*privat versichert/ }),
    );
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/net-pay-settings",
      params: { month: "2026-07" },
    });
    expect(statement(entry).getByLabelText("Abzüge: Nicht verfügbar")).toBeTruthy();
    await entry.unmount();
    const screen = await edit();
    expect(screen.getByText("Privat versichert · Standardprognose nicht verfügbar")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /^Beitrag für die Prognose:/ })).toBeNull();
  });
  it("keeps the full draft open on a write conflict", async () => {
    const screen = await edit();
    await chooseBirthDate(screen, "16.01.1990");
    mockSave.mockRejectedValueOnce(
      new Error("Die Angaben wurden zwischenzeitlich geändert. Erneut laden."),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
    expect(screen.getByText(/zwischenzeitlich geändert/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Geburtsdatum auswählen: 16.01.1990" })).toBeTruthy();
    expect(mockNativeGuard.active).toBe(true);
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.back).not.toHaveBeenCalled();
  });
  it("keeps the 2027 marker and unknown pension qualifier visible", async () => {
    mockEntries = [forecastShift({ date: "2027-01-03" })];
    mockSettings = {
      ...automatedSettings("2026-06"),
      automation: { ...automatedSettings().automation!, pensionScheme: "UNKNOWN" },
    };
    const screen = await overview("2027-01");
    expect(screen.queryByRole("button", { name: "Berechnungsgrundlagen" })).toBeNull();
    expect(screen.getByText("2027 vorläufig · Abzüge nach Stand 2026")).toBeTruthy();
    expect(screen.getByText("Zusatzversorgung nicht berücksichtigt.")).toBeTruthy();
    expect(totals(screen).getByLabelText(/^Netto vor Zusatzversorgung: [\d.]+\s€$/)).toBeTruthy();
    await screen.unmount();
    const deduction = await details("deductions", "2027-01");
    expect(deduction.getByLabelText(/^Netto rechnerisch \(vorläufig\):/)).toBeTruthy();
    expect(deduction.getByText(/Beiträge zur Zusatzversorgung und ihre Auswirkungen/)).toBeTruthy();
    for (const section of ["premiums", "services"] as const) {
      const detail = await details(section, "2027-01");
      expect(detail.getByText("2027 vorläufig · Abzüge nach Stand 2026")).toBeTruthy();
    }
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("shows a real year-boundary net estimate and its assumptions on all payroll views", async () => {
    mockPaymentPreferences = setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
      effectiveMonth: "2025-01",
      delays: {
        PREMIUMS: 1,
        MONTHLY_ALLOWANCE: 1,
        HOURLY_ALLOWANCE: 1,
        OVERTIME: 1,
        SPECIAL_DUTY: 1,
      },
    });
    mockSettings = automatedSettings("2026-06");
    mockEntries = [forecastShift({ id: "previous-year-night", date: "2026-12-06" })];
    mockTariffDecisions = ["2026-12", "2027-01"].map((month) => ({
      month,
      allowanceStatus: "ALTERNATING_MONTHLY",
      revision: 1,
      confirmedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }));
    const notice =
      "Jahreswechsel geschätzt · Auszahlung zum Monatsende, Jahresbrutto hochgerechnet.";
    const screen = await overview("2027-01");
    expect(totals(screen).getByLabelText(/^Netto geschätzt: [\d.]+\s€$/)).toBeTruthy();
    expect(screen.getByText(notice)).toBeTruthy();
    expect(screen.getByText("2027 vorläufig · Abzüge nach Stand 2026")).toBeTruthy();
    expect(screen.queryByText("Noch offen")).toBeNull();
    await screen.unmount();
    for (const section of ["deductions", "basis"] as const) {
      const detail = await details(section, "2027-01");
      expect(detail.getByText(notice)).toBeTruthy();
      await detail.unmount();
    }
  });
  it("updates the displayed net when calendar work changes", async () => {
    const screen = await overview();
    const before = totals(screen).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel;
    mockEntries = [forecastShift({ endTime: "04:00" })];
    await screen.rerender(<SalaryScreen />);
    expect(totals(screen).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel).not.toBe(
      before,
    );
  });

  it("passes the current month when opening settings after a month change", async () => {
    const screen = await render(
      <NetPayAutomaticEntryCard month="2026-07" proposedGrossCents={500000} blocked={false} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
    await screen.rerender(
      <NetPayAutomaticEntryCard month="2026-08" proposedGrossCents={500000} blocked={false} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Netto-Einstellungen/ }));
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/net-pay-settings",
      params: { month: "2026-08" },
    });
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("keeps all settings on one page without opening a manual calculator", async () => {
    const screen = await edit();
    expect(screen.queryByRole("button", { name: "Manuellen Rechner öffnen" })).toBeNull();
    for (const title of ["Steuern", "Familie", "Versicherung & Vorsorge", "Weitere Angaben"])
      expect(screen.getByRole("header", { name: title })).toBeTruthy();
  });
  it("rejects invalid settings links and test months before enabling profile access", async () => {
    for (const month of ["2026-13", "bad-month"]) {
      const screen = await edit(month);
      expect(screen.getByText("Der Link enthält keinen gültigen Monat.")).toBeTruthy();
      expect(mockSettingsEnabled).toBe(false);
      expect(screen.queryByTestId("net-pay-settings-screen")).toBeNull();
      await screen.unmount();
    }
    mockTestMonths = ["2026-07"];
    const screen = await edit();
    expect(screen.getByText("Für Testdaten gibt es keine Netto-Prognose.")).toBeTruthy();
    expect(mockSettingsEnabled).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("does not suggest changing salary data when a future tariff is unavailable", async () => {
    mockEntries = [forecastShift({ date: "2027-04-04" })];
    const screen = await overview("2027-04");
    expect(statement(screen).getByLabelText("Netto geschätzt: Nicht verfügbar")).toBeTruthy();
    expect(statement(screen).getByLabelText("Abzüge: Nicht verfügbar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gehaltsgrundlage ansehen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gehaltsangaben prüfen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
  });
  it("blocks personal data and results in test months", async () => {
    mockTestMonths = ["2026-07"];
    const screen = await overview();
    expect(screen.queryByLabelText(/^Voraussichtliches Netto:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Netto-Einstellungen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Netto einmal einrichten" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Steuerklasse auswählen/ })).toBeNull();
    expect(statement(screen).getByLabelText("Netto geschätzt: Nicht verfügbar")).toBeTruthy();
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
  it("keeps the statement, deductions route and header export on the selected month", async () => {
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    const screen = await render(<SalaryScreen />);
    const before = totals(screen).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel;
    await fireEvent.press(screen.getByRole("button", { name: /^Nächster Monat/ }));
    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2026-08" });
    mockParams = { month: "2026-08" };
    await screen.rerender(<SalaryScreen />);
    expect(screen.getByText("August 2026")).toBeTruthy();
    expect(mockSetMonth).toHaveBeenLastCalledWith("2026-08");
    expect(mockExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ period: "2026-08", variant: "icon" }),
    );
    expect(totals(screen).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel).not.toBe(
      before,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Abzüge:/ }));
    expect(statement(screen).queryByLabelText(/^Krankenversicherung:/)).toBeNull();
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-08", section: "deductions" },
    });
    await screen.unmount();
    const deduction = await details("deductions", "2026-08");
    expect(deduction.getByLabelText(/^Krankenversicherung:/)).toBeTruthy();
    expect(deduction.getByText("August 2026")).toBeTruthy();
    await fireEvent.press(deduction.getByRole("button", { name: "Zurück" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    await deduction.unmount();
    const returned = await overview("2026-08");
    await fireEvent.press(returned.getByRole("button", { name: /^Vorheriger Monat/ }));
    expect(router.setParams).toHaveBeenLastCalledWith({ month: "2026-07" });
    mockParams = { month: "2026-07" };
    await returned.rerender(<SalaryScreen />);
    expect(totals(returned).getByLabelText(/^Netto geschätzt:/).props.accessibilityLabel).toBe(
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
    expect(statement(screen).getByLabelText(/^Grundentgelt: 4.075,58/)).toBeTruthy();
    expect(statement(screen).getByLabelText(/^Gesamtbrutto:/)).toBeTruthy();
    expect(statement(screen).queryByLabelText(/^Zeitzuschläge:/)).toBeNull();
    const detail = await details("services");
    expect(detail.getByLabelText(/^Keine Zeitzuschläge\./)).toBeTruthy();
    expect(detail.queryByTestId("dropdown-modal-content")).toBeNull();
  });
  it("keeps readiness pay with salary components and opens each December duty from its details", async () => {
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
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 30,
      specialDuty: newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
    });
    mockEntries = [onCall, standby];
    const screen = await render(<SalaryScreen />);
    expect(statement(screen).getByLabelText("Gesamtbrutto: Noch offen")).toBeTruthy();
    expect(screen.queryByText("Bereitschaften")).toBeNull();
    expect(screen.queryByText(/Rufbereitschaftspauschale:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Dienst öffnen:/ })).toBeNull();
    expect(totals(screen).getByLabelText("Gesamtbrutto: Nicht verfügbar")).toBeTruthy();
    const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
    expect(statement(screen).getByLabelText("Weitere Zulagen: Noch offen")).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    await screen.unmount();
    const components = await details("components", "2026-12");
    expect(components.getByLabelText(/^Bereitschaftsvergütung: Noch offen/)).toBeTruthy();
    expect(components.queryByText("Für diesen Monat fehlen Tarifdaten.")).toBeNull();
    await fireEvent.press(components.getByRole("button", { name: /^Bereitschaften/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/salary-details",
      params: { month: "2026-12", section: "special-duties" },
    });
    await components.unmount();
    const dutyDetails = await details("special-duties", "2026-12");
    expect(dutyDetails.getByText(/Rufbereitschaftspauschale: 6,01/)).toBeTruthy();
    expect(dutyDetails.getByText("Betrag noch offen")).toBeTruthy();
    for (const [entry, label] of [
      [onCall, "Dienst öffnen: 05.12. · Rufbereitschaft"],
      [standby, "Dienst öffnen: 09.12. · Bereitschaftsdienst"],
    ] as const) {
      await fireEvent.press(dutyDetails.getByRole("button", { name: label }));
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
          standbyLevel: "II",
          settlement: "PAY",
          standbyAgreement: { ...newStandbyAgreement("TVOED_K"), rule: "STANDARD" },
        },
      },
    ];
    await dutyDetails.rerender(<SalaryDetailsScreen />);
    expect(dutyDetails.queryByText("Betrag noch offen")).toBeNull();
    expect(dutyDetails.getByText(/Auszahlung Bereitschaftsdienst: 131,01/)).toBeTruthy();
    expect(dutyDetails.getByText(/Geleistet: 450 Min.*Vergütung: 337,5 Min/)).toBeTruthy();
    await dutyDetails.unmount();
    const completed = await details("components", "2026-12");
    expect(completed.getByLabelText(/^Bereitschaftsvergütung: 137,02/)).toBeTruthy();
    expect(completed.queryByRole("button", { name: /^Bereitschaftsvergütung:/ })).toBeNull();
    expect(completed.queryByText(/Auszahlung Bereitschaftsdienst:/)).toBeNull();
    const gross = completed.getByLabelText(/^Gesamtbrutto:/).props.accessibilityLabel;
    await completed.unmount();
    mockParams = { month: "2026-12" };
    const overview = await render(<SalaryScreen />);
    expect(overview.queryByText("Gehaltsprognose noch offen")).toBeNull();
    expect(overview.queryByText("Bereitschaften")).toBeNull();
    expect(overview.queryByText(/Auszahlung Bereitschaftsdienst:/)).toBeNull();
    expect(statement(overview).getByLabelText(/^Gesamtbrutto:/).props.accessibilityLabel).toBe(
      gross,
    );
    expect(statement(overview).getByLabelText(/^Netto geschätzt: [\d.,]+\s€/)).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("shows an empty readiness detail without inventing amounts or duty links", async () => {
    const screen = await details("special-duties");
    expect(screen.getByText("Keine Bereitschaften in diesem Monat.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Dienst öffnen:/ })).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("preserves manual gross salary and its separate component access", async () => {
    mockSettings = null;
    mockProfile = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 450000 };
    const screen = await render(<SalaryScreen />);
    expect(statement(screen).getByLabelText(/^Gesamtbrutto: 4.500,00/)).toBeTruthy();
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
    expect(statement(screen).getByLabelText(/^Gesamtbrutto: 4.600,00/)).toBeTruthy();
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
    expect(
      Native.StyleSheet.flatten(summary.getByTestId("salary-payroll-totals").props.style)
        .flexDirection,
    ).toBe("column");
    expect(statement(summary).getByText("Gesamtbrutto").props.numberOfLines).toBeUndefined();
    expect(statement(summary).getByText("Netto geschätzt").props.numberOfLines).toBeUndefined();
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
