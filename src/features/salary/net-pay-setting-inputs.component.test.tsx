import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { ActionSheetIOS, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NetPaySettingChoice } from "./net-pay-setting-rows";
import { NetPaySettingDate } from "./net-pay-setting-date";
import { NetPayWorkflowSelect } from "./net-pay-workflow-controls";

const metrics = {
  frame: { height: 852, width: 393, x: 0, y: 0 },
  insets: { top: 59, bottom: 34, left: 0, right: 0 },
};

describe("net pay native settings interactions", () => {
  it.each([false, true])(
    "keeps boolean %s typed through a native selection and ignores cancel",
    async (value) => {
      const onChange = jest.fn<(value: boolean) => void>();
      const native = jest
        .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
        .mockImplementation(() => {});
      const screen = await render(
        <NetPaySettingChoice
          compact
          label="Hast du Kinder?"
          value={true}
          options={[
            { value: true, label: "Ja" },
            { value: false, label: "Nein" },
          ]}
          onChange={onChange}
        />,
      );
      await fireEvent.press(screen.getByRole("button", { name: "Hast du Kinder? auswählen: Ja" }));
      const [config, choose] = native.mock.calls[0];
      expect(config.message).toBe("Aktuell: Ja");
      await act(() => choose(config.cancelButtonIndex!));
      expect(onChange).not.toHaveBeenCalled();
      await act(() => choose(value ? 0 : 1));
      expect(onChange).toHaveBeenCalledWith(value);
      expect(screen.queryByRole("radio")).toBeNull();
    },
  );

  it("does not open a native selection while saving", async () => {
    const native = jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => {});
    const screen = await render(
      <NetPaySettingChoice
        compact
        disabled
        label="Steuerklasse"
        value={1}
        options={[{ value: 1, label: "1" }]}
        onChange={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Steuerklasse auswählen: 1" }));
    expect(native).not.toHaveBeenCalled();
  });

  it("shows searchable choices in a modal and closes after selecting the filtered value", async () => {
    const onChange = jest.fn<(value: string) => void>();
    const screen = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <NetPayWorkflowSelect
          compact
          searchable
          label="Zusatzversorgung"
          value="NONE"
          options={[
            { value: "NONE", label: "Keine" },
            { value: "VBL_WEST", label: "VBL West" },
            { value: "EZVK", label: "EZVK Darmstadt" },
          ]}
          onChange={onChange}
        />
      </SafeAreaProvider>,
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Zusatzversorgung auswählen: Keine" }),
    );
    expect(screen.getByTestId("dropdown-modal-content")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Zusatzversorgung suchen"), "darmstadt");
    expect(screen.queryByRole("radio", { name: "Zusatzversorgung: VBL West" })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Zusatzversorgung: EZVK Darmstadt" }));
    expect(onChange).toHaveBeenCalledWith("EZVK");
    await waitFor(() => expect(screen.queryByTestId("dropdown-modal-content")).toBeNull());
  });

  it("discards a calendar draft on cancel and commits only the chosen local calendar date", async () => {
    const onChange = jest.fn<(value: string) => void>();
    const screen = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <NetPaySettingDate
          compact
          value="15.01.1990"
          month="2026-07"
          disabled={false}
          onChange={onChange}
        />
      </SafeAreaProvider>,
    );
    const open = async () =>
      fireEvent.press(screen.getByRole("button", { name: "Geburtsdatum auswählen: 15.01.1990" }));
    const choose = async () =>
      fireEvent(screen.getByLabelText("Geburtsdatum im Kalender"), "change", {
        nativeEvent: { timestamp: new Date(1988, 3, 20, 12).getTime(), utcOffset: 120 },
      });
    await open();
    await choose();
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByLabelText("Geburtsdatum im Kalender")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    await open();
    await choose();
    await fireEvent.press(screen.getByRole("button", { name: "Datum übernehmen" }));
    expect(onChange).toHaveBeenCalledWith("20.04.1988");
  });

  it("keeps an empty birth date empty when opening and cancelling its calendar", async () => {
    const onChange = jest.fn<(value: string) => void>();
    const screen = await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <NetPaySettingDate compact value="" month="2026-07" disabled={false} onChange={onChange} />
      </SafeAreaProvider>,
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Geburtsdatum auswählen: Noch nicht angegeben" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByLabelText("Geburtsdatum im Kalender")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("retains manual entry for the web fallback", async () => {
    const platform = jest.replaceProperty(Platform, "OS", "web");
    try {
      const onChange = jest.fn<(value: string) => void>();
      const screen = await render(
        <NetPaySettingDate
          compact
          value="15.01.1990"
          month="2026-07"
          disabled={false}
          onChange={onChange}
        />,
      );
      await fireEvent.changeText(screen.getByLabelText("Geburtsdatum (TT.MM.JJJJ)"), "31.02.1990");
      expect(onChange).toHaveBeenCalledWith("31.02.1990");
    } finally {
      platform.restore();
    }
  });
});
