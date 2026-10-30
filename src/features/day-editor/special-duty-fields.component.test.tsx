import { useState } from "react";
import { fireEvent, render, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { ActionSheetIOS, Text } from "react-native";
import { newSpecialDuty, type SpecialDuty } from "@/domain/special-duty";
import type { DutyTariffFamily } from "@/engine/special-duty-tariff";
import { SpecialDutyFields } from "./special-duty-fields";

function Harness({
  initial = null,
  template = false,
  tariffFamily = null,
}: {
  readonly initial?: SpecialDuty | null;
  readonly template?: boolean;
  readonly tariffFamily?: DutyTariffFamily | null;
}) {
  const [value, setValue] = useState(initial);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [breakMinutes, setBreakMinutes] = useState("0");
  return (
    <>
      <SpecialDutyFields
        value={value}
        onChange={setValue}
        startTime={startTime}
        endTime={endTime}
        breakMinutes={breakMinutes}
        onStartChange={setStartTime}
        onEndChange={setEndTime}
        onBreakMinutesChange={setBreakMinutes}
        template={template}
        timeZone="Europe/Berlin"
        tariffFamily={tariffFamily}
      />
      <Text testID="draft">{JSON.stringify(value)}</Text>
    </>
  );
}

async function select(screen: Awaited<ReturnType<typeof render>>, field: string, option: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementation((options, callback) => {
      const index = options.options.indexOf(option);
      expect(index).toBeGreaterThanOrEqual(0);
      callback(index);
    });
  await fireEvent.press(screen.getByLabelText(field));
}

async function setPause(
  screen: Awaited<ReturnType<typeof render>>,
  title: string,
  minutes: number,
) {
  const block = within(screen.getByTestId(`duty-block-${title}`));
  await fireEvent.press(block.getByTestId(`duty-pause-${title}-row`));
  await fireEvent.press(block.getByRole("radio", { name: `${minutes} Minuten` }));
}

const split = {
  ...newSpecialDuty("SPLIT", "08:00", "10:00", "Europe/Berlin"),
  parts: [{ start: 17 * 60, end: 21 * 60, breakMinutes: 0 }],
};

describe("special duty editor", () => {
  it("retains the published versioned standby agreement through pause and form changes", async () => {
    const screen = await render(
      <Harness
        initial={newSpecialDuty("STANDBY", "08:00", "10:00", "Europe/Berlin")}
        tariffFamily="TVL_43"
      />,
    );
    await fireEvent.press(screen.getByText("Abrechnung"));
    jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((options, callback) => {
        const index = options.options.indexOf("Reguläre Bewertung");
        expect(index).toBeGreaterThanOrEqual(0);
        callback(index);
      });
    await fireEvent.press(screen.getByText("Bewertung laut Arbeitgeber"));
    const initialDraft = JSON.parse(screen.getByTestId("draft").props.children) as SpecialDuty;
    expect(initialDraft).toEqual(
      expect.objectContaining({
        version: 2,
        standbyAgreement: expect.objectContaining({ tariff: "TVL_43", rule: "STANDARD" }),
      }),
    );
    await setPause(screen, "Bereitschaftszeitraum", 15);
    await select(screen, "Dienstform: Bereitschaftsdienst", "Rufbereitschaft");
    await select(screen, "Dienstform: Rufbereitschaft", "Bereitschaftsdienst");
    expect(JSON.parse(screen.getByTestId("draft").props.children)).toEqual(initialDraft);
    expect(
      screen.getByRole("button", { name: "Bereitschaftszeitraum: Pause: 15 Minuten" }),
    ).toBeTruthy();
    expect(screen.getByText("Abrechnung")).toBeTruthy();
  });
  it("adds and removes a linked second part in the existing editor", async () => {
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByLabelText("Dienstteil hinzufügen"));
    expect(screen.getByText("Geteilter Dienst")).toBeTruthy();
    expect(screen.getByLabelText("Dienstteil 2 entfernen")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Dienstteil 2 entfernen"));
    expect(screen.queryByLabelText("Dienstteil 2 entfernen")).toBeNull();
  });
  it("adds an actual callout and keeps its completion separate", async () => {
    const screen = await render(
      <Harness initial={newSpecialDuty("ON_CALL", "06:00", "10:00", "Europe/Berlin")} />,
    );
    await fireEvent.press(screen.getByLabelText("Einsatz hinzufügen"));
    expect(screen.getByText("Telefonisch / von zu Hause")).toBeTruthy();
    expect(screen.getByText("Noch offen")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Einsatz 1 entfernen"));
    expect(screen.queryByLabelText("Einsatz 1 entfernen")).toBeNull();
  });

  it("groups the first and following parts with their own exact pauses and a correct total", async () => {
    const screen = await render(
      <Harness initial={{ ...split, parts: [{ ...split.parts[0], breakMinutes: 7 }] }} template />,
    );
    expect(screen.getByText("7 Std. Unterbrechung")).toBeTruthy();
    expect(screen.getByText("5 Std. 53 Min.")).toBeTruthy();
    await setPause(screen, "Dienstteil 1", 15);
    await setPause(screen, "Dienstteil 2", 7);
    expect(screen.getByText("5 Std. 38 Min.")).toBeTruthy();
    expect(screen.getByLabelText("Dienstteil 1: Beginn wählen")).toBeTruthy();
    expect(screen.getByLabelText("Dienstteil 2: Ende wählen")).toBeTruthy();
  });

  it("restores split parts and the first pause when switching back from on-call", async () => {
    const screen = await render(<Harness initial={split} />);
    await setPause(screen, "Dienstteil 1", 30);
    await select(screen, "Dienstform: Geteilter Dienst", "Rufbereitschaft");
    expect(screen.queryByTestId("duty-pause-Rufbereitschaftszeitraum-row")).toBeNull();
    await select(screen, "Dienstform: Rufbereitschaft", "Geteilter Dienst");
    expect(screen.getByRole("button", { name: "Dienstteil 1: Pause: 30 Minuten" })).toBeTruthy();
    expect(screen.getByLabelText("Dienstteil 2 entfernen")).toBeTruthy();
    expect(screen.getByText("5 Std. 30 Min.")).toBeTruthy();
  });

  it("retains actual calls and their completion state when switching forms", async () => {
    const screen = await render(
      <Harness initial={newSpecialDuty("ON_CALL", "08:00", "10:00", "Europe/Berlin")} />,
    );
    await fireEvent.press(screen.getByLabelText("Einsatz hinzufügen"));
    await select(screen, "Erfassung: Noch offen", "Alle Einsätze erfasst");
    await select(screen, "Dienstform: Rufbereitschaft", "Bereitschaftsdienst");
    await select(screen, "Dienstform: Bereitschaftsdienst", "Rufbereitschaft");
    expect(screen.getByLabelText("Einsatz 1 entfernen")).toBeTruthy();
    expect(screen.getByText("Alle Einsätze erfasst")).toBeTruthy();
    await select(screen, "Einsatz 1: Einsatzart: Telefonisch / von zu Hause", "Vor Ort");
    expect(screen.getByText("Noch offen")).toBeTruthy();
  });

  it("keeps template windows separate from actual callouts and retains all end-day choices", async () => {
    const screen = await render(
      <Harness initial={newSpecialDuty("ON_CALL", "08:00", "10:00", "Europe/Berlin")} template />,
    );
    expect(screen.queryByLabelText("Einsatz hinzufügen")).toBeNull();
    expect(screen.queryByText("Erfassung")).toBeNull();
    await select(screen, "Rufbereitschaftszeitraum: Ende am: Gleicher Tag", "14 Tage später");
    expect(screen.getByText("14 Tage später")).toBeTruthy();
  });

  it("shows overlap on the affected part and hides its misleading total", async () => {
    const screen = await render(
      <Harness initial={{ ...split, parts: [{ start: 540, end: 720, breakMinutes: 0 }] }} />,
    );
    expect(screen.getByText("Dienstteil 2 beginnt vor dem Ende von Dienstteil 1.")).toBeTruthy();
    expect(screen.queryByText("Erfasste Arbeitszeit")).toBeNull();
  });

  it("keeps explanations available behind the accessible disclosure", async () => {
    const screen = await render(<Harness initial={split} />);
    expect(screen.queryByText(/Die Dienstteile gehören zusammen/)).toBeNull();
    await fireEvent.press(screen.getByLabelText("Hinweise zur Arbeitszeit"));
    expect(screen.getByText(/Die Dienstteile gehören zusammen/)).toBeTruthy();
    expect(screen.getByLabelText("Hinweise zur Arbeitszeit")).toHaveProp("accessibilityState", {
      expanded: true,
    });
  });
});
