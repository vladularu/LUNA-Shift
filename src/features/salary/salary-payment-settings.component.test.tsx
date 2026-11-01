import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  setSalaryPaymentLag,
  setSalaryPaymentPeriod,
  type SalaryPaymentPreferences,
} from "@/domain/salary-payment";
import { SalaryPaymentSettingsForm } from "./salary-payment-settings-screen";

jest.mock("expo-router", () => ({ router: {}, useLocalSearchParams: () => ({}) }));
const mockSaved = jest.fn<(onLeave?: () => void) => void>((onLeave) => onLeave?.());
jest.mock("@/features/settings/use-profile-leave-guard", () => ({
  useProfileLeaveGuard: () => ({ saved: mockSaved }),
}));
const mockSave = jest.fn<(value: SalaryPaymentPreferences) => Promise<void>>();
const mockBack = jest.fn<() => void>();
const mount = (initial = DEFAULT_SALARY_PAYMENT_PREFERENCES) =>
  render(
    <SalaryPaymentSettingsForm
      month="2027-01"
      initial={initial}
      saving={false}
      onSave={mockSave}
      onSaved={mockBack}
    />,
  );

describe("one allowance payout setting", () => {
  beforeEach(() => {
    mockSaved.mockClear();
    mockBack.mockClear();
    mockSave.mockReset().mockResolvedValue();
  });

  it("defaults to the same month and offers exactly the three requested options", async () => {
    const screen = await mount();
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText("Gilt ab dieser Auszahlung.")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByText(/TVöD-Vorschlag|Sozialversicherungsbeiträge/)).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Zulagen werden ausgezahlt auswählen: Im selben Monat" }),
    );
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      screen.getByRole("radio", { name: "Zulagen werden ausgezahlt: Im selben Monat" }),
    ).toBeChecked();
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockSave).toHaveBeenCalledWith(
      setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2027-01", 0),
    );
  });

  it.each<{ label: string; lag: 1 | 2 }>([
    { label: "Im Folgemonat", lag: 1 },
    { label: "Im übernächsten Monat", lag: 2 },
  ])(
    "saves $label uniformly from the displayed payout across the year boundary",
    async ({ label, lag }) => {
      const screen = await mount();
      await fireEvent.press(
        screen.getByRole("button", {
          name: "Zulagen werden ausgezahlt auswählen: Im selben Monat",
        }),
      );
      await fireEvent.press(
        screen.getByRole("radio", { name: `Zulagen werden ausgezahlt: ${label}` }),
      );
      expect(mockSave).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
      expect(mockSave.mock.calls[0][0].periods).toEqual([
        {
          effectiveMonth: "2026-11",
          delays: {
            PREMIUMS: lag,
            MONTHLY_ALLOWANCE: lag,
            HOURLY_ALLOWANCE: lag,
            OVERTIME: lag,
            SPECIAL_DUTY: lag,
          },
        },
      ]);
    },
  );

  it("does not turn an explicit unknown imported period into a saved zero without a choice", async () => {
    const initial = setSalaryPaymentPeriod(DEFAULT_SALARY_PAYMENT_PREFERENCES, {
      effectiveMonth: "2026-01",
      delays: {
        PREMIUMS: null,
        MONTHLY_ALLOWANCE: null,
        HOURLY_ALLOWANCE: null,
        OVERTIME: null,
        SPECIAL_DUTY: null,
      },
    });
    const screen = await mount(initial);
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText("Bitte wähle den Auszahlungsmonat aus.")).toBeTruthy();
    expect(initial.periods[0].delays.PREMIUMS).toBeNull();
  });

  it("keeps the form and previous rules after a save conflict", async () => {
    const initial = setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2026-01", 1);
    mockSave.mockRejectedValueOnce(new Error("changed in another transaction"));
    const screen = await mount(initial);
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.getByText(/Nicht gespeichert/)).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
    expect(initial.periods[0].delays.PREMIUMS).toBe(1);
  });

  it("keeps repeated taps from submitting the same choice twice", async () => {
    let finish!: () => void;
    mockSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const screen = await mount();
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await fireEvent.press(screen.getByRole("button", { name: "Wird gespeichert" }));
    expect(mockSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });
});
