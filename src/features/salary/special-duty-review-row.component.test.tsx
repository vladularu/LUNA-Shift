import { useState } from "react";
import { Pressable, Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import type { SpecialDutyReview } from "@/domain/special-duty-review";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import type { SaveShiftInput, ShiftEntry } from "@/domain/types";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { useEntryEditorDraft } from "@/features/day-editor/use-entry-editor-draft";
import { useStandbyBillingReview } from "@/features/day-editor/use-standby-billing-review";
import { PayListCard } from "@/features/analysis/dashboard-cards";
import { StandbyAgreementFields } from "@/features/day-editor/standby-agreement-fields";
import { StandbyBillingTransferFields } from "@/features/day-editor/standby-billing-transfer-fields";
import { SpecialDutyReviewRow } from "./special-duty-review-row";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/ui/selection-sheet", () => ({
  SelectionSheet: ({
    visible,
    children,
    onClose,
  }: {
    visible: boolean;
    children: (close: () => void) => React.ReactNode;
    onClose: () => void;
  }) => (visible ? children(onClose) : null),
}));

const first: SpecialDutyReview = {
  shiftId: "first",
  date: "2026-07-07",
  title: "Bereitschaft",
  message: "Abrechnung prüfen",
};
const second = { ...first, shiftId: "second", date: "2026-07-10", title: "Zweiter Dienst" };

describe("compact LUNA special-duty recovery", () => {
  it("saves the corrected editor and explicitly selected duties in one batch", async () => {
    const profile = {
      ...forecastProfile,
      tariff: null,
      tvlKrTariff: {
        payGroup: "KR8" as const,
        payLevel: 4 as const,
        universityRegion: "WEST" as const,
      },
    };
    const old = {
      ...newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
      version: 2 as const,
      standbyLevel: "II" as const,
      settlement: "PAY" as const,
      standbyAgreement: {
        ...newStandbyAgreement("TVOED_K"),
        rule: "STANDARD" as const,
        sequence: 1,
      },
    };
    const corrected = {
      ...old,
      standbyLevel: "B" as const,
      standbyAgreement: {
        ...newStandbyAgreement("TVL_43"),
        rule: "STANDARD" as const,
        sequence: 1,
        payGroup: "KR_VII",
      },
    };
    const original = forecastShift({
      id: "original",
      date: "2026-07-07",
      type: "CUSTOM",
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 0,
      specialDuty: old,
    });
    const target = {
      ...original,
      id: "target",
      date: "2026-07-10",
      title: "Ausgewählter Dienst",
      specialDuty: { ...old, standbyAgreement: { ...old.standbyAgreement, sequence: 3 } },
    };
    const batch = jest
      .fn<(inputs: readonly SaveShiftInput[]) => Promise<readonly ShiftEntry[]>>()
      .mockResolvedValue([original, target]);
    const single = jest
      .fn<(input: SaveShiftInput) => Promise<ShiftEntry>>()
      .mockResolvedValue(original);
    function Harness() {
      const draft = useEntryEditorDraft(original, null, "SHIFT");
      const review = useStandbyBillingReview({
        original,
        draft,
        date: original.date,
        save: { upsertShift: single, upsertShifts: batch },
        entries: [original, target],
        profile,
        resolver: bundledRuleResolver,
        focused: true,
      });
      return (
        <>
          {review.fields}
          <Pressable onPress={() => draft.specialDuty[1](corrected)}>
            <Text>Grundlage korrigieren</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              review.saveShift({
                ...original,
                expectedRevision: original.revision,
                specialDuty: draft.specialDuty[0],
              })
            }
          >
            <Text>Gemeinsam speichern</Text>
          </Pressable>
        </>
      );
    }
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByText("Grundlage korrigieren"));
    await fireEvent.press(
      screen.getByRole("button", { name: /Für weitere passende Dienste übernehmen/ }),
    );
    await fireEvent.press(screen.getByRole("checkbox", { name: /Ausgewählter Dienst/ }));
    expect(batch).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Gemeinsam speichern"));
    expect(single).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: "original", expectedRevision: 1, specialDuty: corrected }),
      expect.objectContaining({
        id: "target",
        expectedRevision: 1,
        startTime: "08:00",
        endTime: "16:00",
        specialDuty: expect.objectContaining({
          standbyLevel: "B",
          standbyAgreement: expect.objectContaining({ tariff: "TVL_43", sequence: 3 }),
        }),
      }),
    ]);
  });
  it("keeps a known total in the existing card and opens the exact duty's billing", async () => {
    const screen = await render(
      <PayListCard
        onPress={jest.fn()}
        base={4000}
        premiums={100}
        gross={4100}
        partial
        duties={[first]}
        caption="Unverbindliche Schätzung"
      />,
    );
    expect(screen.getByText("Bekanntes Brutto")).toBeTruthy();
    expect(screen.getByText("Grundgehalt")).toBeTruthy();
    expect(screen.queryByText("Nicht verfügbar")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Bereitschaft: 1 Dienst prüfen" }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/shift-editor",
      params: { date: first.date, mode: "SHIFT", entryId: first.shiftId, focus: "BILLING" },
    });
  });

  it("opens the selected entry from a compact sheet when several duties need review", async () => {
    const screen = await render(<SpecialDutyReviewRow duties={[first, second]} />);
    await fireEvent.press(screen.getByText("Bereitschaft · 2 Dienste prüfen"));
    await fireEvent.press(screen.getByRole("button", { name: /Zweiter Dienst/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/shift-editor",
      params: { date: second.date, mode: "SHIFT", entryId: second.shiftId, focus: "BILLING" },
    });
  });

  it("opens billing immediately and explains a saved tariff mismatch without changing data", async () => {
    const onChange = jest.fn();
    const screen = await render(
      <StandbyAgreementFields
        initiallyOpen
        template={false}
        tariffFamily="TVL_43"
        onChange={onChange}
        value={{
          ...newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
          version: 2,
          standbyAgreement: { ...newStandbyAgreement("TVOED_K"), rule: "STANDARD" },
        }}
      />,
    );
    expect(screen.getByText("Bewertung laut Arbeitgeber")).toBeTruthy();
    expect(screen.getByText(/noch mit TVöD Krankenhaus gespeichert/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("starts with no other duty selected and requires an explicit individual choice", async () => {
    const target = forecastShift({ date: "2026-07-08", title: "Weiterer Dienst" });
    const changed = jest.fn();
    function Harness() {
      const [selected, setSelected] = useState<readonly ShiftEntry[]>([]);
      return (
        <StandbyBillingTransferFields
          candidates={[target]}
          selected={selected}
          onChange={(entries) => {
            setSelected(entries);
            changed(entries);
          }}
        />
      );
    }
    const screen = await render(<Harness />);
    await fireEvent.press(
      screen.getByRole("button", { name: /Für weitere passende Dienste übernehmen/ }),
    );
    const choice = screen.getByRole("checkbox", { name: /Weiterer Dienst/ });
    expect(choice).toHaveProp("accessibilityState", { checked: false });
    expect(changed).not.toHaveBeenCalled();
    await fireEvent.press(choice);
    expect(changed).toHaveBeenLastCalledWith([target]);
    await fireEvent.press(screen.getByRole("button", { name: /Auswahl zurücksetzen/ }));
    expect(changed).toHaveBeenLastCalledWith([]);
  });
});
