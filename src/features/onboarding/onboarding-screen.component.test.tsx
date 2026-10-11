import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { TARIFF_REGION_LABELS, type SaveProfileInput } from "@/domain/types";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { SALARY_BASIS_OPTIONS } from "@/features/settings/salary-basis-options";
import { OnboardingScreen, normalizeOnboardingGross, parseWeeklyHours } from "./onboarding-screen";

const mockUpdateProfile = jest.fn<(input: SaveProfileInput) => Promise<void>>();
let mockProfile: object | null = null;
let mockPalette = LIGHT_PALETTE;
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile, updateProfile: mockUpdateProfile }),
}));
jest.mock("expo-router", () => ({ router: { replace: jest.fn(), back: jest.fn() } }));
const metrics = {
  frame: { x: 0, y: 0, width: 430, height: 932 },
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
};
function onboarding(preview = false) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <OnboardingScreen preview={preview} />
    </SafeAreaProvider>
  );
}
type Screen = Awaited<ReturnType<typeof render>>;
const press = (screen: Screen, name: string | RegExp) =>
  fireEvent.press(screen.getByRole("button", { name }));
async function select(screen: Screen, field: string, option: string) {
  await press(screen, new RegExp("^" + field + ":"));
  await fireEvent.press(screen.getByRole("radio", { name: option }));
}
async function work(screen: Screen, industry = "Pflege & Gesundheitswesen") {
  await press(screen, "Los geht’s");
  await fireEvent.press(screen.getByRole("radio", { name: industry }));
  await press(screen, "Weiter");
}
async function salary(screen: Screen, hours = "38,5", industry = "Pflege & Gesundheitswesen") {
  await work(screen, industry);
  await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), hours);
  await select(screen, "Bundesland deines Arbeitsorts", "Nordrhein-Westfalen");
  await press(screen, "Weiter");
}
async function summary(screen: Screen) {
  await press(screen, "Weiter");
  expect(screen.getByText("Bereit für deinen Dienstplan.")).toBeTruthy();
}
async function pTariff(screen: Screen, group = "P8", level = "Stufe 4") {
  await fireEvent.press(screen.getByRole("radio", { name: "Nach Tarif" }));
  await select(screen, "Tarifvertrag", "TVöD-P");
  await select(screen, "Entgeltgruppe", group);
  await select(screen, "Stufe", level);
  await select(screen, "Tarifbereich", "Krankenhäuser · BT-K");
  await select(screen, "Tarifgebiet", TARIFF_REGION_LABELS.OTHER);
}
beforeEach(() => {
  mockPalette = LIGHT_PALETTE;
  mockProfile = null;
  jest.clearAllMocks();
  mockUpdateProfile.mockReset();
  mockUpdateProfile.mockResolvedValue(undefined);
});

describe("short onboarding with contextual salary", () => {
  it("places work before salary, keeps the action outside scrolling and requires deliberate choices", async () => {
    const screen = await render(onboarding());
    expect(screen.getByText("Dein Dienstplan.\nEinfach im Blick.")).toHaveStyle({
      textAlign: "center",
    });
    expect(
      within(screen.getByTestId("onboarding-scroll-content")).queryByTestId(
        "onboarding-primary-action",
      ),
    ).toBeNull();
    expect(
      within(screen.getByTestId("onboarding-fixed-footer")).getByRole("button", {
        name: "Los geht’s",
      }),
    ).toBeTruthy();
    await press(screen, "Los geht’s");
    screen.getAllByRole("radio").forEach((radio) => expect(radio).not.toBeChecked());
    await press(screen, "Weiter");
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte wähle deinen Berufsbereich aus.");
    await fireEvent.press(screen.getByRole("radio", { name: "Rettungsdienst" }));
    await press(screen, "Weiter");
    expect(screen.getByText("3 / 5")).toBeTruthy();
    expect(screen.getByTestId("onboarding-weekly-hours")).toBeTruthy();
    await select(screen, "Bundesland deines Arbeitsorts", "Berlin");
    await press(screen, "Weiter");
    expect(screen.getByText("4 / 5")).toBeTruthy();
    await press(screen, "Weiter");
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte wähle eine Gehaltsgrundlage aus.");
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it("uses the same tariff options as settings and does not select a tariff automatically", async () => {
    const screen = await render(onboarding());
    await salary(screen);
    await fireEvent.press(screen.getByRole("radio", { name: "Nach Tarif" }));
    await press(screen, "Weiter");
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte wähle deinen Tarifvertrag.");
    await press(screen, /^Tarifvertrag:/);
    for (const option of SALARY_BASIS_OPTIONS.filter(
      (item) => !["UNSET", "MANUAL"].includes(item.value),
    )) {
      const label = "selectionLabel" in option ? option.selectionLabel : option.label;
      expect(screen.getByRole("radio", { name: label })).not.toBeChecked();
    }
  });
  it.each(["P5", "P6"])(
    "saves explicitly selected %s stage 1 without confirming check assumptions",
    async (group) => {
      const screen = await render(onboarding());
      await salary(screen);
      await pTariff(screen, group, "Stufe 1");
      await summary(screen);
      await press(screen, "Zum Kalender");
      await waitFor(() =>
        expect(mockUpdateProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            tariff: expect.objectContaining({
              payGroup: group,
              payLevel: 1,
              tariffRegion: "OTHER",
            }),
          }),
        ),
      );
      const input = mockUpdateProfile.mock.calls[0][0];
      expect(input.allEmploymentWorkRecorded).toBeUndefined();
      expect(input.regularRotatingNightWork).toBeUndefined();
      expect(input.sundayHolidayWorkEligible).toBeUndefined();
    },
  );
  it("clears an incompatible stage after changing group and preserves choices on back", async () => {
    const screen = await render(onboarding());
    await salary(screen);
    await pTariff(screen, "P5", "Stufe 1");
    await select(screen, "Entgeltgruppe", "P7");
    await press(screen, "Weiter");
    expect(screen.getByText("Bitte wähle deine Stufe.")).toBeTruthy();
    await press(screen, /^Stufe:/);
    expect(screen.queryByRole("radio", { name: "Stufe 1" })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Stufe 2" }));
    await press(screen, "Zurück");
    expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("38,5");
    await press(screen, "Weiter");
    expect(screen.getByRole("button", { name: "Entgeltgruppe: P7" })).toBeTruthy();
    await summary(screen);
    await press(screen, "Zum Kalender");
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          tariff: expect.objectContaining({ payGroup: "P7", payLevel: 2 }),
        }),
      ),
    );
  });
  it.each([
    {
      label: "TVöD VKA · E-Tabelle",
      group: "E8",
      level: "Stufe 4",
      sector: true,
      region: TARIFF_REGION_LABELS.OTHER,
      key: "vkaETariff",
    },
    { label: "TV-L Pflege", group: "KR8", level: "Stufe 4", region: "West", key: "tvlKrTariff" },
    {
      label: "TV-H Pflege · Hessen",
      group: "KR5",
      level: "Stufe 1a",
      fulltime: true,
      key: "tvhKrTariff",
    },
    {
      label: "TV-UK Pflege · Baden-Württemberg",
      group: "PUK8",
      level: "Stufe 7",
      key: "tvUkNursingTariff",
    },
    {
      label: "TVAöD Pflege · Ausbildung",
      year: "2. Ausbildungsjahr",
      sector: true,
      region: TARIFF_REGION_LABELS.OTHER,
      key: "nursingTrainingTariff",
    },
    {
      label: "TVA-L Pflege · Ausbildung",
      year: "3. Ausbildungsjahr",
      region: "Ost",
      key: "tvalPflegeTariff",
    },
  ])("saves the selected $label profile", async (choice) => {
    const screen = await render(onboarding());
    await salary(screen, "30");
    await fireEvent.press(screen.getByRole("radio", { name: "Nach Tarif" }));
    await select(screen, "Tarifvertrag", choice.label);
    if (choice.group) await select(screen, "Entgeltgruppe", choice.group);
    if (choice.level) await select(screen, "Stufe", choice.level);
    if (choice.year) await select(screen, "Ausbildungsjahr", choice.year);
    if (choice.sector) await select(screen, "Tarifbereich", "Krankenhäuser · BT-K");
    if (choice.region) await select(screen, "Tarifgebiet", choice.region);
    if (choice.fulltime) await select(screen, "Tarifliche Vollzeit", "38,5 h");
    await summary(screen);
    await press(screen, "Zum Kalender");
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          [choice.key]: expect.any(Object),
          tariff: null,
          manualMonthlyGrossCents: null,
        }),
      ),
    );
  });
  it("accepts German gross and lets the user defer salary entirely", async () => {
    const screen = await render(onboarding());
    await salary(screen, "40");
    await fireEvent.press(screen.getByRole("radio", { name: "Eigenes Brutto" }));
    await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "3.450,50");
    await summary(screen);
    expect(screen.getByText("3.450,50 € brutto / Monat")).toBeTruthy();
    await press(screen, "Zum Kalender");
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          manualMonthlyGrossCents: 345050,
          tariff: null,
          weeklyMinutes: 2400,
        }),
      ),
    );
    expect(router.replace).toHaveBeenCalledWith("/");
  });
  it("clears incompatible details when switching tariff families", async () => {
    const screen = await render(onboarding());
    await salary(screen);
    await pTariff(screen);
    await select(screen, "Tarifvertrag", "TV-L Pflege");
    expect(screen.getByRole("button", { name: "Entgeltgruppe: Bitte auswählen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stufe: Bitte auswählen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Tarifbereich:/ })).toBeNull();
    await select(screen, "Entgeltgruppe", "KR8");
    await select(screen, "Stufe", "Stufe 4");
    await select(screen, "Tarifgebiet", "West");
    await summary(screen);
    await press(screen, "Zum Kalender");
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          tariff: null,
          vkaETariff: null,
          tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
        }),
      ),
    );
  });
  it("rejects scientific, overprecision and invalid manual gross", async () => {
    const screen = await render(onboarding());
    await salary(screen);
    await fireEvent.press(screen.getByRole("radio", { name: "Eigenes Brutto" }));
    for (const value of ["1e3", "3.450,501", "0", "100.000,01", "3.45,00"]) {
      await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), value);
      await press(screen, "Weiter");
      expect(screen.getByRole("alert")).toBeTruthy();
    }
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it("requires a workplace and validates hours while retaining the existing 38.5 default", async () => {
    const screen = await render(onboarding());
    await work(screen);
    expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("38,5");
    expect(screen.getByTestId("onboarding-percentage-value")).toHaveTextContent("100 %");
    await press(screen, "Weiter");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bitte wähle das Bundesland deines Arbeitsorts.",
    );
    await select(screen, "Bundesland deines Arbeitsorts", "Berlin");
    for (const value of ["", "1e1", "0,99", "80,01"]) {
      await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), value);
      await press(screen, "Weiter");
      expect(screen.getByTestId("onboarding-weekly-hours")).toHaveProp("aria-invalid", true);
    }
  });
  it("resets regional holidays when workplace changes and preserves summary editing", async () => {
    const screen = await render(onboarding());
    await work(screen, "Soziale Dienste");
    await select(screen, "Bundesland deines Arbeitsorts", "Bayern");
    await press(screen, "Weiter");
    expect(screen.getByRole("alert")).toHaveTextContent(/Feiertagsregion/);
    await select(screen, "Regionale Feiertage am Arbeitsort", "Stadt Augsburg");
    await select(screen, "Bundesland deines Arbeitsorts", "Sachsen");
    await press(screen, "Weiter");
    expect(screen.getByRole("alert")).toHaveTextContent(/Feiertagsregion/);
    await select(screen, "Regionale Feiertage am Arbeitsort", "Keine regionale Sonderregel");
    await press(screen, "Weiter");
    await fireEvent.press(screen.getByRole("radio", { name: "Später" }));
    await summary(screen);
    await press(screen, "Arbeitszeit bearbeiten");
    await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), "20");
    await press(screen, "Übernehmen");
    await press(screen, "Gehalt bearbeiten");
    expect(screen.getByRole("radio", { name: "Später" })).toBeChecked();
    await press(screen, "Übernehmen");
    await press(screen, "Zum Kalender");
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          industry: "SOCIAL_SERVICES",
          federalState: "SN",
          holidayRegion: "NONE",
          weeklyMinutes: 1200,
          tariff: null,
          manualMonthlyGrossCents: null,
        }),
      ),
    );
  });
  it("preserves real hours, percentage baseline and values across live themes", async () => {
    const screen = await render(onboarding(true));
    await work(screen);
    await select(screen, "100 % entsprechen", "40 h");
    const slider = screen.getByTestId("onboarding-percentage-slider");
    await fireEvent(slider, "layout", { nativeEvent: { layout: { width: 90 } } });
    await fireEvent(slider, "responderGrant", { nativeEvent: { locationX: 65, pageX: 65 } });
    await fireEvent(slider, "responderRelease", {});
    expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("30");
    await select(screen, "100 % entsprechen", "38,5 h");
    expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("30");
    expect(screen.getByTestId("onboarding-percentage-value")).toHaveTextContent("77,9 %");
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE]) {
      mockPalette = palette;
      await screen.rerender(onboarding(true));
      expect(screen.getByTestId("onboarding-primary-action")).toHaveStyle({
        backgroundColor: palette.accent,
      });
      expect(screen.getByText("Weiter")).toHaveStyle({ color: palette.onAccent });
      expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("30");
    }
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it.each(["preview", "existing"])("never writes data in %s mode", async (mode) => {
    mockProfile = mode === "existing" ? { federalState: "BY" } : null;
    const screen = await render(onboarding(mode === "preview"));
    await salary(screen);
    await fireEvent.press(screen.getByRole("radio", { name: "Später" }));
    await summary(screen);
    await press(screen, "Zum Kalender");
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("can close a preview immediately", async () => {
    const screen = await render(onboarding(true));
    await press(screen, "Testmodus schließen");
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });
  it("locks duplicate saves, keeps values on failure and permits retry", async () => {
    let rejectSave: (error: Error) => void = () => {};
    mockUpdateProfile.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const screen = await render(onboarding());
    await salary(screen);
    await fireEvent.press(screen.getByRole("radio", { name: "Später" }));
    await summary(screen);
    await press(screen, "Zum Kalender");
    expect(screen.getByTestId("onboarding-primary-action")).toBeDisabled();
    await fireEvent.press(screen.getByTestId("onboarding-primary-action"));
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error("Speicher nicht erreichbar")));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("38,5 h / Woche")).toBeTruthy();
    await press(screen, "Zum Kalender");
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(2));
  });
  it("keeps the shared hours and salary parsers compatible", () => {
    expect(parseWeeklyHours("38,5")).toBe(2310);
    expect(parseWeeklyHours("38.5")).toBe(2310);
    expect(normalizeOnboardingGross("3.450,50")).toBe("3450,50");
  });
});
