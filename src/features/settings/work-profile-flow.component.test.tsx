import { Temporal } from "@js-temporal/polyfill";
import { captureEmploymentProfile } from "@/domain/employment-history";
import { remunerationDataFromLegacy } from "@/domain/remuneration-profile";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Alert } from "react-native";
import { router } from "expo-router";
import type { SaveProfileInput, UserProfile } from "@/domain/types";
import type { NavigationAction } from "expo-router/react-navigation";
import { LIGHT_PALETTE } from "@/theme/palette-values";
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
  return screen.getByRole("button", { name: "Speichern" });
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

  async function openSave(screen: Awaited<ReturnType<typeof render>>) {
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen speichern" }));
  }
  async function whole(screen: Awaited<ReturnType<typeof render>>) {
    await fireEvent.press(screen.getByRole("radio", { name: "Für den gesamten Zeitraum" }));
    await fireEvent.press(screen.getByRole("button", { name: "Gesamten Zeitraum berichtigen" }));
  }
  it("shows no period question or writes when the editor is unchanged", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    expect(screen.queryByText("Seit wann gelten diese Angaben?")).toBeNull();
    expect(screen.queryByLabelText("Gültig ab")).toBeNull();
    await fireEvent.press(saveButton(screen));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("asks for the period only after saving a changed value", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await openSave(screen);
    expect(screen.getByText("Seit wann gelten diese Angaben?")).toBeTruthy();
    expect(screen.getByText("Wochenstunden: 38,5 Std. → 30 Std.")).toBeTruthy();
    expect(screen.queryByLabelText("Gültig ab")).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    await whole(screen);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklyMinutes: 1800,
        validity: expect.objectContaining({
          effectiveFrom: null,
          fields: ["weeklyMinutes"],
          correctionFields: ["weeklyMinutes"],
        }),
      }),
    );
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByText("Gespeichert · bisherige Angaben berichtigt")).toBeTruthy();
  });
  it("sets a concrete effective day at the end and preserves the original guard", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await openSave(screen);
    await fireEvent.press(screen.getByRole("radio", { name: "Ab einem Datum" }));
    await fireEvent(
      screen.getByLabelText("Gültig ab"),
      "valueChange",
      {},
      new Date(2026, 10, 1, 12),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Ab 01.11.2026 speichern" }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        validity: expect.objectContaining({
          effectiveFrom: "2026-11-01",
          expectedTimeline: "[]",
          expectedProfileUpdatedAt: "2026-01-01T00:00:00Z",
        }),
      }),
    );
  });
  it("returns from the period dialog without losing the draft", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await openSave(screen);
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zu deinen Angaben" }));
    await waitFor(() => expect(screen.queryByText("Seit wann gelten diese Angaben?")).toBeNull());
    expect(screen.getByLabelText("Deine Wochenstunden (Std.)").props.value).toBe("30");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("does not create a period after returning a draft value to its original value", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "38,5");
    await fireEvent.press(saveButton(screen));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText("Seit wann gelten diese Angaben?")).toBeNull();
  });
  it("shares one draft and one period for hours, tariff level and Sunday answers", async () => {
    mockSection = "EMPLOYMENT";
    mockOrigin = "settings";
    const screen = await render(<SettingsEditorTestFlow />);
    expect(screen.queryByRole("button", { name: "Name & Arbeitgeber" })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await select(screen, "Stufe", "Stufe 2");
    await select(screen, "Sonn- und Feiertagsarbeit", "Ja");
    expect(mockUpdate).not.toHaveBeenCalled();
    await openSave(screen);
    await whole(screen);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklyMinutes: 1800,
        sundayHolidayWorkEligible: true,
        tariff: expect.objectContaining({ payLevel: 2 }),
        validity: expect.objectContaining({
          effectiveFrom: null,
          fields: expect.arrayContaining(["weeklyMinutes", "tariff", "sundayHolidayWorkEligible"]),
        }),
      }),
    );
  });
  it("preserves untouched tariff data when changing hours in the shared editor", async () => {
    mockSection = "EMPLOYMENT";
    mockProfile = {
      ...mockProfile,
      tariff: { ...mockProfile.tariff!, fullTimeWeeklyMinutes: 2340 },
    };
    const tariff = mockProfile.tariff;
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await openSave(screen);
    await whole(screen);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tariff,
        validity: expect.objectContaining({ fields: ["weeklyMinutes"] }),
      }),
    );
  });
  it("does not revalidate an untouched historical salary basis for a model-only correction", async () => {
    const clock = jest
      .spyOn(Temporal.Now, "plainDateISO")
      .mockReturnValue(Temporal.PlainDate.from("2027-01-05"));
    try {
      mockSection = "EMPLOYMENT";
      mockProfile = {
        ...mockProfile,
        tariff: null,
        weeklyMinutes: 2400,
        tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "EAST" },
      };
      const tariff = mockProfile.tvlKrTariff;
      const screen = await render(<SettingsEditorTestFlow />);
      await select(screen, "Sonn- und Feiertagsarbeit", "Ja");
      await openSave(screen);
      await whole(screen);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          weeklyMinutes: 2400,
          tvlKrTariff: tariff,
          sundayHolidayWorkEligible: true,
          validity: expect.objectContaining({ fields: ["sundayHolidayWorkEligible"] }),
        }),
      );
    } finally {
      clock.mockRestore();
    }
  });
  it("lets a directly opened model change choose its own period at save time", async () => {
    mockSection = "MODEL";
    const screen = await render(<SettingsEditorTestFlow />);
    expect(screen.queryByText("Angaben zur Prüfung")).toBeNull();
    await select(screen, "Sonn- und Feiertagsarbeit", "Ja");
    await openSave(screen);
    expect(mockUpdate).not.toHaveBeenCalled();
    await whole(screen);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sundayHolidayWorkEligible: true,
        weeklyMinutes: 2310,
        validity: expect.objectContaining({ correctionFields: ["sundayHolidayWorkEligible"] }),
      }),
    );
  });
  it("discards all local changes without writing", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await fireEvent.press(screen.getByRole("button", { name: "Änderungen verwerfen" }));
    expect(screen.getByLabelText("Deine Wochenstunden (Std.)").props.value).toBe("38,5");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("requests an actual guarded undo rather than adding a dated reverse change", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await openSave(screen);
    await whole(screen);
    await fireEvent.press(screen.getByRole("button", { name: "Letzte Änderung rückgängig" }));
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[1][0]).toMatchObject({
      weeklyMinutes: 2310,
      validity: { effectiveFrom: null, restoreTimeline: [], expectedTimeline: "[]" },
    });
    expect(screen.getByText("Letzte Änderung zurückgenommen.")).toBeTruthy();
  });
  it("keeps a failed save and its input available for correction", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("storage"));
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await openSave(screen);
    await whole(screen);
    expect(screen.getByText("Seit wann gelten diese Angaben?")).toBeTruthy();
    expect(screen.getByText("Die Angaben konnten nicht gespeichert werden.")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });
  it("blocks duplicate commits while storage is pending", async () => {
    let resolve!: (p: UserProfile) => void;
    mockUpdate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await openSave(screen);
    await fireEvent.press(screen.getByRole("radio", { name: "Für den gesamten Zeitraum" }));
    await fireEvent.press(screen.getByRole("button", { name: "Gesamten Zeitraum berichtigen" }));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ...mockProfile, weeklyMinutes: 1800 }));
  });
  it("validates hours before asking for a period", async () => {
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "");
    await openSave(screen);
    expect(screen.queryByText("Seit wann gelten diese Angaben?")).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("reuses the explicit date of a historical correction and guards the current timeline", async () => {
    const before = { ...mockProfile };
    mockProfile = {
      ...before,
      employmentTimeline: [
        {
          effectiveFrom: "2026-10-10",
          employment: captureEmploymentProfile({ ...before, weeklyMinutes: 1800 }),
          data: remunerationDataFromLegacy({ ...before, weeklyMinutes: 1800 }),
          revision: 1,
          createdAt: before.createdAt,
          updatedAt: before.updatedAt,
        },
      ],
    };
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.press(screen.getByRole("button", { name: "Änderungsverlauf" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Angaben ab 10.10.2026 berichtigen" }),
    );
    expect(screen.getByLabelText("Deine Wochenstunden (Std.)").props.value).toBe("30");
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "38,5");
    await openSave(screen);
    expect(
      screen.getByRole("radio", { name: "Ab einem Datum" }).props.accessibilityState.checked,
    ).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Ab 10.10.2026 speichern" }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklyMinutes: 2310,
        validity: expect.objectContaining({
          effectiveFrom: "2026-10-10",
          baseline: expect.objectContaining({ weeklyMinutes: 1800 }),
          fields: ["weeklyMinutes"],
        }),
      }),
    );
  });
  it("validates the dated full-time basis at the chosen historical date", async () => {
    const clock = jest
      .spyOn(Temporal.Now, "plainDateISO")
      .mockReturnValue(Temporal.PlainDate.from("2027-01-05"));
    try {
      mockSection = "TARIFF";
      mockProfile = {
        ...mockProfile,
        tariff: null,
        weeklyMinutes: 2400,
        tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "EAST" },
      };
      const screen = await render(<SettingsEditorTestFlow />);
      await select(screen, "Stufe", "Stufe 5");
      await openSave(screen);
      await fireEvent.press(screen.getByRole("radio", { name: "Ab einem Datum" }));
      await fireEvent(
        screen.getByLabelText("Gültig ab"),
        "valueChange",
        {},
        new Date(2026, 9, 1, 12),
      );
      await fireEvent.press(screen.getByRole("button", { name: "Ab 01.10.2026 speichern" }));
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          weeklyMinutes: 2400,
          tvlKrTariff: expect.objectContaining({ payLevel: 5 }),
          validity: expect.objectContaining({ effectiveFrom: "2026-10-01" }),
        }),
      );
    } finally {
      clock.mockRestore();
    }
  });
  it("stores the first unconfigured setup without a redundant period question", async () => {
    mockProfile = {
      ...mockProfile,
      tariff: null,
      regularRotatingNightWork: null,
      sundayHolidayWorkEligible: null,
      allEmploymentWorkRecorded: null,
    };
    const screen = await render(<SettingsEditorTestFlow />);
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await openSave(screen);
    expect(screen.queryByText("Seit wann gelten diese Angaben?")).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ validity: expect.objectContaining({ effectiveFrom: null }) }),
    );
  });
  it("keeps the unsaved draft when continuing after a back-navigation warning", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    try {
      const screen = await render(<SettingsEditorTestFlow />);
      await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
      expect(mockGuard.active).toBe(true);
      await act(async () => mockGuard.callback({ data: { action: { type: "GO_BACK" } } }));
      expect(alert).toHaveBeenCalledWith(
        "Änderungen verwerfen?",
        expect.any(String),
        expect.any(Array),
      );
      await act(async () =>
        alert.mock.calls[0][2]?.find((button) => button.text === "Weiter bearbeiten")?.onPress?.(),
      );
      expect(screen.getByLabelText("Deine Wochenstunden (Std.)").props.value).toBe("30");
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });
});
