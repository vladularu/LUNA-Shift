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
jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
}));
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
async function method(screen: Screen, mode: "TARIFF" | "MANUAL" | "LATER") {
  if (mode === "LATER") {
    await press(screen, "Später einrichten");
    return;
  }
  const name = mode === "TARIFF" ? "Nach Tarif" : "Brutto eingeben";
  if (!screen.queryByRole("button", { name })) await press(screen, "Gehaltsgrundlage");
  await press(screen, name);
}
async function returnToWork(screen: Screen) {
  for (let i = 0; i < 4 && !screen.queryByTestId("onboarding-weekly-hours"); i++)
    await press(screen, "Zurück");
  expect(screen.getByTestId("onboarding-weekly-hours")).toBeTruthy();
}
async function select(screen: Screen, field: string, option: string) {
  if (field === "Tarifvertrag") {
    if (screen.queryByRole("button", { name: "Tarif wechseln" }))
      await press(screen, "Tarif wechseln");
    await press(screen, option.includes("Ausbildung") ? "Ausbildung" : "Beruf");
    await press(screen, option);
    return;
  }
  await press(screen, new RegExp("^" + field + ":"));
  await fireEvent.press(screen.getByRole("radio", { name: option }));
}
async function work(screen: Screen, industry = "Pflege & Gesundheitswesen") {
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
  if (!screen.queryByRole("header", { name: "Passt alles?" }))
    await press(
      screen,
      screen.queryByRole("button", { name: "Übernehmen" }) ? "Übernehmen" : "Weiter",
    );
  expect(screen.getByText("Passt alles?")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Schritt 4 von 4" })).toHaveAccessibilityValue({
    min: 1,
    max: 4,
    now: 4,
  });
}
async function pTariff(screen: Screen, group = "P8", level = "Stufe 4") {
  await method(screen, "TARIFF");
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

it("offers existing cloud accounts before any local profile is created", async () => {
  const screen = await render(onboarding());
  await press(screen, "Schon ein Konto? Anmelden");
  expect(router.push).toHaveBeenCalledWith("/account");
  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

describe("short onboarding with contextual salary", () => {
  it("places work before salary, keeps the action outside scrolling and requires deliberate choices", async () => {
    const screen = await render(onboarding());
    expect(screen.getByRole("header", { name: "Wo arbeitest du?" })).toHaveStyle({
      textAlign: "left",
    });
    expect(screen.getByText("Schichtdienst ist kompliziert genug.")).toBeTruthy();
    expect(screen.getByText("Dein Dienstplan sollte es nicht sein.")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Schritt 1 von 4" })).toHaveAccessibilityValue({
      min: 1,
      max: 4,
      now: 1,
    });
    expect(screen.getByRole("button", { name: "Zurück" })).toBeDisabled();
    expect(
      within(screen.getByTestId("onboarding-scroll-content")).queryByTestId(
        "onboarding-primary-action",
      ),
    ).toBeNull();
    expect(
      within(screen.getByTestId("onboarding-fixed-footer")).getByRole("button", {
        name: "Weiter",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Los geht’s" })).toBeNull();
    screen.getAllByRole("radio").forEach((radio) => expect(radio).not.toBeChecked());
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Rettungsdienst" }));
    await press(screen, "Weiter");
    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(screen.getByTestId("onboarding-weekly-hours")).toBeTruthy();
    await select(screen, "Bundesland deines Arbeitsorts", "Berlin");
    await press(screen, "Weiter");
    expect(screen.getByText("3 / 4")).toBeTruthy();
    await press(screen, "Später einrichten");
    expect(screen.getByRole("header", { name: "Passt alles?" })).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it("uses the same tariff options as settings and does not select a tariff automatically", async () => {
    const screen = await render(onboarding());
    await salary(screen);
    await method(screen, "TARIFF");
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();
    for (const category of ["Beruf", "Ausbildung"]) {
      await press(screen, category);
      for (const option of SALARY_BASIS_OPTIONS.filter(
        (item) =>
          !["UNSET", "MANUAL"].includes(item.value) &&
          ("group" in item && item.group === "Ausbildung") === (category === "Ausbildung"),
      )) {
        const label = "selectionLabel" in option ? option.selectionLabel : option.label;
        expect(screen.getByRole("button", { name: label }).props.accessibilityState.selected).toBe(
          false,
        );
      }
    }
    expect(mockUpdateProfile).not.toHaveBeenCalled();
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
    await returnToWork(screen);
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
    await method(screen, "TARIFF");
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
    await method(screen, "MANUAL");
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
    await method(screen, "MANUAL");
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
    await method(screen, "LATER");
    await summary(screen);
    await press(screen, "Arbeitszeit bearbeiten");
    await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), "20");
    await press(screen, "Übernehmen");
    await press(screen, "Gehalt bearbeiten");
    expect(screen.getByRole("button", { name: "Später einrichten" })).toBeTruthy();
    await press(screen, "Später einrichten");
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
  it("retains the complete draft when going back through the input pages", async () => {
    const screen = await render(onboarding());
    await work(screen, "Soziale Dienste");
    await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), "30");
    await select(screen, "Bundesland deines Arbeitsorts", "Bayern");
    await select(screen, "Regionale Feiertage am Arbeitsort", "Stadt Augsburg");
    await press(screen, "Weiter");
    await method(screen, "MANUAL");
    await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "3.450,50");
    await returnToWork(screen);
    expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("30");
    expect(
      screen.getByRole("button", { name: "Regionale Feiertage am Arbeitsort: Stadt Augsburg" }),
    ).toBeTruthy();
    await press(screen, "Zurück");
    expect(screen.getByRole("radio", { name: "Soziale Dienste" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Zurück" })).toBeDisabled();
    await press(screen, "Weiter");
    expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("30");
    await press(screen, "Weiter");
    expect(screen.getByRole("header", { name: "Wie hoch ist dein Monatsbrutto?" })).toBeTruthy();
    expect(screen.getByTestId("onboarding-manual-gross")).toHaveDisplayValue("3.450,50");
    await summary(screen);
    expect(screen.getByText("Bayern · Stadt Augsburg")).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it.each(["Berufsbereich", "Gehalt", "Arbeitszeit", "Arbeitsort"])(
    "returns directly from the %s correction to the summary with the updated draft",
    async (field) => {
      const screen = await render(onboarding());
      await salary(screen, "30");
      await method(screen, "MANUAL");
      await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "3.450,50");
      await summary(screen);
      await press(screen, `${field} bearbeiten`);
      const payload = {
        industry: "HEALTHCARE",
        weeklyMinutes: 1800,
        federalState: "NW",
        manualMonthlyGrossCents: 345050,
      };
      let expectedSummary = "";
      if (field === "Berufsbereich") {
        expect(screen.getByRole("radio", { name: "Pflege & Gesundheitswesen" })).toBeChecked();
        expect(screen.getByRole("button", { name: "Zurück" })).not.toBeDisabled();
        await fireEvent.press(screen.getByRole("radio", { name: "Rettungsdienst" }));
        payload.industry = "EMERGENCY_SERVICES";
        expectedSummary = "Rettungsdienst";
      } else if (field === "Gehalt") {
        expect(screen.getByTestId("onboarding-manual-gross")).toHaveDisplayValue("3.450,50");
        await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "4.000,00");
        payload.manualMonthlyGrossCents = 400000;
        expectedSummary = "4.000,00 € brutto / Monat";
      } else if (field === "Arbeitszeit") {
        expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("30");
        await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), "20");
        payload.weeklyMinutes = 1200;
        expectedSummary = "20 h / Woche";
      } else {
        expect(
          screen.getByRole("button", {
            name: "Bundesland deines Arbeitsorts: Nordrhein-Westfalen",
          }),
        ).toBeTruthy();
        await select(screen, "Bundesland deines Arbeitsorts", "Berlin");
        payload.federalState = "BE";
        expectedSummary = "Berlin";
      }
      await press(screen, "Übernehmen");
      expect(screen.getByText("Passt alles?")).toBeTruthy();
      expect(screen.getByText(expectedSummary)).toBeTruthy();
      await press(screen, `${field} bearbeiten`);
      await press(screen, "Übernehmen");
      expect(screen.getByText(expectedSummary)).toBeTruthy();
      expect(mockUpdateProfile).not.toHaveBeenCalled();
      await press(screen, "Zum Kalender");
      await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
      expect(mockUpdateProfile).toHaveBeenCalledWith(expect.objectContaining(payload));
    },
  );
  it("validates corrections on apply and cancels an invalid draft on back", async () => {
    const screen = await render(onboarding());
    await salary(screen);
    await method(screen, "MANUAL");
    await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "3.450,50");
    await summary(screen);
    await press(screen, "Arbeitszeit bearbeiten");
    await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), "0");
    await press(screen, "Übernehmen");
    expect(screen.getByTestId("onboarding-weekly-hours")).toHaveProp("aria-invalid", true);
    await press(screen, "Zurück");
    expect(screen.getByText("38,5 h / Woche")).toBeTruthy();
    await press(screen, "Gehalt bearbeiten");
    await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "1e3");
    await press(screen, "Übernehmen");
    expect(screen.getByTestId("onboarding-manual-gross")).toHaveProp("aria-invalid", true);
    await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "3.600,00");
    await press(screen, "Übernehmen");
    expect(screen.getByText("3.600,00 € brutto / Monat")).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it("lets an explicit salary deferral ignore unfinished salary drafts", async () => {
    const screen = await render(onboarding());
    await salary(screen);
    await pTariff(screen);
    await method(screen, "MANUAL");
    await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "1e3");
    await method(screen, "LATER");
    await summary(screen);
    expect(screen.getByText("Später einrichten")).toBeTruthy();
    await press(screen, "Zum Kalender");
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tariff: null, manualMonthlyGrossCents: null }),
    );
    expect(router.replace).toHaveBeenCalledTimes(1);
  });
  it("rechecks tariff hours after a summary correction before saving", async () => {
    const screen = await render(onboarding());
    await salary(screen, "30");
    await method(screen, "TARIFF");
    await select(screen, "Tarifvertrag", "TV-H Pflege · Hessen");
    await select(screen, "Entgeltgruppe", "KR5");
    await select(screen, "Stufe", "Stufe 1a");
    await select(screen, "Tarifliche Vollzeit", "38,5 h");
    await summary(screen);
    await press(screen, "Arbeitszeit bearbeiten");
    await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), "40");
    await press(screen, "Übernehmen");
    await press(screen, "Zum Kalender");
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entgeltgruppe: KR5" })).toBeTruthy();
    await method(screen, "LATER");
    await press(screen, "Zum Kalender");
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ weeklyMinutes: 2400, tariff: null, manualMonthlyGrossCents: null }),
    );
  });
  it("keeps successful completion terminal until the screen unmounts", async () => {
    let resolveSave: () => void = () => {};
    mockUpdateProfile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const screen = await render(onboarding());
    await salary(screen);
    await method(screen, "LATER");
    await summary(screen);
    await press(screen, "Zum Kalender");
    await act(async () => resolveSave());
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId("onboarding-primary-action"));
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledTimes(1);
    await press(screen, "Zurück");
    expect(screen.getByText("Passt alles?")).toBeTruthy();
    await press(screen, "Gehalt bearbeiten");
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByText("Passt alles?")).toBeTruthy();
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
    expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("28,88");
    expect(screen.getByTestId("onboarding-percentage-value")).toHaveTextContent("75 %");
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE]) {
      mockPalette = palette;
      await screen.rerender(onboarding(true));
      expect(screen.getByTestId("onboarding-primary-action")).toHaveStyle({
        backgroundColor: palette.accent,
      });
      expect(screen.getByText("Weiter")).toHaveStyle({ color: palette.onAccent });
      expect(screen.getByTestId("onboarding-weekly-hours")).toHaveDisplayValue("28,88");
    }
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it.each(["preview", "existing"])("never writes data in %s mode", async (mode) => {
    mockProfile = mode === "existing" ? { federalState: "BY" } : null;
    const screen = await render(onboarding(mode === "preview"));
    await salary(screen);
    await method(screen, "LATER");
    await summary(screen);
    await press(screen, "Zum Kalender");
    await press(screen, "Zum Kalender");
    await press(screen, "Testmodus schließen");
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("can close a preview immediately", async () => {
    const screen = await render(onboarding(true));
    await press(screen, "Testmodus schließen");
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
    await method(screen, "LATER");
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
  it("saves TVA-L workplace in the existing tariff step without another question page", async () => {
    const screen = await render(onboarding());
    await salary(screen, "30");
    await method(screen, "TARIFF");
    await select(screen, "Tarifvertrag", "TVA-L Pflege · Ausbildung");
    await select(screen, "Ausbildungsjahr", "2. Ausbildungsjahr");
    await select(screen, "Tarifgebiet", "West");
    await select(screen, "Arbeitsbereich", "Krankenhaus / ärztliche Behandlung");
    await summary(screen);
    await press(screen, "Zum Kalender");
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        tvalPflegeTariff: {
          trainingYear: 2,
          universityRegion: "WEST",
          employerScope: "SECTION_43",
        },
      }),
    );
  });
});
