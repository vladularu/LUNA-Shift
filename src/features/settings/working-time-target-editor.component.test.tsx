import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { View as MockView, Text as MockText, Pressable as MockPressable } from "react-native";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import { work } from "@/engine/remuneration-test-fixtures";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import type {
  TargetDayFact,
  TargetProfilePeriod,
  WorkingTimeTargetContext,
} from "@/domain/working-time-target";
import { TargetDayForm, TargetPeriodForm } from "./working-time-target-editor";

const mockPalette = LIGHT_PALETTE;
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
jest.mock("./profile-selection", () => ({
  ProfileChoice: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => {
    return (
      <MockView>
        <MockText>{`${label}: ${value}`}</MockText>
        {options.map((option) => (
          <MockPressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${option.label}`}
            onPress={() => onChange(option.value)}
          >
            <MockText>{option.label}</MockText>
          </MockPressable>
        ))}
      </MockView>
    );
  },
}));
const savePeriod =
  jest.fn<
    (
      value: TargetProfilePeriod,
      employment: WorkingTimeTargetContext["employment"],
    ) => Promise<void>
  >();
const saveDay = jest.fn<(value: TargetDayFact) => Promise<void>>();
const dirty = jest.fn();

describe("dated target input forms", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    savePeriod.mockResolvedValue(undefined);
    saveDay.mockResolvedValue(undefined);
  });
  it("does not label an imported unreviewed tariff version as legally verified", async () => {
    const initial: TargetProfilePeriod = {
      ...decemberTargetContext.periods[0],
      tariff: { kind: "TVOED_K", version: "2027-01-01", scopeConfirmed: true },
    };
    const screen = await render(
      <TargetPeriodForm
        initial={initial}
        profile={work}
        busy={false}
        onDirty={dirty}
        onSave={savePeriod}
      />,
    );
    expect(
      screen.getByText(/Tariffassung 2027-01-01 ist für die Sollzeit noch nicht geprüft/),
    ).toBeTruthy();
    expect(screen.queryByText(/^Geprüfte Tarifregel/)).toBeNull();
    await fireEvent.press(screen.getByText("Zeitraum speichern"));
    expect(savePeriod).toHaveBeenCalledWith(initial, undefined);
  });
  it("never activates BT-K or a rotating model from the salary profile", async () => {
    const screen = await render(
      <TargetPeriodForm profile={work} busy={false} onDirty={dirty} onSave={savePeriod} />,
    );
    expect(savePeriod).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Gültig ab (JJJJ-MM-TT)").props.value).toBe("");
    await fireEvent.changeText(screen.getByLabelText("Gültig ab (JJJJ-MM-TT)"), "2026-12-01");
    await fireEvent.press(screen.getByText("Zeitraum speichern"));
    expect(savePeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        validFrom: "2026-12-01",
        weeklyMinutes: 2310,
        model: { kind: "UNKNOWN" },
        tariff: { kind: "UNVERIFIED", id: "UNCONFIRMED" },
      }),
      undefined,
    );
  });
  it("requires an explicit monthly basis separately from seven-day operation and tariff scope", async () => {
    const screen = await render(
      <TargetPeriodForm profile={work} busy={false} onDirty={dirty} onSave={savePeriod} />,
    );
    await fireEvent.changeText(screen.getByLabelText("Gültig ab (JJJJ-MM-TT)"), "2026-12-01");
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Verteilung der Arbeitszeit: Wechselnde 5 Tage im 7-Tage-Betrieb",
      }),
    );
    await fireEvent.press(screen.getByText("Zeitraum speichern"));
    expect(savePeriod).not.toHaveBeenCalled();
    expect(screen.getByText(/Bitte die betriebliche Monatsbasis klären/)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Betriebliche Monatsbasis: Bestätigt: Mo–Fr × 1/5 der Wochenzeit",
      }),
    );
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Dienstplan umfasst alle sieben Wochentage: Ja, bestätigt",
      }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Tarifliche Arbeitszeitregel: TVöD-K / BT-K" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "BT-K gilt für mein Arbeitsverhältnis: Ja, bestätigt" }),
    );
    await fireEvent.press(screen.getByText("Zeitraum speichern"));
    expect(savePeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          kind: "ROTATING_FIVE_IN_SEVEN",
          monthlyReference: "WEEKDAYS_ONE_FIFTH",
          sevenDayShiftPlanConfirmed: true,
        },
        tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true },
      }),
      undefined,
    );
  });
  it("only fills a fixed Monday-Friday distribution after the user chooses it", async () => {
    const screen = await render(
      <TargetPeriodForm profile={work} busy={false} onDirty={dirty} onSave={savePeriod} />,
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Verteilung der Arbeitszeit: Feste Wochentage" }),
    );
    expect(screen.getByLabelText("Montag (Std:Min)").props.value).toBe("0:00");
    await fireEvent.changeText(screen.getByLabelText("Gültig ab (JJJJ-MM-TT)"), "2026-12-01");
    await fireEvent.press(screen.getByText("Gleichmäßig auf Mo–Fr verteilen"));
    expect(screen.getByLabelText("Montag (Std:Min)").props.value).toBe("7:42");
    expect(screen.getByLabelText("Samstag (Std:Min)").props.value).toBe("0:00");
    await fireEvent.press(screen.getByText("Zeitraum speichern"));
    expect(savePeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { kind: "FIXED_WEEK", weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] },
      }),
      undefined,
    );
  });
  it("does not turn an unknown loss of work into one fifth of the weekly time", async () => {
    const screen = await render(<TargetDayForm busy={false} onDirty={dirty} onSave={saveDay} />);
    await fireEvent.changeText(screen.getByLabelText("Datum des Dienstplantags"), "2026-12-24");
    await fireEvent.press(
      screen.getByRole("button", { name: "Dienstplanstatus: Endgültig bestätigt" }),
    );
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Situation laut Dienstplan: Wegen Feiertag / Sondertag freigestellt",
      }),
    );
    await fireEvent.press(screen.getByText("Tag bestätigen und speichern"));
    expect(saveDay).toHaveBeenCalledWith({
      date: "2026-12-24",
      rosterStatus: "FINAL",
      disposition: "RELEASED",
      lostMinutes: null,
      mustWorkElsewhere: null,
    });
  });
  it("preserves an explicit zero and an unknown must-work-elsewhere condition", async () => {
    const screen = await render(<TargetDayForm busy={false} onDirty={dirty} onSave={saveDay} />);
    await fireEvent.changeText(screen.getByLabelText("Datum des Dienstplantags"), "2026-12-26");
    await fireEvent.press(
      screen.getByRole("button", { name: "Situation laut Dienstplan: Dienstplanmäßig frei" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Bestätigte ausgefallene Arbeitszeit (Std:Min)"),
      "0:00",
    );
    await fireEvent.press(screen.getByText("Tag vorläufig speichern"));
    expect(saveDay).toHaveBeenCalledWith(
      expect.objectContaining({ lostMinutes: 0, mustWorkElsewhere: null, rosterStatus: "DRAFT" }),
    );
  });
  it("keeps an explicitly denied tariff scope when correcting an existing period", async () => {
    const initial: TargetProfilePeriod = {
      ...decemberTargetContext.periods[0],
      tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: false },
    };
    const screen = await render(
      <TargetPeriodForm
        initial={initial}
        profile={work}
        busy={false}
        onDirty={dirty}
        onSave={savePeriod}
      />,
    );
    expect(screen.getByLabelText("Gültig ab (JJJJ-MM-TT)").props.editable).toBe(false);
    await fireEvent.press(screen.getByText("Zeitraum speichern"));
    expect(savePeriod).toHaveBeenCalledWith(initial, undefined);
  });
});
