import { fireEvent, render, within } from "@testing-library/react-native";
import { describe, expect, it } from "@jest/globals";
import type { PropsWithChildren, ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { PremiumLine, ShiftPremiumBreakdown } from "@/domain/types";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { newSpecialDuty } from "@/domain/special-duty";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { NetPayServiceDetails } from "./net-pay-service-details";
import { netPayEuro } from "./net-pay-format";
import type { SalaryClassification } from "./salary-service-presentation";

type TaxLine = SalaryClassification["shifts"][number]["premiumBreakdown"][number];

function SafeAreaFixture({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 59, bottom: 34, left: 0, right: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

const renderServices = (element: ReactElement) => render(element, { wrapper: SafeAreaFixture });

function taxLine(category: TaxLine["category"], paid: number, free: number): TaxLine {
  return { category, paidPremiumCents: paid, taxFreeCents: free, taxablePremiumCents: paid - free };
}

function premium(key: string, amount: number): PremiumLine {
  return { key, label: key, amount, minutes: 60, percentage: 20, hourlyRate: 23.08 };
}

function fixture() {
  const shifts = [
    forecastShift({ id: "saturday", date: "2026-10-10" }),
    forecastShift({ id: "sunday", date: "2026-10-11" }),
    forecastShift({ id: "holiday", date: "2026-10-03" }),
  ];
  const basePay = calculateMonthlyPayEstimate("2026-10", shifts, forecastProfile, null);
  const forecast = calculateAutomaticNetPayForecast(
    {
      month: "2026-10",
      profile: forecastProfile,
      shifts,
      pay: basePay,
      settings: automatedSettings("2026-10"),
    },
    bundledRuleResolver,
  );
  if (forecast.result.status !== "available") throw new Error("Fixture classification unavailable");
  const lines = [
    [premium("night", 12.34), premium("saturday", 4.56)],
    [premium("night", 30), premium("sunday", 20)],
    [premium("holiday", 30)],
  ];
  const taxes = [
    [taxLine("NIGHT", 1234, 1000), taxLine("SATURDAY", 456, 0)],
    [taxLine("NIGHT", 3000, 2500), taxLine("SUNDAY", 2000, 1500)],
    [taxLine("HOLIDAY", 3000, 2700)],
  ];
  const shiftBreakdowns: ShiftPremiumBreakdown[] = shifts.map((shift, index) => ({
    shiftId: shift.id,
    date: shift.date,
    netMinutes: 450,
    premiumLines: lines[index],
    overtimeBaseAmount: 0,
    overtimePremiumAmount: 0,
    totalAmount: lines[index].reduce((sum, line) => sum + line.amount, 0),
  }));
  const classification: SalaryClassification = {
    ...forecast.result.classification,
    paidPremiumCents: 9690,
    taxFreeCents: 7700,
    socialInsuranceFreeCents: 7700,
    shifts: shifts.map((shift, index) => {
      const paid = taxes[index].reduce((sum, line) => sum + line.paidPremiumCents, 0);
      const free = taxes[index].reduce((sum, line) => sum + line.taxFreeCents, 0);
      return {
        shiftId: shift.id,
        workedMinutes: 450,
        nightMinutes: 300,
        dayMinutes: 150,
        paidPremiumCents: paid,
        taxFreeCents: free,
        socialInsuranceFreeCents: free,
        taxablePremiumCents: paid - free,
        socialInsuranceLiablePremiumCents: paid - free,
        premiumBreakdown: taxes[index],
      };
    }),
  };
  return { shifts, pay: { ...basePay, timePremiumAmount: 96.9, shiftBreakdowns }, classification };
}

describe("service premium filter summary", () => {
  it.each<[string, number, number, number]>([
    ["Nacht", 4234, 3500, 2],
    ["Samstag", 456, 0, 1],
    ["Sonntag", 2000, 1500, 1],
    ["Feiertag", 3000, 2700, 1],
  ])("shows only %s cash and tax shares, then restores All", async (label, paid, free, count) => {
    const data = fixture();
    const original = JSON.stringify(data);
    const screen = await renderServices(<NetPayServiceDetails {...data} />);
    const list = within(screen.getByTestId("net-pay-service-details"));
    expect(screen.getByLabelText("Zeitzuschläge: 96,90\u00a0€")).toBeTruthy();
    await fireEvent.press(list.getByRole("radio", { name: label }));
    expect(screen.getByLabelText(`Zeitzuschläge: ${netPayEuro(paid)}`)).toBeTruthy();
    expect(
      screen.getByText(
        `Steuerfrei ${netPayEuro(free)} · Steuerpflichtig ${netPayEuro(paid - free)}`,
      ),
    ).toBeTruthy();
    expect(list.getAllByRole("button")).toHaveLength(count);
    await fireEvent.press(list.getByRole("radio", { name: "Alle" }));
    expect(screen.getByLabelText("Zeitzuschläge: 96,90\u00a0€")).toBeTruthy();
    expect(screen.getByText("Steuerfrei 77,00\u00a0€ · Steuerpflichtig 19,90\u00a0€")).toBeTruthy();
    expect(list.getAllByRole("button")).toHaveLength(3);
    expect(JSON.stringify(data)).toBe(original);
  });

  it("filters without tax settings and falls back to All when the category disappears", async () => {
    const data = fixture();
    const screen = await renderServices(<NetPayServiceDetails {...data} classification={null} />);
    await fireEvent.press(screen.getByRole("radio", { name: "Sonntag" }));
    expect(screen.getByLabelText("Zeitzuschläge: 20,00\u00a0€")).toBeTruthy();
    expect(screen.getByText("Steuerliche Aufteilung noch nicht verfügbar.")).toBeTruthy();
    const pay = {
      ...data.pay,
      timePremiumAmount: 76.9,
      shiftBreakdowns: data.pay.shiftBreakdowns.map((row) => ({
        ...row,
        premiumLines: row.premiumLines.filter((line) => line.key !== "sunday"),
      })),
    };
    await screen.rerender(<NetPayServiceDetails {...data} pay={pay} classification={null} />);
    expect(screen.getByRole("radio", { name: "Alle" }).props.accessibilityState.checked).toBe(true);
    expect(screen.queryByRole("radio", { name: "Sonntag" })).toBeNull();
    expect(screen.getByLabelText("Zeitzuschläge: 76,90\u00a0€")).toBeTruthy();
    expect(screen.getByText("Steuerliche Aufteilung noch nicht verfügbar.")).toBeTruthy();
  });

  it("does not assign a combined holiday tax share to just one raw tariff key", async () => {
    const data = fixture();
    const pay = {
      ...data.pay,
      shiftBreakdowns: data.pay.shiftBreakdowns.map((row) => ({
        ...row,
        premiumLines: row.premiumLines.map((line) =>
          line.key === "night" ? { ...line, key: "preholiday" } : line,
        ),
      })),
    };
    const classification = {
      ...data.classification,
      shifts: data.classification.shifts.map((shift) => ({
        ...shift,
        premiumBreakdown: shift.premiumBreakdown.map((line) =>
          line.category === "NIGHT" ? { ...line, category: "HOLIDAY" as const } : line,
        ),
      })),
    };
    const screen = await renderServices(
      <NetPayServiceDetails {...data} pay={pay} classification={classification} />,
    );
    await fireEvent.press(screen.getByRole("radio", { name: "Vorfeiertag" }));
    expect(screen.getByLabelText("Zeitzuschläge: 42,34\u00a0€")).toBeTruthy();
    expect(screen.getByText("Steuerliche Aufteilung noch nicht verfügbar.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Alle" }));
    expect(screen.getByText("Steuerfrei 77,00\u00a0€ · Steuerpflichtig 19,90\u00a0€")).toBeTruthy();
  });

  it("sums multiple callout traces once under their original service", async () => {
    const shift = forecastShift({
      id: "callout-sunday",
      date: "2026-07-12",
      startTime: "20:00",
      endTime: "23:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "20:00", "23:00", "Europe/Berlin"),
        settlement: "PAY",
        calloutsComplete: true,
        callouts: [1320, 1340].map((start) => ({
          kind: "REMOTE" as const,
          start,
          end: start + 10,
          departure: start,
          returned: start + 10,
          breakMinutes: 0,
        })),
      },
    });
    const pay = calculateMonthlyPayEstimate("2026-07", [shift], forecastProfile, null);
    const forecast = calculateAutomaticNetPayForecast(
      {
        month: "2026-07",
        profile: forecastProfile,
        shifts: [shift],
        pay,
        settings: automatedSettings("2026-07"),
      },
      bundledRuleResolver,
    );
    if (forecast.result.status !== "available") throw new Error("Callout fixture unavailable");
    const classification = forecast.result.classification;
    const screen = await renderServices(
      <NetPayServiceDetails classification={classification} pay={pay} shifts={[shift]} />,
    );
    const list = within(screen.getByTestId("net-pay-service-details"));
    expect(classification.shifts.length).toBeGreaterThan(1);
    for (const [label, category] of [
      ["Nacht", "NIGHT"],
      ["Sonntag", "SUNDAY"],
    ] as const) {
      const lines = classification.shifts
        .flatMap((item) => item.premiumBreakdown)
        .filter((line) => line.category === category);
      const paid = lines.reduce((sum, line) => sum + line.paidPremiumCents, 0);
      const free = lines.reduce((sum, line) => sum + line.taxFreeCents, 0);
      expect(paid).toBeGreaterThan(0);
      expect(paid).toBeLessThan(classification.paidPremiumCents);
      await fireEvent.press(list.getByRole("radio", { name: label }));
      expect(screen.getByLabelText(`Zeitzuschläge: ${netPayEuro(paid)}`)).toBeTruthy();
      expect(
        screen.getByText(
          `Steuerfrei ${netPayEuro(free)} · Steuerpflichtig ${netPayEuro(paid - free)}`,
        ),
      ).toBeTruthy();
      expect(list.getAllByRole("button")).toHaveLength(1);
      expect(list.getByRole("button", { name: `So. 12.07.: ${netPayEuro(paid)}` })).toBeTruthy();
    }
    await fireEvent.press(list.getByRole("radio", { name: "Alle" }));
    expect(
      screen.getByLabelText(`Zeitzuschläge: ${netPayEuro(classification.paidPremiumCents)}`),
    ).toBeTruthy();
    expect(list.getAllByRole("button")).toHaveLength(1);
  });
});
