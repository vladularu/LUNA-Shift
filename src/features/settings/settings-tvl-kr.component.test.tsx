import { Temporal } from "@js-temporal/polyfill";
import type { UserProfile, SaveProfileInput } from "@/domain/types";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  SettingsEditorTestFlow,
  saveSettingsChoice,
  closeSettingsSave,
  chooseTariffDetails,
  selectSettingsChoice as select,
} from "./settings-choice-test-helpers";
import { LIGHT_PALETTE } from "@/theme/palette-values";

const mockUpdateProfile = jest.fn<(input: SaveProfileInput) => Promise<UserProfile>>();
const mockPalette = LIGHT_PALETTE;
let mockSection = "TARIFF";
let mockProfile: UserProfile;
const baseProfile: UserProfile = {
  federalState: "NW",
  holidayRegion: "NONE",
  weeklyMinutes: 2310,
  timeZone: "Europe/Berlin",
  industry: "HEALTHCARE",
  tariff: null,
  manualMonthlyGrossCents: null,
  regularRotatingNightWork: false,
  sundayHolidayWorkEligible: true,
  allEmploymentWorkRecorded: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useNavigation: () => ({ dispatch: jest.fn() }),
  useLocalSearchParams: () => ({ section: mockSection }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => React.ReactNode } }) =>
      options.headerRight?.() ?? null,
  },
}));
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: true, error: null }),
  usePflegeShiftProfile: () => ({
    updateProfile: mockUpdateProfile,
    profile: mockProfile,
  }),
}));
jest.mock("@/ui/form-layout", () => {
  const { Button, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    FormScreen: ({ children }: React.PropsWithChildren) => children,
    FormSection: ({ children }: React.PropsWithChildren) => children,
    FormStatus: ({ error }: { error: string | null }) => (error ? <Text>{error}</Text> : null),
    HeaderSaveAction: ({ onPress }: { onPress: () => void }) => (
      <Button title="Speichern" onPress={onPress} />
    ),
  };
});

function editor() {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 932 },
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
      }}
    >
      <SettingsEditorTestFlow />
    </SafeAreaProvider>
  );
}

const tvl = { payGroup: "KR8" as const, payLevel: 4 as const, universityRegion: "WEST" as const };
describe("TV-L in the familiar salary form", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Temporal.Now, "plainDateISO").mockReturnValue(Temporal.PlainDate.from("2026-10-05"));
    mockUpdateProfile.mockImplementation(async (input) => ({ ...mockProfile, ...input }));
    mockSection = "TARIFF";
    mockProfile = { ...baseProfile, tvlKrTariff: tvl };
  });
  it("selects a real calendar date in the existing tariff form", async () => {
    const screen = await render(editor());
    expect(screen.queryByLabelText("Gültig ab")).toBeNull();
    await select(screen, "Stufe", "Stufe 5");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Ab einem Datum" }));
    await fireEvent(
      screen.getByLabelText("Gültig ab"),
      "valueChange",
      {},
      new Date(2026, 6, 1, 12),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Ab 01.07.2026 speichern" }));
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        validity: expect.objectContaining({ effectiveFrom: "2026-07-01" }),
      }),
    );
  });
  it("reopens KR group, level and region with inline validity and no VKA or history menus", async () => {
    const screen = await render(editor());
    expect(screen.queryByText("Seit wann gelten diese Angaben?")).toBeNull();
    expect(screen.getByRole("button", { name: "Tarifvertrag: TV-L Pflege" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entgeltgruppe: KR8" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stufe: Stufe 4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tarifregion: West" })).toBeTruthy();
    expect(screen.getAllByText("38,5 Std.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Einrichtung:/ })).toBeNull();
    expect(
      screen.queryByText(/Geburtsdatum|Vergütungsstände|Frühere Angaben|Übrige VKA/),
    ).toBeNull();
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it("offers only KR groups and their valid levels", async () => {
    const screen = await render(editor());
    const groups = await select(screen, "Entgeltgruppe", "KR12");
    expect(groups).toContain("KR5");
    expect(groups).toContain("KR17");
    expect(groups).not.toContain("P8");
    expect(groups).not.toContain("E9b");
    const levels = await select(screen, "Stufe", "Stufe 6");
    expect(levels).not.toContain("Stufe 1");
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tvlKrTariff: { ...tvl, payGroup: "KR12", payLevel: 6 } }),
    );
  });
  it("allows KR5 level 1 and requires choosing a valid level after switching to KR7", async () => {
    mockProfile = { ...baseProfile, tvlKrTariff: { ...tvl, payGroup: "KR5", payLevel: 1 } };
    const screen = await render(editor());
    await select(screen, "Entgeltgruppe", "KR7");
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(screen.getByText(/Bitte eine gültige Stufe/)).toBeTruthy();
    const levels = await select(screen, "Stufe", "Stufe 2");
    expect(levels).not.toContain("Stufe 1");
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tvlKrTariff: { ...tvl, payGroup: "KR7", payLevel: 2 } }),
    );
  });
  it("saves the explicit East region and shows its current university full time", async () => {
    const screen = await render(editor());
    await select(screen, "Tarifgebiet", "Ost");
    expect(screen.getAllByText("40 Std.")).toBeTruthy();
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tvlKrTariff: { ...tvl, universityRegion: "EAST" } }),
    );
  });
  it("shows the automatic East full-time change in 2027 with the unchanged prefilled validity date", async () => {
    jest.spyOn(Temporal.Now, "plainDateISO").mockReturnValue(Temporal.PlainDate.from("2027-01-05"));
    mockProfile = { ...baseProfile, tvlKrTariff: { ...tvl, universityRegion: "EAST" } };
    const screen = await render(editor());
    expect(screen.getAllByText("39,5 Std.")).toBeTruthy();
    expect(screen.queryByText("Seit wann gelten diese Angaben?")).toBeNull();
  });
  it("switches to P and restores only the P-specific controls", async () => {
    const screen = await render(editor());
    await select(screen, "Berechnung", "TVöD-P");
    await chooseTariffDetails(screen, "TVöD-P");
    expect(screen.getByRole("button", { name: /^Einrichtung:/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entgeltgruppe: P8" })).toBeTruthy();
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        tvlKrTariff: null,
        tariff: expect.objectContaining({ payGroup: "P8" }),
      }),
    );
  });
  it("switches to Ausbildung without keeping a KR selection", async () => {
    const screen = await render(editor());
    await select(screen, "Berechnung", "TVAöD Pflege · Ausbildung");
    await select(screen, "Ausbildungsjahr", "2. Ausbildungsjahr");
    expect(screen.queryByRole("button", { name: /^Entgeltgruppe:/ })).toBeNull();
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        tvlKrTariff: null,
        nursingTrainingTariff: expect.objectContaining({ trainingYear: 2 }),
      }),
    );
  });
  it("switches to a manual amount without tariff fields", async () => {
    const screen = await render(editor());
    await select(screen, "Berechnung", "Monatsbrutto selbst eintragen");
    await fireEvent.changeText(screen.getByLabelText("Monatliches Brutto in Euro"), "1800");
    expect(
      screen.queryByRole("button", { name: /^Entgeltgruppe:|^Tarifregion:|^Einrichtung:/ }),
    ).toBeNull();
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tvlKrTariff: null, manualMonthlyGrossCents: 180000 }),
    );
  });
  it("preserves TV-L on working-time edits", async () => {
    mockSection = "WORK";
    const screen = await render(editor());
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "30");
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ weeklyMinutes: 1800, tvlKrTariff: tvl, tariff: null }),
    );
  });
  it("does not silently change an East selection after another salary mode", async () => {
    mockProfile = { ...baseProfile, tvlKrTariff: { ...tvl, universityRegion: "EAST" } };
    const screen = await render(editor());
    await select(screen, "Berechnung", "TVöD VKA · E-Tabelle");
    await select(screen, "Berechnung", "TV-L Pflege");
    expect(screen.getByRole("button", { name: "Tarifregion: Ost" })).toBeTruthy();
  });
  it("requires a working-time correction above the selected full-time basis", async () => {
    mockSection = "EMPLOYMENT";
    const screen = await render(editor());
    await fireEvent.changeText(screen.getByLabelText("Deine Wochenstunden (Std.)"), "40");
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Deine Wochenstunden liegen über der tariflichen Vollzeit/),
    ).toBeTruthy();
    await closeSettingsSave(screen);
    await select(screen, "Tarifgebiet", "Ost");
    await saveSettingsChoice(screen);
    expect(mockUpdateProfile).toHaveBeenCalled();
  });
});
