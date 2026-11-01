import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  setSalaryPaymentLag,
  setSalaryPaymentPeriod,
  type SalaryPaymentPreferences,
} from "@/domain/salary-payment";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { forecastProfile as mockForecastProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { employmentDataFromProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { SalaryPayrollSettings } from "./salary-payroll-settings";

const mockPaymentSave = jest.fn<(preferences: SalaryPaymentPreferences) => Promise<void>>();
const mockNetSave =
  jest.fn<(settings: MonthlyNetPaySettings, effectiveMonth?: string) => Promise<void>>();
const mockReload = jest.fn();
const mockGuard = jest.fn();
let mockPreferences = DEFAULT_SALARY_PAYMENT_PREFERENCES;
let mockPaymentReady = true;
let mockInitial: MonthlyNetPaySettings | null = automatedSettings("2026-01");
let mockProfile = mockForecastProfile;
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
  usePflegeShiftStatus: () => ({ ready: true, error: null }),
}));
jest.mock("./salary-payment-preferences", () => ({
  useSalaryPaymentPreferences: () => ({
    preferences: mockPreferences,
    ready: mockPaymentReady,
    saving: false,
    error: null,
    save: mockPaymentSave,
    reload: mockReload,
  }),
}));
jest.mock("./use-net-pay-profile", () => ({
  useNetPayProfile: () => ({
    status: "ready",
    saved: mockInitial ? { settings: mockInitial, revision: 1 } : null,
    timeline: mockInitial ? [{ settings: mockInitial, revision: 1 }] : [],
    busy: false,
    error: null,
    save: mockNetSave,
    reload: mockReload,
  }),
}));
jest.mock("@/features/settings/use-profile-leave-guard", () => ({
  useProfileLeaveGuard: (dirty: boolean) => {
    mockGuard(dirty);
    return { saved: jest.fn() };
  },
}));

describe("inline classic payroll settings", () => {
  beforeEach(() => {
    mockPreferences = DEFAULT_SALARY_PAYMENT_PREFERENCES;
    mockPaymentReady = true;
    mockInitial = automatedSettings("2026-01");
    mockProfile = mockForecastProfile;
    mockPaymentSave.mockReset().mockResolvedValue();
    mockNetSave.mockReset().mockResolvedValue();
    mockReload.mockClear();
    mockGuard.mockClear();
  });

  it("always exposes the payout and existing tax inputs, with all other fields inline", async () => {
    const screen = await render(<SalaryPayrollSettings month="2026-10" blocked={false} />);
    expect(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    ).toBeTruthy();
    expect(screen.getByText("Zulagenmonat: Oktober 2026")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: `Steuerklasse auswählen: ${mockInitial!.profile.taxClass}`,
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kirchensteuer auswählen: Keine" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Netto-Angaben" }));
    expect(screen.getByLabelText("Geburtsdatum (TT.MM.JJJJ)")).toBeTruthy();
    expect(screen.getByLabelText("Weitere monatliche Netto-Abzüge (€)")).toBeTruthy();
    expect(mockPaymentSave).not.toHaveBeenCalled();
    expect(mockNetSave).not.toHaveBeenCalled();
  });

  it("saves timing separately and preserves an unsaved net draft", async () => {
    const screen = await render(<SalaryPayrollSettings month="2026-10" blocked={false} />);
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Netto-Angaben" }));
    await fireEvent.changeText(
      screen.getByLabelText("Weitere monatliche Netto-Abzüge (€)"),
      "18,00",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    );
    await fireEvent.press(
      screen.getByRole("radio", { name: "Zulagen werden ausgezahlt: Im Folgemonat" }),
    );
    await waitFor(() =>
      expect(mockPaymentSave).toHaveBeenCalledWith(
        setSalaryPaymentLag(mockPreferences, "2026-10", 1),
      ),
    );
    expect(mockNetSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Weitere monatliche Netto-Abzüge (€)").props.value).toBe("18,00");
  });

  it("saves validated net inputs without leaving, resets dirty state, and refreshes the payroll", async () => {
    const changed = jest.fn();
    const screen = await render(
      <SalaryPayrollSettings month="2026-10" blocked={false} onChanged={changed} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Netto-Angaben" }));
    await fireEvent.changeText(
      screen.getByLabelText("Weitere monatliche Netto-Abzüge (€)"),
      "18,00",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Angaben speichern" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(mockNetSave.mock.calls[0][0].automation?.additionalNetDeductionCents).toBe(1800);
    expect(screen.getByRole("button", { name: "Netto-Angaben speichern" })).toBeTruthy();
    expect(mockGuard).toHaveBeenLastCalledWith(false);
  });

  it("does not invent tax or church selections for a first setup", async () => {
    mockInitial = null;
    const screen = await render(<SalaryPayrollSettings month="2026-10" blocked={false} />);
    expect(screen.getByRole("button", { name: "Steuerklasse auswählen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kirchensteuer auswählen" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Angaben speichern" }));
    expect(mockNetSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Bitte deine Steuerklasse auswählen/)).toBeTruthy();
  });

  it("waits for persisted timing before displaying its selected value", async () => {
    mockPaymentReady = false;
    const screen = await render(<SalaryPayrollSettings month="2026-10" blocked={false} />);
    expect(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen" }),
    ).toBeDisabled();
    expect(screen.getByText("Auszahlungsmonat wird geladen …")).toBeTruthy();
    expect(screen.queryByText("Zulagenmonat: Oktober 2026")).toBeNull();
    expect(mockPaymentSave).not.toHaveBeenCalled();
  });

  it("keeps persisted timing when its save fails", async () => {
    mockPaymentSave.mockRejectedValueOnce(new Error("conflict"));
    const screen = await render(<SalaryPayrollSettings month="2026-10" blocked={false} />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    );
    await fireEvent.press(
      screen.getByRole("radio", { name: "Zulagen werden ausgezahlt: Im übernächsten Monat" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Auszahlungsmonat wurde nicht gespeichert/)).toBeTruthy(),
    );
    expect(screen.getByText("Zulagenmonat: Oktober 2026")).toBeTruthy();
  });

  it("shows both actual source months at a timing transition", async () => {
    mockPreferences = setSalaryPaymentPeriod(
      setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2026-03", 2),
      {
        effectiveMonth: "2026-09",
        delays: {
          PREMIUMS: 1,
          MONTHLY_ALLOWANCE: 1,
          HOURLY_ALLOWANCE: 1,
          OVERTIME: 1,
          SPECIAL_DUTY: 1,
        },
      },
    );
    const screen = await render(<SalaryPayrollSettings month="2026-10" blocked={false} />);
    expect(screen.getByText("Zulagenmonate: August 2026 und September 2026")).toBeTruthy();
  });

  it("shows timing as saved only after the durable write finishes", async () => {
    let finish!: () => void;
    mockPaymentSave.mockImplementationOnce(
      (next) =>
        new Promise<void>((resolve) => {
          finish = () => {
            mockPreferences = next;
            resolve();
          };
        }),
    );
    const screen = await render(<SalaryPayrollSettings month="2026-10" blocked={false} />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    );
    await fireEvent.press(
      screen.getByRole("radio", { name: "Zulagen werden ausgezahlt: Im Folgemonat" }),
    );
    expect(screen.getByLabelText("Auszahlungsmonat wird gespeichert")).toBeTruthy();
    expect(screen.getByText("Zulagenmonat: Oktober 2026")).toBeTruthy();
    await act(async () => {
      finish();
    });
    await screen.rerender(<SalaryPayrollSettings month="2026-10" blocked={false} />);
    expect(screen.getByText("Zulagenmonat: September 2026")).toBeTruthy();
  });

  it("keeps net drafts and avoids a refresh after a failed validated save", async () => {
    mockNetSave.mockRejectedValueOnce(new Error("Die Angaben wurden inzwischen geändert."));
    const changed = jest.fn();
    const screen = await render(
      <SalaryPayrollSettings month="2026-10" blocked={false} onChanged={changed} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Netto-Angaben" }));
    await fireEvent.changeText(
      screen.getByLabelText("Weitere monatliche Netto-Abzüge (€)"),
      "18,00",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Angaben speichern" }));
    await waitFor(() =>
      expect(screen.getByText("Die Angaben wurden inzwischen geändert.")).toBeTruthy(),
    );
    expect(screen.getByLabelText("Weitere monatliche Netto-Abzüge (€)").props.value).toBe("18,00");
    expect(changed).not.toHaveBeenCalled();
  });

  it("opens missing source-month net inputs on the same page", async () => {
    const historical = { ...mockForecastProfile, federalState: "SN" as const };
    mockProfile = {
      ...mockForecastProfile,
      employmentTimeline: [
        {
          effectiveFrom: null,
          data: remunerationDataFromLegacy(historical),
          employment: employmentDataFromProfile(historical),
          revision: 1,
          createdAt: mockForecastProfile.createdAt,
          updatedAt: mockForecastProfile.updatedAt,
        },
        {
          effectiveFrom: "2026-10-01",
          data: remunerationDataFromLegacy(mockForecastProfile),
          employment: employmentDataFromProfile(mockForecastProfile),
          revision: 1,
          createdAt: mockForecastProfile.createdAt,
          updatedAt: mockForecastProfile.updatedAt,
        },
      ],
    };
    const handled = jest.fn();
    const screen = await render(
      <SalaryPayrollSettings
        month="2026-10"
        blocked={false}
        netRequestMonth="2026-08"
        onNetRequestHandled={handled}
      />,
    );
    await waitFor(() => expect(screen.getByText("Netto-Angaben für August 2026")).toBeTruthy());
    expect(handled).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Netto-Angaben speichern" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Angaben speichern" }));
    await waitFor(() => expect(mockNetSave).toHaveBeenCalledTimes(1));
    expect(mockNetSave.mock.calls[0][0].month).toBe("2026-08");
    expect(mockNetSave.mock.calls[0][0].profile.worksInSaxony).toBe(true);
  });

  it("blocks writes while viewing test data", async () => {
    const screen = await render(<SalaryPayrollSettings month="2026-10" blocked />);
    expect(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    ).toBeDisabled();
    expect(mockPaymentSave).not.toHaveBeenCalled();
    expect(mockNetSave).not.toHaveBeenCalled();
  });

  it("keeps the payout choice visible without embedding net inputs in timing-only mode", async () => {
    mockPaymentSave.mockImplementation(async (next) => {
      mockPreferences = next;
    });
    const changed = jest.fn();
    const screen = await render(
      <SalaryPayrollSettings month="2026-10" blocked={false} timingOnly onChanged={changed} />,
    );
    expect(screen.queryByRole("button", { name: /^Steuerklasse auswählen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Weitere Netto-Angaben" })).toBeNull();
    expect(screen.queryByLabelText("Geburtsdatum (TT.MM.JJJJ)")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    );
    await fireEvent.press(
      screen.getByRole("radio", { name: "Zulagen werden ausgezahlt: Im Folgemonat" }),
    );
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(mockPaymentSave).toHaveBeenCalledTimes(1);
    await screen.rerender(
      <SalaryPayrollSettings month="2026-10" blocked={false} timingOnly onChanged={changed} />,
    );
    expect(screen.getByText("Zulagenmonat: September 2026")).toBeTruthy();
    expect(mockNetSave).not.toHaveBeenCalled();
  });

  it("reports open drafts and pending writes for the parent month-navigation guard", async () => {
    const dirty = jest.fn();
    const busy = jest.fn();
    let finish!: () => void;
    mockPaymentSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const screen = await render(
      <SalaryPayrollSettings
        month="2026-10"
        blocked={false}
        onDirtyChange={dirty}
        onBusyChange={busy}
      />,
    );
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(busy).toHaveBeenLastCalledWith(false);
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Netto-Angaben" }));
    await fireEvent.changeText(
      screen.getByLabelText("Weitere monatliche Netto-Abzüge (€)"),
      "18,00",
    );
    expect(dirty).toHaveBeenLastCalledWith(true);
    await fireEvent.press(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    );
    await fireEvent.press(
      screen.getByRole("radio", { name: "Zulagen werden ausgezahlt: Im Folgemonat" }),
    );
    expect(busy).toHaveBeenLastCalledWith(true);
    expect(dirty).toHaveBeenLastCalledWith(true);
    await act(async () => {
      finish();
    });
    expect(busy).toHaveBeenLastCalledWith(false);
    await fireEvent.press(screen.getByRole("button", { name: "Netto-Angaben speichern" }));
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  });
});
