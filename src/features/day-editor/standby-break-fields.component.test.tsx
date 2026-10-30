import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { newSpecialDuty, type SpecialDuty } from "@/domain/special-duty";
import { StandbyBreakFields } from "./standby-break-fields";

describe("standby break fields", () => {
  it("does not save a guessed position when opening; stores only the confirmed start", async () => {
    const changed = jest.fn<(next: SpecialDuty) => void>();
    const view = await render(
      <StandbyBreakFields
        value={newSpecialDuty("STANDBY", "20:00", "08:00", "Europe/Berlin")}
        startTime="20:00"
        endTime="08:00"
        breakMinutes={30}
        onChange={changed}
      />,
    );
    await fireEvent.press(view.getByLabelText("Pausenbeginn: Noch offen"));
    expect(changed).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText("Pausenbeginn übernehmen: 20:00"));
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 3, breakStart: 1200, standbyAgreement: null }),
    );
  });
  it("keeps the accepted daytime editor compact", async () => {
    const view = await render(
      <StandbyBreakFields
        value={newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin")}
        startTime="08:00"
        endTime="16:00"
        breakMinutes={30}
        onChange={() => {}}
      />,
    );
    expect(view.queryByText("Pausenbeginn")).toBeNull();
  });
});
