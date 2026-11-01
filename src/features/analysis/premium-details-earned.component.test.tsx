import * as MockReact from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { MonthlyTariffDecision, UserProfile } from "@/domain/types";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { resolveNetPaySettings as mockResolveNetPaySettings } from "@/domain/net-pay-profile";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { employmentDataFromProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES, setSalaryPaymentLag } from "@/domain/salary-payment";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import * as netPreparation from "@/features/salary/automatic-net-pay-preparation";
import { netPayEuro } from "@/features/salary/net-pay-format";
import { PremiumDetailsScreen } from "./premium-details-screen";

let mockParams = { month: "2026-10" };
let mockProfile: UserProfile = forecastProfile;
let mockTestMonths: string[] = [];
let mockPaymentPreferences = DEFAULT_SALARY_PAYMENT_PREFERENCES;
let mockEntries = screenshotShifts();
const mockSetMonth = jest.fn();
const mockCoordinator = { getMonth: () => "2026-10", setMonth: mockSetMonth };
const mockNetAccess = jest.fn<(month: string, enabled: boolean) => void>();
const mockPaymentAccess = jest.fn();
const saved = (month: string): SavedMonthlyNetPaySettings => ({
  settings: automatedSettings(month),
  revision: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
let mockNetTimeline: readonly SavedMonthlyNetPaySettings[] = [saved("2026-01")];
const mockWorkPattern = { workplaceCoverage: "UNKNOWN", assignment: "UNKNOWN", updatedAt: null };
const mockDecisions: readonly MonthlyTariffDecision[] = ["2026-08", "2026-09", "2026-10"].map(
  (month) => ({
    month,
    allowanceStatus: "NONE",
    revision: 1,
    confirmedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
);

function screenshotShifts() {
  return [
    ...[
      ["01", "21:04"],
      ["06", "19:00"],
      ["13", "19:00"],
      ["20", "19:57"],
    ].map(([day, startTime], i) =>
      forecastShift({
        id: `september-${i}`,
        date: `2026-09-${day}`,
        startTime,
        endTime: "06:00",
        breakMinutes: 30,
      }),
    ),
    ...[
      ["01", "21:00"],
      ["05", "21:00"],
      ["06", "21:00"],
      ["07", "21:00"],
      ["08", "21:00"],
      ["12", "21:00"],
      ["13", "21:17"],
      ["04", "19:00"],
      ["11", "19:46"],
    ].map(([day, startTime], i) =>
      forecastShift({
        id: `october-${i}`,
        date: `2026-10-${day}`,
        startTime,
        endTime: "06:00",
        breakMinutes: 30,
      }),
    ),
  ];
}

jest.mock("expo-router", () => ({
  router: {
    back: jest.fn(),
    push: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
    setParams: jest.fn(),
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void) => MockReact.useEffect(callback, [callback]),
}));
jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 100,
  HeaderBackButton: () => null,
}));
jest.mock("@/navigation/active-month", () => ({
  useActiveMonthCoordinator: () => mockCoordinator,
}));
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual<typeof import("react-native-safe-area-context")>(
    "react-native-safe-area-context",
  ),
  SafeAreaProvider: ({ children }: MockReact.PropsWithChildren) => children,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
  usePflegeShiftTariff: () => ({
    tariffDecisions: mockDecisions,
    workPatternSettings: mockWorkPattern,
  }),
  usePflegeShiftTestData: () => ({ testMonths: mockTestMonths }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({
    resolver:
      jest.requireActual<typeof import("@/rules/rule-resolver")>("@/rules/rule-resolver")
        .bundledRuleResolver,
  }),
}));
jest.mock("@/features/salary/use-net-pay-profile", () => ({
  useNetPayProfile: (month: string, enabled: boolean) => {
    mockNetAccess(month, enabled);
    return {
      status: "ready",
      saved: enabled ? mockResolveNetPaySettings(month, mockNetTimeline) : null,
      timeline: enabled ? mockNetTimeline : [],
      error: null,
      reload: jest.fn(),
    };
  },
}));
jest.mock("@/features/salary/salary-payment-preferences", () => ({
  useSalaryPaymentPreferences: () => {
    mockPaymentAccess();
    return { preferences: mockPaymentPreferences, ready: true, saving: false, error: null };
  },
}));

describe("earned premium service workflow", () => {
  beforeEach(() => {
    mockParams = { month: "2026-10" };
    mockProfile = forecastProfile;
    mockEntries = screenshotShifts();
    mockTestMonths = [];
    mockNetTimeline = [saved("2026-01")];
    mockPaymentPreferences = DEFAULT_SALARY_PAYMENT_PREFERENCES;
    mockNetAccess.mockClear();
    mockPaymentAccess.mockClear();
    mockSetMonth.mockClear();
  });

  function standby(night = false) {
    const startTime = night ? "21:00" : "06:00";
    const endTime = night ? "06:00" : "14:00";
    return forecastShift({
      id: "earned-standby",
      date: "2026-07-07",
      title: "Bereitschaft",
      startTime,
      endTime,
      breakMinutes: night ? 0 : 30,
      specialDuty: {
        ...newSpecialDuty("STANDBY", startTime, endTime, "Europe/Berlin"),
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
    });
  }

  it.each([0, 1, 2] as const)(
    "shows daytime readiness cash and its original service at payout lag %s",
    async (lag) => {
      mockParams = { month: "2026-07" };
      mockEntries = [standby()];
      mockPaymentPreferences = setSalaryPaymentLag(
        DEFAULT_SALARY_PAYMENT_PREFERENCES,
        "2026-01",
        lag,
      );
      const pay = calculateMonthlyPayEstimate("2026-07", mockEntries, forecastProfile, null);
      expect(pay.available).toBe(true);
      expect(pay.timePremiumAmount).toBe(0);
      expect(pay.specialDutyAmount).toBeGreaterThan(0);
      const amount = netPayEuro(Math.round(pay.specialDutyAmount! * 100));
      const screen = await render(<PremiumDetailsScreen />);
      expect(screen.getByLabelText(`Zuschläge erarbeitet: ${amount}`)).toBeTruthy();
      expect(screen.queryByText("Keine Zeitzuschläge")).toBeNull();
      const list = within(screen.getByTestId("net-pay-service-details"));
      expect(list.getAllByRole("button")).toHaveLength(1);
      await fireEvent.press(list.getByRole("button", { name: `Di. 07.07.: ${amount}` }));
      expect(screen.getByTestId("dropdown-modal-content")).toBeTruthy();
      expect(screen.getByText(`Auszahlung Bereitschaftsdienst: ${amount}`)).toBeTruthy();
      expect(screen.getByText(/Grundbetrag:/)).toBeTruthy();
      expect(mockPaymentAccess).not.toHaveBeenCalled();
    },
  );

  it("counts readiness cash once in All and only night premiums in the night filter", async () => {
    mockParams = { month: "2026-07" };
    mockEntries = [standby(true), forecastShift({ id: "ordinary-night", date: "2026-07-08" })];
    const calculate = jest.spyOn(netPreparation, "prepareAutomaticNetPay");
    const screen = await render(<PremiumDetailsScreen />);
    const result = (
      calculate.mock.results.at(-1)!.value as ReturnType<
        typeof netPreparation.prepareAutomaticNetPay
      >
    ).result;
    if (result.status !== "available") throw new Error("Readiness classification unavailable");
    const pay = calculateMonthlyPayEstimate("2026-07", mockEntries, forecastProfile, null);
    const total = netPayEuro(Math.round((pay.timePremiumAmount + pay.specialDutyAmount!) * 100));
    const special = netPayEuro(Math.round(pay.specialDutyAmount! * 100));
    const totalCents = Math.round((pay.timePremiumAmount + pay.specialDutyAmount!) * 100);
    expect(totalCents).toBeGreaterThan(result.classification.paidPremiumCents);
    const night = result.classification.shifts
      .flatMap((row) => row.premiumBreakdown)
      .filter((line) => line.category === "NIGHT")
      .reduce((sum, line) => sum + line.paidPremiumCents, 0);
    expect(screen.getByLabelText(`Zuschläge erarbeitet: ${total}`)).toBeTruthy();
    expect(
      screen.getByText(
        `Steuerfrei ${netPayEuro(result.classification.taxFreeCents)} · Steuerpflichtig ${netPayEuro(totalCents - result.classification.taxFreeCents)}`,
      ),
    ).toBeTruthy();
    const list = within(screen.getByTestId("net-pay-service-details"));
    expect(list.getAllByRole("button")).toHaveLength(2);
    await fireEvent.press(list.getByRole("radio", { name: "Nacht" }));
    expect(screen.getByLabelText(`Zeitzuschläge: ${netPayEuro(night)}`)).toBeTruthy();
    expect(list.getAllByRole("button")).toHaveLength(2);
    await fireEvent.press(list.getByRole("radio", { name: "Bereitschaften" }));
    expect(screen.getByLabelText(`Bereitschaftsvergütung: ${special}`)).toBeTruthy();
    const specialFree = result.classification.shifts
      .filter((row) => (row.sourceShiftId ?? row.shiftId) === "earned-standby")
      .reduce((sum, row) => sum + row.taxFreeCents, 0);
    expect(specialFree).toBeGreaterThan(0);
    expect(
      screen.getByText(
        `Steuerfrei ${netPayEuro(specialFree)} · Steuerpflichtig ${netPayEuro(Math.round(pay.specialDutyAmount! * 100) - specialFree)}`,
      ),
    ).toBeTruthy();
    expect(list.getAllByRole("button")).toHaveLength(1);
    await fireEvent.press(list.getByRole("radio", { name: "Alle" }));
    expect(screen.getByLabelText(`Zuschläge erarbeitet: ${total}`)).toBeTruthy();
    expect(list.getAllByRole("button")).toHaveLength(2);
  });

  it("keeps readiness cash visible without inventing a tax split when net settings are missing", async () => {
    mockParams = { month: "2026-07" };
    mockEntries = [standby()];
    mockNetTimeline = [];
    const pay = calculateMonthlyPayEstimate("2026-07", mockEntries, forecastProfile, null);
    const screen = await render(<PremiumDetailsScreen />);
    expect(
      screen.getByLabelText(
        `Zuschläge erarbeitet: ${netPayEuro(Math.round(pay.specialDutyAmount! * 100))}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Steuerliche Aufteilung noch nicht verfügbar.")).toBeTruthy();
    expect(screen.queryByText(/Steuerfrei 0,00/)).toBeNull();
  });

  it("filters readiness night cash without needing personal net settings", async () => {
    mockParams = { month: "2026-07" };
    mockEntries = [standby(true), forecastShift({ id: "ordinary-night", date: "2026-07-08" })];
    mockNetTimeline = [];
    const pay = calculateMonthlyPayEstimate("2026-07", mockEntries, forecastProfile, null);
    const nightCents =
      pay.shiftBreakdowns
        .flatMap((row) => row.premiumLines)
        .filter((line) => line.key.toUpperCase() === "NIGHT")
        .reduce((sum, line) => sum + Math.round(line.amount * 100), 0) +
      pay.specialDutyBreakdowns![0].standbyPay!.nightPremiumCents!;
    const screen = await render(<PremiumDetailsScreen />);
    const list = within(screen.getByTestId("net-pay-service-details"));
    await fireEvent.press(list.getByRole("radio", { name: "Nacht" }));
    expect(screen.getByLabelText(`Zeitzuschläge: ${netPayEuro(nightCents)}`)).toBeTruthy();
    expect(screen.getByText("Steuerliche Aufteilung noch nicht verfügbar.")).toBeTruthy();
    expect(list.getAllByRole("button")).toHaveLength(2);
  });

  it.each([0, 1, 2] as const)(
    "keeps October's 399.87 and original services at payout lag %s",
    async (lag) => {
      mockPaymentPreferences = setSalaryPaymentLag(
        DEFAULT_SALARY_PAYMENT_PREFERENCES,
        "2026-10",
        lag,
      );
      const calculate = jest.spyOn(netPreparation, "prepareAutomaticNetPay");
      const screen = await render(<PremiumDetailsScreen />);
      expect(screen.getByRole("header", { name: "Zuschläge je Dienst" })).toBeTruthy();
      expect(screen.getByText("Oktober 2026")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Nächster Monat/ })).toBeNull();
      expect(screen.getByLabelText("Zeitzuschläge: 399,87\u00a0€")).toBeTruthy();
      expect(screen.queryByText(/234,63/)).toBeNull();
      const list = within(screen.getByTestId("net-pay-service-details"));
      expect(list.getAllByRole("button", { name: /\d{2}\.10\.:/ })).toHaveLength(9);
      expect(list.queryByRole("button", { name: /\d{2}\.09\.:/ })).toBeNull();
      expect(mockPaymentAccess).not.toHaveBeenCalled();
      expect(calculate).toHaveBeenCalled();
      expect(calculate.mock.calls.at(-1)).toHaveLength(4);
      const forecast = calculate.mock.results.at(-1)!.value as ReturnType<
        typeof netPreparation.prepareAutomaticNetPay
      >;
      if (forecast.result.status !== "available") throw new Error("Source forecast unavailable");
      expect(forecast.result.classification.taxFreeCents).toBeGreaterThan(0);
      expect(
        screen.getByText(
          `Steuerfrei ${netPayEuro(forecast.result.classification.taxFreeCents)} · Steuerpflichtig ${netPayEuro(39_987 - forecast.result.classification.taxFreeCents)}`,
        ),
      ).toBeTruthy();
      expect(
        forecast.result.classification.shifts.every((shift) =>
          shift.shiftId.startsWith("october-"),
        ),
      ).toBe(true);
      expect(screen.queryByLabelText(/^Netto/)).toBeNull();
      expect(mockSetMonth).toHaveBeenCalledWith("2026-10");
      const { router } = jest.requireMock<typeof import("expo-router")>("expo-router");
      await fireEvent.press(screen.getByRole("button", { name: "Zurück zur Auswertung" }));
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it("retains the original category chips, connected list and service selection sheet", async () => {
    const calculate = jest.spyOn(netPreparation, "prepareAutomaticNetPay");
    mockEntries = [
      forecastShift({ id: "night", date: "2026-10-01", endTime: "06:00", breakMinutes: 30 }),
      forecastShift({
        id: "holiday",
        date: "2026-10-03",
        title: "Feiertagsdienst",
        type: "DAY",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30,
      }),
      forecastShift({
        id: "sunday",
        date: "2026-10-04",
        title: "Sonntagsdienst",
        type: "DAY",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30,
      }),
    ];
    const screen = await render(<PremiumDetailsScreen />);
    const forecast = calculate.mock.results.at(-1)!.value as ReturnType<
      typeof netPreparation.prepareAutomaticNetPay
    >;
    if (forecast.result.status !== "available") throw new Error("Source forecast unavailable");
    const nightLines = forecast.result.classification.shifts
      .flatMap((shift) => shift.premiumBreakdown)
      .filter((line) => line.category === "NIGHT");
    const nightPaid = nightLines.reduce((sum, line) => sum + line.paidPremiumCents, 0);
    const nightFree = nightLines.reduce((sum, line) => sum + line.taxFreeCents, 0);
    expect(nightPaid).toBeLessThan(forecast.result.classification.paidPremiumCents);
    const list = within(screen.getByTestId("net-pay-service-details"));
    for (const name of ["Alle", "Nacht", "Feiertag", "Sonntag"])
      expect(list.getByRole("radio", { name })).toBeTruthy();
    expect(list.getAllByRole("button")).toHaveLength(3);
    await fireEvent.press(list.getByRole("radio", { name: "Nacht" }));
    expect(list.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByLabelText(`Zeitzuschläge: ${netPayEuro(nightPaid)}`)).toBeTruthy();
    expect(
      screen.getByText(
        `Steuerfrei ${netPayEuro(nightFree)} · Steuerpflichtig ${netPayEuro(nightPaid - nightFree)}`,
      ),
    ).toBeTruthy();
    await fireEvent.press(list.getByRole("button", { name: /^Do\. 01\.10\.:/ }));
    expect(screen.getByTestId("dropdown-modal-content")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Berechnung dieses Dienstes" })).toBeTruthy();
    expect(screen.getByText(/endet am 02\.10\./)).toBeTruthy();
    expect(screen.getByText(/Sozialversicherungsfrei.*Beitragspflichtig/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
    expect(list.getByRole("radio", { name: "Nacht" }).props.accessibilityState.checked).toBe(true);
    await fireEvent.press(list.getByRole("radio", { name: "Alle" }));
    expect(list.getAllByRole("button")).toHaveLength(3);
    expect(
      screen.getByLabelText(
        `Zeitzuschläge: ${netPayEuro(forecast.result.classification.paidPremiumCents)}`,
      ),
    ).toBeTruthy();
  });

  it("retains TV-UK cash premiums and mandatory night-work time credit", async () => {
    mockProfile = {
      ...forecastProfile,
      federalState: "BW",
      tariff: null,
      tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
    };
    mockEntries = [
      forecastShift({
        id: "uk-earned-night",
        date: "2026-10-05",
        startTime: "20:00",
        endTime: "06:00",
        breakMinutes: 0,
      }),
    ];
    const screen = await render(<PremiumDetailsScreen />);
    expect(screen.getByLabelText("Zeitzuschläge: 67,60\u00a0€")).toBeTruthy();
    expect(screen.getByText("Zusätzlich 30 Min. Freizeitausgleich für Nachtarbeit.")).toBeTruthy();
    expect(screen.getByTestId("net-pay-service-details")).toBeTruthy();
  });

  it("does not borrow later net settings for an earlier earned month", async () => {
    mockNetTimeline = [saved("2026-11")];
    const calculate = jest.spyOn(netPreparation, "prepareAutomaticNetPay");
    const screen = await render(<PremiumDetailsScreen />);
    expect(screen.getByLabelText("Zeitzuschläge: 399,87\u00a0€")).toBeTruthy();
    expect(screen.getByText("Steuerliche Aufteilung noch nicht verfügbar.")).toBeTruthy();
    expect(calculate).not.toHaveBeenCalled();
    expect(screen.getByTestId("net-pay-service-details")).toBeTruthy();
  });

  it("blocks personal tax classification in test months while retaining earned service data", async () => {
    mockTestMonths = ["2026-10"];
    const calculate = jest.spyOn(netPreparation, "prepareAutomaticNetPay");
    const screen = await render(<PremiumDetailsScreen />);
    expect(mockNetAccess).toHaveBeenLastCalledWith("2026-10", false);
    expect(calculate).not.toHaveBeenCalled();
    expect(
      screen.getByText("Für Testdaten wird keine steuerliche Aufteilung berechnet."),
    ).toBeTruthy();
    expect(screen.getByText("Steuerliche Aufteilung noch nicht verfügbar.")).toBeTruthy();
    expect(screen.getByTestId("net-pay-service-details")).toBeTruthy();
  });

  it("dates the tariff profile before deciding whether earned premiums are manual", async () => {
    const current: UserProfile = {
      ...forecastProfile,
      tariff: null,
      manualMonthlyGrossCents: 450_000,
    };
    mockProfile = {
      ...current,
      employmentTimeline: [
        {
          effectiveFrom: null,
          data: remunerationDataFromLegacy(forecastProfile),
          employment: employmentDataFromProfile(forecastProfile),
          revision: 1,
          createdAt: forecastProfile.createdAt,
          updatedAt: forecastProfile.updatedAt,
        },
        {
          effectiveFrom: "2026-11-01",
          data: remunerationDataFromLegacy(current),
          employment: employmentDataFromProfile(current),
          revision: 1,
          createdAt: current.createdAt,
          updatedAt: current.updatedAt,
        },
      ],
    };
    const screen = await render(<PremiumDetailsScreen />);
    expect(screen.getByLabelText("Zeitzuschläge: 399,87\u00a0€")).toBeTruthy();
    expect(screen.queryByText("Keine tarifliche Berechnung")).toBeNull();
  });

  it("rejects an invalid route before requesting personal net settings", async () => {
    mockParams = { month: "2026-13" };
    const screen = await render(<PremiumDetailsScreen />);
    expect(
      screen.getByText("Der Link zu den Zuschlagsdetails enthält keinen gültigen Monat."),
    ).toBeTruthy();
    expect(mockNetAccess.mock.calls.every((call) => call[1] === false)).toBe(true);
    expect(screen.queryByTestId("net-pay-service-details")).toBeNull();
  });
});
