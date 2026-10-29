import { render } from "@testing-library/react-native";
import { describe, expect, it } from "@jest/globals";
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
