import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { selectNativeNetPayOption } from "@/testing/net-pay-menu-test-helpers";
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
      const picker = screen.getByTestId("net-pay-native-options:Hast du Kinder?");
      await fireEvent(picker, "selectionChange", { nativeEvent: { selection: null } });
      expect(onChange).not.toHaveBeenCalled();
      expect(await selectNativeNetPayOption(screen, "Hast du Kinder?", value ? "Ja" : "Nein")).toBe(
        true,
      );
      expect(onChange).toHaveBeenCalledWith(value);
      expect(screen.queryByRole("radio")).toBeNull();
    },
  );

  it("does not open a native selection while saving", async () => {
    const onChange = jest.fn();
    const screen = await render(
      <NetPaySettingChoice
        compact
        disabled
        label="Steuerklasse"
        value={1}
        options={[{ value: 1, label: "1" }]}
        onChange={onChange}
      />,
    );
    expect(await selectNativeNetPayOption(screen, "Steuerklasse", "1")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
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
      fireEvent(screen.getByTestId("net-pay-native-birth-date"), "dateChange", {
        nativeEvent: { date: new Date(1988, 3, 20, 12).toISOString() },
      });
    await open();
    await choose();
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId("net-pay-date-cancel"), "buttonPress");
    await waitFor(() =>
      expect(screen.getByTestId("net-pay-native-date-sheet")).toHaveProp("isPresented", false),
    );
    expect(onChange).not.toHaveBeenCalled();
    await open();
    await choose();
    await fireEvent(screen.getByTestId("net-pay-date-confirm"), "buttonPress");
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
    await fireEvent(screen.getByTestId("net-pay-date-cancel"), "buttonPress");
    await waitFor(() =>
      expect(screen.getByTestId("net-pay-native-date-sheet")).toHaveProp("isPresented", false),
    );
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
