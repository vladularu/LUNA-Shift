import { useState } from "react";
import { ActionSheetIOS } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { newSpecialDuty, type SpecialDuty } from "@/domain/special-duty";
import { StandbyAgreementFields } from "./standby-agreement-fields";

afterEach(() => {
  jest.restoreAllMocks();
});
describe("standby agreement editor", () => {
  it.each([
    { tariff: "TVOED_B", label: "TVöD Pflege/Betreuung" },
    { tariff: "TVL_43", label: "TV-L Pflege" },
    { tariff: "TVH_43", label: "TV-H Pflege" },
  ] as const)(
    "uses the known $tariff profile and retains all employer choices",
    async ({ tariff, label }) => {
      const changed = jest.fn();
      const view = await render(
        <StandbyAgreementFields
          value={newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin")}
          tariffFamily={tariff}
          template
          onChange={changed}
        />,
      );
      await fireEvent.press(view.getByText("Abrechnung"));
      expect(view.getByText(`Tarif aus deinem Profil: ${label}`)).toBeTruthy();
      expect(view.queryByText("Tarifbereich der Bereitschaft")).toBeNull();
      expect(view.getByText("Bewertung laut Arbeitgeber")).toBeTruthy();
      expect(view.getByText("Bereitschaftsgruppe laut Arbeitgeber")).toBeTruthy();
      expect(view.getByText("Stundenentgelt")).toBeTruthy();
      expect(changed).not.toHaveBeenCalled();
    },
  );
  it("keeps detail fields collapsed and requires deliberate employer facts", async () => {
    const changed = jest.fn<(next: SpecialDuty) => void>();
    function Harness() {
      const [value, setValue] = useState(
        newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin"),
      );
      return (
        <StandbyAgreementFields
          value={value}
          tariffFamily="TVL_43"
          template={false}
          onChange={(next) => {
            setValue(next);
            changed(next);
          }}
        />
      );
    }
    const view = await render(<Harness />);
    expect(view.queryByText("Bewertung laut Arbeitgeber")).toBeNull();
    await fireEvent.press(view.getByText("Abrechnung"));
    expect(view.getByText("Bewertung laut Arbeitgeber")).toBeTruthy();
    expect(changed).not.toHaveBeenCalled();
    jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((options, callback) =>
        callback(options.options.indexOf("Reguläre Bewertung")),
      );
    await fireEvent.press(view.getByText("Bewertung laut Arbeitgeber"));
    await fireEvent.changeText(view.getByLabelText("Nummer der Bereitschaft im Monat"), "9");
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        version: 2,
        standbyAgreement: expect.objectContaining({
          tariff: "TVL_43",
          rule: "STANDARD",
          sequence: 9,
          payGroup: null,
        }),
      }),
    );
    await fireEvent.press(view.getByText("Stundenentgelt"));
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        standbyAgreement: expect.objectContaining({ rateMode: "AGREED", hourlyCents: null }),
      }),
    );
    await fireEvent.changeText(view.getByLabelText("Stundenentgelt vor Bewertung (€)"), "23,50");
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ standbyAgreement: expect.objectContaining({ hourlyCents: 2350 }) }),
    );
  });
  it("does not ask a template for an actual monthly ordinal", async () => {
    const view = await render(
      <StandbyAgreementFields
        value={newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin")}
        tariffFamily="TVL_43"
        template
        onChange={() => {}}
      />,
    );
    await fireEvent.press(view.getByText("Abrechnung"));
    expect(view.queryByLabelText("Nummer der Bereitschaft im Monat")).toBeNull();
    expect(view.getByText("Die Monatsnummer ergänzt du später im Kalendereintrag.")).toBeTruthy();
  });
});
