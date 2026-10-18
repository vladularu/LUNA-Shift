import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { AnnualSalaryPaymentEditor } from "./annual-salary-payment-editor";

jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual<typeof import("react-native-safe-area-context")>(
    "react-native-safe-area-context",
  ),
  SafeAreaProvider: ({ children }: import("react").PropsWithChildren) => children,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
const payment = {
  revision: 1,
  payoutMonth: "2026-11",
  grossCents: 360_000,
  netBasis: { kind: "CONSTANT_PAY" as const },
};
const save = () =>
  jest.fn<(value: MonthlyNetPaySettings) => Promise<void>>().mockResolvedValue(undefined);

describe("compact automatic annual payment", () => {
  it.each([
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-12",
  ])("hides November payments in %s, including saved overrides", async (month) => {
    const initial = automatedSettings(month);
    const onSave = save();
    const screen = await render(
      <AnnualSalaryPaymentEditor
        month={month}
        profile={forecastProfile}
        settings={{ ...initial, automation: { ...initial.automation!, annualPayments: [payment] } }}
        forecastPayments={[payment]}
        busy={false}
        onSave={onSave}
      />,
    );
    expect(screen.toJSON()).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("shows a shifted payment only in its own cash month", async () => {
    const shifted = { ...payment, payoutMonth: "2026-12" };
    const initial = automatedSettings("2026-11");
    const settings = {
      ...initial,
      automation: {
        ...initial.automation!,
        annualPayments: [{ ...payment, revision: 2, grossCents: 0 }, shifted],
      },
    };
    const onSave = save();
    const screen = await render(
      <AnnualSalaryPaymentEditor
        month="2026-11"
        profile={forecastProfile}
        settings={settings}
        busy={false}
        onSave={onSave}
      />,
    );
    expect(screen.toJSON()).toBeNull();
    await screen.rerender(
      <AnnualSalaryPaymentEditor
        month="2026-12"
        profile={forecastProfile}
        settings={settings}
        busy={false}
        onSave={onSave}
      />,
    );
    expect(screen.getByText("Weihnachtsgeld")).toBeTruthy();
    expect(screen.getByText("Eigener Betrag · Dezember 2026")).toBeTruthy();
  });
  it("moves a saved payment and cancels the original cash month with a newer revision", async () => {
    const onSave = save();
    const initial = automatedSettings("2026-11");
    const screen = await render(
      <AnnualSalaryPaymentEditor
        month="2026-11"
        profile={forecastProfile}
        settings={{ ...initial, automation: { ...initial.automation!, annualPayments: [payment] } }}
        busy={false}
        onSave={onSave}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Anpassen,/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben" }));
    await fireEvent.press(screen.getByRole("button", { name: /^Auszahlungsmonat auswählen/ }));
    await fireEvent.press(screen.getByRole("radio", { name: "Auszahlungsmonat: Dezember 2026" }));
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: expect.objectContaining({
          annualPayments: [
            { ...payment, revision: 2, grossCents: 0 },
            { ...payment, payoutMonth: "2026-12" },
          ],
        }),
      }),
    );
  });
  it("shows the automatic amount without an editor, proposal button, save or checkbox", async () => {
    const onSave = save();
    const screen = await render(
      <AnnualSalaryPaymentEditor
        month="2026-11"
        profile={forecastProfile}
        settings={automatedSettings("2026-11")}
        busy={false}
        onSave={onSave}
        forecastPayments={[payment]}
        automatic
      />,
    );
    expect(screen.getByText("3.600,00 €")).toBeTruthy();
    expect(screen.getByText("Automatisch nach Tarif · November 2026")).toBeTruthy();
    expect(screen.queryByLabelText("Weihnachtsgeld brutto (€)")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("Tarifvorschlag berechnen")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: /^Anpassen,/ }));
    expect(screen.getByLabelText("Weihnachtsgeld brutto (€)").props.value).toBe("3600");
    expect(screen.queryByRole("checkbox")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Weihnachtsgeld brutto (€)"), "3500");
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: expect.objectContaining({
          annualPayments: [{ ...payment, grossCents: 350_000 }],
        }),
      }),
    );
  });
  it("does not silently turn a missing amount into zero for own contracts", async () => {
    const onSave = save();
    const screen = await render(
      <AnnualSalaryPaymentEditor
        month="2026-11"
        profile={forecastProfile}
        settings={automatedSettings("2026-11")}
        busy={false}
        onSave={onSave}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Betrag ergänzen,/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Bitte einen Bruttobetrag/)).toBeTruthy();
  });
  it("keeps other instalments and saves zero as an explicit cancellation", async () => {
    const initial = automatedSettings("2026-11");
    const payments = [payment, { ...payment, payoutMonth: "2027-06", grossCents: 200_000 }];
    const onSave = save();
    const screen = await render(
      <AnnualSalaryPaymentEditor
        month="2026-11"
        profile={forecastProfile}
        settings={{ ...initial, automation: { ...initial.automation!, annualPayments: payments } }}
        busy={false}
        onSave={onSave}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Anpassen,/ }));
    await fireEvent.changeText(screen.getByLabelText("Weihnachtsgeld brutto (€)"), "0");
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: expect.objectContaining({
          annualPayments: expect.arrayContaining([
            expect.objectContaining({ payoutMonth: "2026-11", revision: 2, grossCents: 0 }),
            expect.objectContaining({ payoutMonth: "2027-06", grossCents: 200_000 }),
          ]),
        }),
      }),
    );
  });
  it("cancels edits without saving and opens with the original automatic amount again", async () => {
    const onSave = save();
    const screen = await render(
      <AnnualSalaryPaymentEditor
        month="2026-11"
        profile={forecastProfile}
        settings={automatedSettings("2026-11")}
        busy={false}
        onSave={onSave}
        forecastPayments={[payment]}
        automatic
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Anpassen,/ }));
    await fireEvent.changeText(screen.getByLabelText("Weihnachtsgeld brutto (€)"), "1");
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
    await fireEvent.press(screen.getByRole("button", { name: /^Anpassen,/ }));
    expect(screen.getByLabelText("Weihnachtsgeld brutto (€)").props.value).toBe("3600");
    expect(onSave).not.toHaveBeenCalled();
  });
});
