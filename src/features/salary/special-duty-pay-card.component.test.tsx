import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { SpecialDutyPayCard } from "./special-duty-pay-card";
import type { SpecialDutyPayLine } from "@/domain/special-duty-pay";

const line: SpecialDutyPayLine = {
  shiftId: "one",
  date: "2026-07-07",
  title: "Rufbereitschaft",
  durationMinutes: 720,
  source: "§ 8 Abs. 3 TVöD AT",
  paidHours: 2,
  hourlyCents: 2403,
  baseAmountCents: 4806,
  complete: true,
  notes: [],
};
describe("special duty pay details", () => {
  it("opens the selected duty without treating its missing amount as zero", async () => {
    const onOpenDuty = jest.fn<(duty: SpecialDutyPayLine) => void>();
    const openLine = {
      ...line,
      baseAmountCents: null,
      complete: false,
      notes: ["Angaben fehlen."],
    };
    const view = await render(<SpecialDutyPayCard lines={[openLine]} onOpenDuty={onOpenDuty} />);
    await fireEvent.press(
      view.getByRole("button", { name: "Dienst öffnen: 07.07. · Rufbereitschaft" }),
    );
    expect(onOpenDuty).toHaveBeenCalledWith(openLine);
    expect(view.getByText("Betrag noch offen")).toBeTruthy();
    expect(view.queryByText(/0,00/)).toBeNull();
  });
  it("uses the singular for a one-hour flat-rate basis", async () => {
    const view = await render(<SpecialDutyPayCard lines={[{ ...line, paidHours: 1 }]} />);
    expect(view.getByText(/1 Stunde × 24,03/)).toBeTruthy();
    expect(view.queryByText(/1 Stunden/)).toBeNull();
  });
  it("shows standby leave separately from cash and never labels it an on-call flat rate", async () => {
    const view = await render(
      <SpecialDutyPayCard
        lines={[
          {
            ...line,
            title: "Bereitschaftsdienst",
            baseAmountCents: 0,
            standbyPay: {
              actualMinutes: 480,
              weightedMinutes: 288,
              factorBasisPoints: 6000,
              hourlyCents: 2329,
              payGroup: "P8",
              baseAmountCents: 11179,
              overtimePremiumCents: 0,
              nightPremiumCents: 0,
              holidayPremiumCents: 0,
              sundayPremiumCents: 0,
              cashAmountCents: 0,
              timeCreditMinutes: 296,
              mandatoryRestMinutes: 0,
              notes: [],
            },
          },
        ]}
      />,
    );
    expect(view.getByText(/Auszahlung Bereitschaftsdienst: 0,00/)).toBeTruthy();
    expect(view.getByText(/Geleistet: 480 Min.*Vergütung: 288 Min/)).toBeTruthy();
    expect(
      view.getByText(/Geplante Zeitgutschrift: 296 Min.*Als Prognose aus deiner Abgeltung/),
    ).toBeTruthy();
    expect(view.queryByText(/Rufbereitschaftspauschale/)).toBeNull();
  });
  it("separates worked minutes from paid rounding and overtime remuneration", async () => {
    const view = await render(
      <SpecialDutyPayCard
        lines={[
          {
            ...line,
            calloutPay: {
              actualMinutes: 25,
              paidMinutes: 60,
              baseAmountCents: 2403,
              overtimePremiumCents: 650,
              rates: { baseHourlyCents: 2403, premiumHourlyCents: 2167, premiumBasisPoints: 3000 },
              notes: [],
            },
          },
        ]}
      />,
    );
    expect(view.getByText(/Einsatzentgelt: 24,03.*6,50.*Überstundenzuschlag/)).toBeTruthy();
    expect(view.getByText(/Tatsächlich: 25 Min.*Tariflich bewertet: 60 Min/)).toBeTruthy();
    expect(view.getByText(/Rundung verändert die erfasste Arbeitszeit nicht/)).toBeTruthy();
  });
  it("shows the calculated flat rate and its basis separately from working time", async () => {
    const view = await render(<SpecialDutyPayCard lines={[line]} />);
    expect(view.getByText(/Rufbereitschaftspauschale: 48,06/)).toBeTruthy();
    expect(view.getByText(/2 Stunden × 24,03/)).toBeTruthy();
    expect(view.getByText(/erhöht die Arbeitszeit nicht/)).toBeTruthy();
  });
  it("never displays an unknown amount as zero or a partial amount as complete", async () => {
    const view = await render(
      <SpecialDutyPayCard
        lines={[
          {
            ...line,
            shiftId: "unknown",
            baseAmountCents: null,
            complete: false,
            notes: ["Tabellenzuordnung fehlt."],
          },
          { ...line, complete: false, notes: ["Einsatzvergütung noch offen."] },
        ]}
      />,
    );
    expect(view.getByText("Betrag noch offen")).toBeTruthy();
    expect(view.getByText("Einsatzvergütung noch offen.")).toBeTruthy();
    expect(view.queryByText(/Pauschale berechnet/)).toBeNull();
    expect(view.queryByText(/0,00/)).toBeNull();
  });
});
