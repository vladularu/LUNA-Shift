import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Alert } from "react-native";
import { router } from "expo-router";
import type { SaveProfileInput, UserProfile } from "@/domain/types";
import type { NavigationAction } from "expo-router/react-navigation";
import { LIGHT_PALETTE, DARK_PALETTE } from "@/theme/palette-values";
import {
  SettingsEditorTestFlow,
  selectSettingsChoice as select,
} from "./settings-choice-test-helpers";
let mockSection = "WORK";
let mockOrigin: string | undefined;
let mockProfile: UserProfile;
let mockPalette = LIGHT_PALETTE;
const mockUpdate = jest.fn<(input: SaveProfileInput) => Promise<UserProfile>>();
const mockDispatch = jest.fn();
const mockNavigation = { dispatch: mockDispatch };
type MockHeaderOptions = {
  headerBackVisible?: boolean;
  presentation?: string;
  headerLeft?: () => React.ReactNode;
  headerRight?: () => React.ReactNode;
};
let mockHeaderOptions: MockHeaderOptions;
let mockGuard: {
  active: boolean;
  callback: (event: { data: { action: NavigationAction } }) => void;
};
jest.mock("expo-router/react-navigation", () => ({
  usePreventRemove: (active: boolean, callback: typeof mockGuard.callback) => {
    mockGuard = { active, callback };
  },
}));
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ section: mockSection, origin: mockOrigin }),
  useNavigation: () => mockNavigation,
  Stack: {
    Screen: ({ options }: { options: MockHeaderOptions }) => {
      mockHeaderOptions = { ...mockHeaderOptions, ...options };
      return (
        <>
          {options.headerLeft?.()}
          {options.headerRight?.()}
        </>
      );
    },
  },
}));
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile, updateProfile: mockUpdate }),
  usePflegeShiftStatus: () => ({ ready: true, error: null }),
}));
function saveButton(screen: Awaited<ReturnType<typeof render>>) {
  return screen.getByRole("button", { name: "Speichern und schließen" });
}
describe("work profile draft flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHeaderOptions = {};
    mockSection = "WORK";
    mockOrigin = undefined;
    mockPalette = LIGHT_PALETTE;
    mockProfile = {
      displayName: "Alex",
      employerName: "Klinikum",
      federalState: "NW",
      holidayRegion: "NONE",
      weeklyMinutes: 2310,
      timeZone: "Europe/Berlin",
      industry: "HEALTHCARE",
      tariff: {
        payGroup: "P5",
        payLevel: 1,
        sector: "BT_K",
        tariffRegion: "OTHER",
        fullTimeWeeklyMinutes: 2310,
      },
      regularRotatingNightWork: null,
      sundayHolidayWorkEligible: false,
      allEmploymentWorkRecorded: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    mockUpdate.mockImplementation(async (input) => {
      mockProfile = { ...mockProfile, ...input };
      return mockProfile;
    });
  });
  it("edits only the employer from More and keeps the report name and salary intact", async () => {
    mockSection = "EMPLOYER";
    mockOrigin = "settings";
    const original = { ...mockProfile };
    const screen = await render(<SettingsEditorTestFlow />);
    expect(screen.queryByLabelText("Name")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Arbeitgeber"), "Neues Klinikum");
    await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({ ...original, employerName: "Neues Klinikum" });
    expect(router.back).toHaveBeenCalledTimes(1);
  });
  it("uses compact tariff choices and a More footer without saving until Done", async () => {
    mockSection = "TARIFF";
    mockOrigin = "settings";
    const screen = await render(<SettingsEditorTestFlow />);
    expect(screen.getByRole("button", { name: "Tarif: TVöD-P" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zurück zu Mehr" })).toBeTruthy();
    expect(screen.queryByTestId("salary-basis-selection")).toBeNull();
    await select(screen, "Entgeltgruppe", "P8");
    await select(screen, "Stufe", "Stufe 4");
    expect(mockUpdate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0].tariff).toMatchObject({ payGroup: "P8", payLevel: 4 });
  });
  it("retains manual gross as a selectable alternative in the compact tariff flow", async () => {
    mockSection = "TARIFF";
    mockOrigin = "settings";
    const screen = await render(<SettingsEditorTestFlow />);
    await select(screen, "Tarif", "Monatsbrutto selbst eintragen");
    expect(screen.getByLabelText("Monatliches Brutto in Euro")).toBeTruthy();
    expect(screen.getByTestId("salary-basis-selection")).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("keeps check answers in their shared editor while preserving them when saving work", async () => {
    mockHeaderOptions = { headerLeft: jest.fn(() => null) };
    let screen = await render(<SettingsEditorTestFlow />);
    expect(mockHeaderOptions.headerBackVisible).toBe(true);
    expect(mockHeaderOptions.presentation).toBe("card");
    expect(mockHeaderOptions.headerLeft).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Arbeitest du regelmäßig nachts/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sonn- und Feiertagsarbeit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Arbeitszeiten aus allen Jobs/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Angaben zur Prüfung" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Regionale Feiertage:/ })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await select(screen, "Bundesland", "Bayern");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Regionale Feiertage:/ })).toBeTruthy();
    await fireEvent.press(saveButton(screen));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        federalState: "BY",
        holidayRegion: "UNKNOWN",
        weeklyMinutes: 1800,
        regularRotatingNightWork: null,
        sundayHolidayWorkEligible: false,
        allEmploymentWorkRecorded: true,
        tariff: mockProfile.tariff,
      }),
    );
    await screen.unmount();
    screen = await render(<SettingsEditorTestFlow />);
    expect(screen.getByDisplayValue("30")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bundesland: Bayern" })).toBeTruthy();
    expect(mockGuard.active).toBe(false);
  });
  it("replaces unchanged work with the shared check editor once without writing", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    const button = screen.getByRole("button", { name: "Angaben zur Prüfung" });
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/check-profile");
    expect(router.back).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("saves the current work place before replacing the editor and blocks repeated success taps", async () => {
    let complete!: (value: UserProfile) => void;
    mockUpdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await select(screen, "Bundesland", "Bayern");
    jest.mocked(router.back).mockClear();
    const button = screen.getByRole("button", { name: "Speichern & Angaben öffnen" });
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklyMinutes: 1800,
        federalState: "BY",
        holidayRegion: "UNKNOWN",
        regularRotatingNightWork: null,
        sundayHolidayWorkEligible: false,
        allEmploymentWorkRecorded: true,
      }),
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockGuard.active).toBe(true);
    await act(() => complete(mockProfile));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/check-profile"));
    await fireEvent.press(button);
    await fireEvent.press(saveButton(screen));
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Arbeitsprofil" }));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
    expect(mockGuard.active).toBe(false);
  });
  it("keeps invalid or failed work drafts in place and opens check questions only after retry succeeds", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "keine Zahl");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern & Angaben öffnen" }));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("keine Zahl")).toBeTruthy();
    await fireEvent.changeText(screen.getByDisplayValue("keine Zahl"), "30");
    mockUpdate.mockRejectedValueOnce(new Error("storage"));
    await fireEvent.press(screen.getByRole("button", { name: "Speichern & Angaben öffnen" }));
    await waitFor(() => expect(screen.getByText("Speichern fehlgeschlagen.")).toBeTruthy());
    expect(screen.getByDisplayValue("30")).toBeTruthy();
    expect(mockGuard.active).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Speichern & Angaben öffnen" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ weeklyMinutes: 1800 }));
  });
  it("preserves the latest check answers instead of hidden initial values during work save", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    mockProfile = {
      ...mockProfile,
      regularRotatingNightWork: true,
      sundayHolidayWorkEligible: null,
      allEmploymentWorkRecorded: false,
    };
    await screen.rerender(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await fireEvent.press(saveButton(screen));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        regularRotatingNightWork: true,
        sundayHolidayWorkEligible: null,
        allEmploymentWorkRecorded: false,
      }),
    );
  });
  it("preserves a failed save through a theme change and confirms discarding before going back", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "28");
    mockUpdate.mockRejectedValueOnce(new Error("storage"));
    await fireEvent.press(saveButton(screen));
    await waitFor(() => expect(screen.getByText("Speichern fehlgeschlagen.")).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("28")).toBeTruthy();
    mockPalette = DARK_PALETTE;
    await screen.rerender(<SettingsEditorTestFlow />);
    expect(screen.getByDisplayValue("28")).toBeTruthy();
    const alert = jest.spyOn(Alert, "alert");
    const action: NavigationAction = { type: "GO_BACK" };
    await act(() => mockGuard.callback({ data: { action } }));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("28")).toBeTruthy();
    await act(() => alert.mock.calls.at(-1)![2]![1].onPress?.());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(action);
    expect(mockProfile.weeklyMinutes).toBe(2310);
  });
  it("guards back and swipe, keeps the draft or dispatches the original removal after discarding", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "32");
    expect(mockGuard.active).toBe(true);
    const alert = jest.spyOn(Alert, "alert");
    const action: NavigationAction = { type: "GO_BACK" };
    await act(() => mockGuard.callback({ data: { action } }));
    const buttons = alert.mock.calls[0][2]!;
    expect(buttons.map((button) => button.text)).toEqual([
      "Weiter bearbeiten",
      "Änderungen verwerfen",
    ]);
    await act(() => buttons[0].onPress?.());
    expect(screen.getByDisplayValue("32")).toBeTruthy();
    expect(mockDispatch).not.toHaveBeenCalled();
    await act(() => mockGuard.callback({ data: { action } }));
    await act(() => alert.mock.calls[1][2]![1].onPress?.());
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(action);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("opens a searchable categorized picker with a checkmark and does not persist selection", async () => {
    mockSection = "TARIFF";
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.press(screen.getByRole("button", { name: "Tarifvertrag: TVöD-P" }));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/profile-selection" }),
    );
    const page = within(screen.getByTestId("profile-selection-content"));
    expect(page.queryByRole("button", { name: /Speichern/ })).toBeNull();
    expect(page.getByRole("button", { name: "TVöD-P" }).props.accessibilityState.selected).toBe(
      true,
    );
    expect(page.getByText("Pflegepersonal")).toBeTruthy();
    expect(page.getByText("Ausbildung")).toBeTruthy();
    await fireEvent.changeText(page.getByLabelText("Tarif suchen"), "Hessen");
    expect(page.queryByRole("button", { name: "TVöD-P" })).toBeNull();
    await fireEvent.press(page.getByRole("button", { name: "TV-H Pflege · Hessen" }));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Entgeltgruppe: Bitte auswählen" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Stufe: Bitte auswählen" }).props.accessibilityState
        .disabled,
    ).toBe(true);
    await fireEvent.press(saveButton(screen));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/Gruppe und Stufe werden nicht automatisch ersetzt/)).toBeTruthy();
    await select(screen, "Entgeltgruppe", "KR5");
    await select(screen, "Stufe", "Stufe 1b");
    await fireEvent.press(saveButton(screen));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tariff: null,
        tvhKrTariff: { payGroup: "KR5", payLevel: "1b", fullTimeWeeklyMinutes: 2400 },
      }),
    );
  });
  it("invalidates incompatible stages and preserves the original draft when switching away and back", async () => {
    mockSection = "TARIFF";
    const screen = await render(<SettingsEditorTestFlow />);
    await select(screen, "Entgeltgruppe", "P7");
    expect(screen.getByRole("button", { name: "Stufe: Bitte auswählen" })).toBeTruthy();
    await fireEvent.press(saveButton(screen));
    expect(mockUpdate).not.toHaveBeenCalled();
    await select(screen, "Stufe", "Stufe 2");
    await select(screen, "Tarifvertrag", "TV-L Pflege");
    await select(screen, "Tarifvertrag", "TVöD-P");
    expect(screen.getByRole("button", { name: "Entgeltgruppe: P7" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stufe: Stufe 2" })).toBeTruthy();
  });
  it("preserves the existing TV-H full-time choice independently of personal hours", async () => {
    mockSection = "TARIFF";
    mockProfile = {
      ...mockProfile,
      tariff: null,
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2400 },
    };
    const screen = await render(<SettingsEditorTestFlow />);
    expect(screen.getByRole("button", { name: "Vollzeit laut Tarif: 40 Std." })).toBeTruthy();
    expect(screen.getByText("38,5 Std.")).toBeTruthy();
    await fireEvent.press(saveButton(screen));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklyMinutes: 2310,
        tvhKrTariff: expect.objectContaining({ fullTimeWeeklyMinutes: 2400 }),
      }),
    );
  });

  it("edits identity on its own page and preserves calculation fields", async () => {
    mockSection = "PERSONAL";
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Name"), "  Andrea  ");
    await fireEvent.changeText(screen.getByLabelText("Arbeitgeber"), "Neue Klinik");
    await fireEvent.press(saveButton(screen));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Andrea",
        employerName: "Neue Klinik",
        weeklyMinutes: 2310,
        tariff: mockProfile.tariff,
      }),
    );
  });
  it("retains an identity draft after storage failure", async () => {
    mockSection = "PERSONAL";
    mockUpdate.mockRejectedValueOnce(new Error("storage"));
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Arbeitgeber"), "Neue Klinik");
    await fireEvent.press(saveButton(screen));
    await waitFor(() =>
      expect(screen.getByText("Profil konnte nicht gespeichert werden.")).toBeTruthy(),
    );
    expect(screen.getByDisplayValue("Neue Klinik")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });
  it("retains the entire tariff draft on failure and only leaves after a successful retry", async () => {
    mockSection = "TARIFF";
    const screen = await render(<SettingsEditorTestFlow />);
    await select(screen, "Entgeltgruppe", "P7");
    await select(screen, "Stufe", "Stufe 2");
    (router.back as jest.Mock).mockClear();
    mockUpdate.mockRejectedValueOnce(new Error("storage"));
    await fireEvent.press(saveButton(screen));
    await waitFor(() => expect(screen.getByText("Speichern fehlgeschlagen.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Entgeltgruppe: P7" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stufe: Stufe 2" })).toBeTruthy();
    expect(mockProfile.tariff?.payGroup).toBe("P5");
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(saveButton(screen));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(mockProfile.tariff).toMatchObject({ payGroup: "P7", payLevel: 2 });
  });
  it("does not mark searching or choosing the existing tariff as a profile edit", async () => {
    mockSection = "TARIFF";
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.press(screen.getByRole("button", { name: "Tarifvertrag: TVöD-P" }));
    const page = within(screen.getByTestId("profile-selection-content"));
    await fireEvent.changeText(page.getByLabelText("Tarif suchen"), "TVöD-P");
    expect(mockGuard.active).toBe(false);
    await fireEvent.press(page.getByRole("button", { name: "TVöD-P" }));
    expect(mockGuard.active).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("blocks duplicate saving and removal until the pending whole-draft save completes", async () => {
    let complete!: (value: UserProfile) => void;
    mockUpdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const screen = await render(<SettingsEditorTestFlow />);
    const button = saveButton(screen);
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Deine Wochenstunden (Std.)").props.editable).toBe(false);
    expect(mockGuard.active).toBe(true);
    const footer = screen.getByRole("button", { name: "Zurück zum Arbeitsprofil" });
    expect(footer.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(footer);
    await act(() => mockGuard.callback({ data: { action: { type: "GO_BACK" } } }));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    await act(() => complete(mockProfile));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Arbeitsprofil" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
  it("returns an unchanged editor from its footer without saving", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Arbeitsprofil" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGuard.active).toBe(false);
  });
  it("routes the footer through the existing unsaved-draft guard", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "32");
    const alert = jest.spyOn(Alert, "alert");
    const action: NavigationAction = { type: "GO_BACK" };
    jest.mocked(router.back).mockImplementationOnce(() => {
      mockGuard.callback({ data: { action } });
    });
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Arbeitsprofil" }));
    const buttons = alert.mock.calls[0][2]!;
    await act(() => buttons[0].onPress?.());
    expect(screen.getByDisplayValue("32")).toBeTruthy();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    jest.mocked(router.back).mockImplementationOnce(() => {
      mockGuard.callback({ data: { action } });
    });
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Arbeitsprofil" }));
    await act(() => alert.mock.calls[1][2]![1].onPress?.());
    expect(mockDispatch).toHaveBeenCalledWith(action);
    expect(mockProfile.weeklyMinutes).toBe(2310);
  });
  it("dismisses a work picker from the footer and retains the parent draft", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "32");
    await fireEvent.press(screen.getByRole("button", { name: /^Bundesland:/ }));
    const page = within(screen.getByTestId("profile-selection-content"));
    await fireEvent.press(page.getByRole("button", { name: "Zurück zu Arbeitszeit" }));
    expect(screen.queryByTestId("profile-selection-content")).toBeNull();
    expect(screen.getByDisplayValue("32")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bundesland: Nordrhein-Westfalen" })).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("labels the tariff picker's return target and does not apply a searched value on back", async () => {
    mockSection = "TARIFF";
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.press(screen.getByRole("button", { name: "Tarifvertrag: TVöD-P" }));
    const page = within(screen.getByTestId("profile-selection-content"));
    await fireEvent.changeText(page.getByLabelText("Tarif suchen"), "Hessen");
    await fireEvent.press(page.getByRole("button", { name: "Zurück zu Tarif & Gehalt" }));
    expect(screen.queryByTestId("profile-selection-content")).toBeNull();
    expect(screen.getByRole("button", { name: "Tarifvertrag: TVöD-P" })).toBeTruthy();
    expect(mockGuard.active).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
