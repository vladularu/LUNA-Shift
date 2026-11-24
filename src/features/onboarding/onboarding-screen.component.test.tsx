import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import type { SQLiteDatabase } from "expo-sqlite";
import { AccessibilityInfo, Animated } from "react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { TARIFF_REGION_LABELS, type SaveProfileInput, type ShiftEntry } from "@/domain/types";
import { emptyWorkplaceData, rulesAt, type WorkplaceData } from "@/domain/workplace-rules";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { SALARY_BASIS_OPTIONS } from "@/features/settings/salary-basis-options";
import { CheckSettingsScreen } from "@/features/settings/check-settings-screen";
import { WorkplacePanel } from "@/features/workplace/panel";
import { WorkplaceDatabase } from "@/features/workplace/store";
import { OnboardingScreen, normalizeOnboardingGross, parseWeeklyHours } from "./onboarding-screen";
import { OnboardingStart } from "./onboarding-start";
import { MOTION } from "@/theme/motion";

jest.mock("@/ui/luna-choice-menu", () => jest.requireActual("@/ui/luna-choice-menu.tsx"));

const mockUpdateProfile = jest.fn<(input: SaveProfileInput) => Promise<void>>();
type ProviderLogin = () => Promise<{ id: string } | null>;
const mockApple = jest.fn<ProviderLogin>();
const mockGoogle = jest.fn<ProviderLogin>();
const mockAppleAvailable = jest.fn<() => Promise<boolean>>();
const mockRefreshAccount = jest.fn<() => Promise<void>>();
let mockCloudUser: { id: string } | null = null;
let mockAuthConfigured = true;
jest.mock("@/infrastructure/auth/sharing-auth", () => ({
  createSharingAuthPort: () => ({
    isConfigured: mockAuthConfigured,
    signInApple: mockApple,
    signInGoogle: mockGoogle,
  }),
  isSharingAppleSignInAvailable: () => mockAppleAvailable(),
}));
jest.mock("@/features/private-cloud/private-cloud-context", () => ({
  usePrivateCloud: () => ({
    ready: true,
    initializationError: null,
    user: mockCloudUser,
    refreshAccount: mockRefreshAccount,
  }),
}));
jest.mock("expo-apple-authentication", () => ({
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { WHITE: 1, BLACK: 0 },
  AppleAuthenticationButton: (props: { onPress: () => void }) => {
    const { Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Mit Apple fortfahren" {...props} />
    );
  },
}));
let mockProfile: object | null = null;
let mockPalette = LIGHT_PALETTE;
let mockEntries: ShiftEntry[] = [];
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile, updateProfile: mockUpdateProfile }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
}));
jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
}));
const metrics = {
  frame: { x: 0, y: 0, width: 430, height: 932 },
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
};
function appScreen(children: ReactNode, db: SQLiteDatabase | null = null) {
  return (
    <WorkplaceDatabase.Provider value={db}>
      <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
    </WorkplaceDatabase.Provider>
  );
}
function onboarding(preview = false, db?: SQLiteDatabase) {
  return appScreen(<OnboardingScreen preview={preview} />, db);
}
function workplaceDatabase(seed: WorkplaceData = emptyWorkplaceData) {
  let data = seed;
  const write = jest.fn(async (_sql: string, _key: string, value: string) => {
    data = JSON.parse(value);
  });
  const db = {
    getFirstAsync: async () => ({ value: JSON.stringify(data) }),
    execAsync: async () => {},
    runAsync: write,
  } as unknown as SQLiteDatabase;
  return { db, write, data: () => data };
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
async function salary(screen: Screen, hours = "38,5") {
  await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), hours);
  await select(screen, "Bundesland deines Arbeitsorts", "Nordrhein-Westfalen");
  await press(screen, "Weiter");
}
async function summary(screen: Screen) {
  if (
    !screen.queryByRole("header", { name: "Passt alles?" }) &&
    !screen.queryByRole("header", { name: "Sonderregelungen in deinem Betrieb" })
  )
    await press(
      screen,
      screen.queryByRole("button", { name: "Übernehmen" }) ? "Übernehmen" : "Weiter",
    );
  if (screen.queryByRole("button", { name: "Überspringen" })) await press(screen, "Überspringen");
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
  mockEntries = [];
  jest.clearAllMocks();
  mockUpdateProfile.mockReset();
  mockUpdateProfile.mockResolvedValue(undefined);
  mockAuthConfigured = true;
  mockCloudUser = null;
  mockApple.mockReset().mockResolvedValue({ id: "apple" });
  mockGoogle.mockReset().mockResolvedValue({ id: "google" });
  mockAppleAvailable.mockReset().mockResolvedValue(true);
  mockRefreshAccount.mockReset().mockResolvedValue(undefined);
});

it("offers existing cloud accounts before any local profile is created", async () => {
  const screen = await render(onboarding());
  await press(screen, "Schon ein Konto? Anmelden");
  expect(router.push).toHaveBeenCalledWith("/account");
  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

async function startWorkplaceQuestions(screen: Screen) {
  await salary(screen);
  await method(screen, "LATER");
  await press(screen, "Fragen starten");
  expect(screen.getByText("Hier zählt die Woche von Montag bis Sonntag.")).toBeOnTheScreen();
}

describe("optional workplace rules", () => {
  it.each([false, true])(
    "completes the shared questionnaire and respects preview mode (%s)",
    async (preview) => {
      const storage = workplaceDatabase();
      const screen = await render(onboarding(preview, storage.db));
      await startWorkplaceQuestions(screen);
      await fireEvent.press(screen.getByRole("radio", { name: "Feste Höchstzahl für jede Woche" }));
      await press(screen, "Weiter");
      await fireEvent.changeText(screen.getByLabelText("Anzahl Tage"), "1");
      await fireEvent.press(screen.getByRole("radio", { name: "Ja, das ist vereinbart" }));
      await fireEvent.press(screen.getByRole("radio", { name: "Für den gesamten Zeitraum" }));
      await press(screen, "Weiter");
      for (let i = 0; i < 6; i++) {
        await fireEvent.press(screen.getByRole("radio", { name: "Weiß ich nicht" }));
        await press(screen, "Weiter");
      }
      await fireEvent.press(screen.getByRole("radio", { name: "Weiß ich nicht" }));
      await press(screen, "Übernehmen");
      expect(screen.getByText("Passt alles?")).toBeOnTheScreen();
      expect(storage.write).not.toHaveBeenCalled();
      await press(screen, "Zum Kalender");

      if (preview) {
        expect(router.back).toHaveBeenCalled();
        expect(storage.write).not.toHaveBeenCalled();
        expect(mockUpdateProfile).not.toHaveBeenCalled();
        return;
      }

      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      expect(storage.write).toHaveBeenCalledTimes(1);
      expect(storage.data().handled).toBe(true);
      expect(rulesAt(storage.data().history, "2026-11-16").week).toMatchObject({
        mode: "limit",
        count: 1,
      });
      mockEntries = ["2026-11-16", "2026-11-17"].map(
        (date) =>
          ({
            kind: "SHIFT",
            id: date,
            date,
            title: "Frühdienst",
            type: "EARLY",
            color: "#336699",
            symbol: "sun",
            startTime: "06:00",
            endTime: "14:00",
            breakMinutes: 30,
            revision: 1,
            deletedAt: null,
          }) as ShiftEntry,
      );
      await screen.rerender(appScreen(<WorkplacePanel period="2026-11" />, storage.db));
      expect(await screen.findByText(/2 Arbeitstage seit/)).toBeVisible();
      expect(screen.queryByText("Fragen starten")).toBeNull();
      await screen.rerender(appScreen(<CheckSettingsScreen />, storage.db));
      await fireEvent.press(await screen.findByText("Sonderregelungen in deinem Betrieb"));
      await fireEvent.press(screen.getByText("Arbeitstage pro Woche"));
      await fireEvent.changeText(screen.getByLabelText("Anzahl Tage"), "2");
      await press(screen, "Änderung speichern");
      expect(rulesAt(storage.data().history, "2026-11-16").week).toMatchObject({ count: 2 });
    },
  );

  it("discards an unfinished questionnaire and offers it once on opening the check", async () => {
    const storage = workplaceDatabase();
    const screen = await render(onboarding(false, storage.db));
    await startWorkplaceQuestions(screen);
    await fireEvent.press(screen.getByRole("radio", { name: "Weiß ich nicht" }));
    await press(screen, "Weiter");
    await press(screen, "Überspringen");
    await press(screen, "Zum Kalender");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.data()).toEqual(emptyWorkplaceData);

    await screen.rerender(appScreen(<WorkplacePanel period="2026-11" />, storage.db));
    await fireEvent.press(await screen.findByText("Direkt zum Dienstplan-Check"));
    await waitFor(() => expect(storage.data().handled).toBe(true));
    await screen.rerender(appScreen(<WorkplacePanel key="reopened" period="2026" />, storage.db));
    await waitFor(() => expect(screen.queryByText("Direkt zum Dienstplan-Check")).toBeNull());
    expect(storage.write).toHaveBeenCalledTimes(1);
  });

  it("keeps existing completed rules when going through initial setup", async () => {
    const seed: WorkplaceData = {
      handled: true,
      exceptions: [],
      history: [
        {
          from: "2026-01-01",
          rules: { week: { mode: "limit", count: 6, source: "agreed", onRequest: false } },
        },
      ],
    };
    const storage = workplaceDatabase(seed);
    const screen = await render(onboarding(false, storage.db));
    await salary(screen);
    await method(screen, "LATER");
    expect(
      screen.getByText("Deine Angaben sind für den Dienstplan-Check erfasst."),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Fragen starten" })).toBeNull();
    await press(screen, "Weiter");
    await press(screen, "Zum Kalender");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.data()).toEqual(seed);
  });
});

describe("short onboarding with contextual salary", () => {
  it("starts with working time for hospital nursing and keeps the action outside scrolling", async () => {
    const screen = await render(onboarding());
    expect(screen.getByRole("header", { name: "Wie viel arbeitest du?" })).toHaveStyle({
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
    expect(screen.queryByRole("header", { name: "Wo arbeitest du?" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Berufsbereich" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Rettungsdienst" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("onboarding-weekly-hours")).toBeTruthy();
    await select(screen, "Bundesland deines Arbeitsorts", "Berlin");
    await press(screen, "Weiter");
    expect(screen.getByText("2 / 4")).toBeTruthy();
    await press(screen, "Später einrichten");
    expect(screen.getByRole("header", { name: "Sonderregelungen in deinem Betrieb" })).toBeTruthy();
    expect(screen.getByText("3 / 4")).toBeTruthy();
    await press(screen, "Überspringen");
    expect(screen.getByRole("header", { name: "Passt alles?" })).toBeTruthy();
    expect(screen.getByText("4 / 4")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Berufsbereich bearbeiten" })).toBeNull();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    await press(screen, "Zum Kalender");
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ industry: "HEALTHCARE", federalState: "BE" }),
      ),
    );
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
          industry: "HEALTHCARE",
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
    expect(screen.getByRole("button", { name: "Zurück" })).toBeDisabled();
    expect(screen.getByText("1 / 4")).toBeTruthy();
    await press(screen, "Weiter");
    expect(screen.getByRole("header", { name: "Wie hoch ist dein Monatsbrutto?" })).toBeTruthy();
    expect(screen.getByTestId("onboarding-manual-gross")).toHaveDisplayValue("3.450,50");
    await summary(screen);
    expect(screen.getByText("Bayern · Stadt Augsburg")).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
  it.each(["Gehalt", "Arbeitszeit", "Arbeitsort"])(
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
      if (field === "Gehalt") {
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

describe("Einrichtungsplan in der Preview", () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it.each([false, true])(
    "accepts rules first, then working time, with optional salary (test mode %s)",
    async (preview) => {
      const storage = workplaceDatabase();
      const screen = await render(
        appScreen(<OnboardingScreen setupPlan preview={preview} />, storage.db),
      );
      expect(screen.getByTestId("onboarding-brand-image")).toBeVisible();
      expect(screen.getByRole("header", { name: "Willkommen bei LUNA Shift" })).toBeVisible();
      await press(screen, "Los geht’s");
      expect(screen.queryByTestId("onboarding-brand-image")).toBeNull();
      await press(screen, "Sonderregelungen in deinem Betrieb");
      await press(screen, "Fragen starten");
      expect(screen.getByText("Hier zählt die Woche von Montag bis Sonntag.")).toBeOnTheScreen();
      for (let n = 0; n < 12 && !screen.queryByText("Dein Einrichtungsplan"); n++) {
        await fireEvent.press(screen.getByRole("radio", { name: "Weiß ich nicht" }));
        await fireEvent.press(screen.getByTestId("onboarding-primary-action"));
      }
      expect(
        screen.getByRole("progressbar", { name: "1 von 3 Bereichen eingerichtet" }),
      ).toBeVisible();
      await press(screen, "Arbeitszeit einrichten");
      await press(screen, "Übernehmen");
      expect(screen.getByText("Bitte wähle das Bundesland deines Arbeitsorts.")).toBeOnTheScreen();
      await select(screen, "Bundesland deines Arbeitsorts", "Nordrhein-Westfalen");
      await press(screen, "Übernehmen");
      await press(screen, "Weiter zum Gehalt");
      await press(screen, "Später einrichten");
      await press(screen, "Zur Zusammenfassung");
      expect(storage.write).not.toHaveBeenCalled();
      await press(screen, "Weiter zur Startauswahl");
      await press(screen, "Als Gast starten");
      expect(mockApple).not.toHaveBeenCalled();
      expect(mockGoogle).not.toHaveBeenCalled();
      if (preview) {
        expect(router.back).toHaveBeenCalled();
        expect(mockUpdateProfile).not.toHaveBeenCalled();
        expect(storage.write).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
        expect(storage.data().handled).toBe(true);
        expect(mockUpdateProfile).toHaveBeenCalledWith(
          expect.objectContaining({ manualMonthlyGrossCents: null, weeklyMinutes: 2310 }),
        );
      }
    },
  );

  it("returns to the plan on cancel and keeps a skipped workplace questionnaire available", async () => {
    const storage = workplaceDatabase();
    const screen = await render(appScreen(<OnboardingScreen setupPlan />, storage.db));
    await press(screen, "Los geht’s");
    await press(screen, "Gehalt");
    await method(screen, "MANUAL");
    await fireEvent.changeText(screen.getByTestId("onboarding-manual-gross"), "3500");
    await press(screen, "Übernehmen");
    await press(screen, "Sonderregelungen in deinem Betrieb");
    await press(screen, "Überspringen");
    await waitFor(() => expect(screen.getByText("Später im Dienstplan-Check")).toBeVisible());
    await press(screen, "Arbeitszeit & Arbeitsort");
    await select(screen, "Bundesland deines Arbeitsorts", "Nordrhein-Westfalen");
    await press(screen, "Übernehmen");
    await press(screen, "Arbeitszeit & Arbeitsort");
    await fireEvent.changeText(screen.getByTestId("onboarding-weekly-hours"), "12");
    await press(screen, "Zurück");
    await waitFor(() => expect(screen.getByText(/38,5 h · Nordrhein-Westfalen/)).toBeVisible());
    await press(screen, "Zur Zusammenfassung");
    await press(screen, "Weiter zur Startauswahl");
    await press(screen, "Als Gast starten");
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ manualMonthlyGrossCents: 350000, weeklyMinutes: 2310 }),
      ),
    );
    expect(storage.write).not.toHaveBeenCalled();
    await screen.rerender(appScreen(<WorkplacePanel period="2026-11" />, storage.db));
    expect(await screen.findByText("Direkt zum Dienstplan-Check")).toBeVisible();
  });

  it("shows existing rules as set up and keeps them when reviewing or skipping edits", async () => {
    const seed: WorkplaceData = {
      handled: true,
      exceptions: [],
      history: [
        {
          from: "2026-01-01",
          rules: { week: { mode: "limit", count: 6, source: "agreed", onRequest: false } },
        },
      ],
    };
    const storage = workplaceDatabase(seed);
    const screen = await render(appScreen(<OnboardingScreen setupPlan />, storage.db));
    await press(screen, "Los geht’s");
    await screen.findByText("Angaben erfasst");
    await press(screen, "Arbeitszeit einrichten");
    await select(screen, "Bundesland deines Arbeitsorts", "Nordrhein-Westfalen");
    await press(screen, "Übernehmen");
    await press(screen, "Weiter zum Gehalt");
    await press(screen, "Später einrichten");
    const header = screen.getByTestId("onboarding-header");
    const viewport = screen.getByTestId("onboarding-scroll-content");
    const footer = screen.getByTestId("onboarding-fixed-footer");
    expect(header).toHaveStyle({ paddingTop: metrics.insets.top });
    await press(screen, "Zur Zusammenfassung");
    expect(screen.getByTestId("onboarding-header")).toBe(header);
    expect(screen.getByTestId("onboarding-scroll-content")).toBe(viewport);
    expect(screen.getByTestId("onboarding-fixed-footer")).toBe(footer);
    await press(screen, "Zurück");
    expect(screen.getByTestId("onboarding-header")).toBe(header);
    await press(screen, "Zur Zusammenfassung");
    const backGlyph = within(screen.getByRole("button", { name: "Zurück" })).getByText("‹");
    const glyphStyle = backGlyph.props.style;
    await press(screen, "Weiter zur Startauswahl");
    expect(screen.getByTestId("onboarding-header")).toHaveStyle({ paddingTop: metrics.insets.top });
    expect(
      within(screen.getByRole("button", { name: "Zurück" })).getByText("‹").props.style,
    ).toEqual(glyphStyle);
    await press(screen, "Zurück");
    await press(screen, "Sonderregelungen in deinem Betrieb bearbeiten");
    await press(screen, "Fragen starten");
    expect(
      screen.getByRole("radio", { name: "Feste Höchstzahl für jede Woche", checked: true }),
    ).toBeOnTheScreen();
    await press(screen, "Weiter");
    expect(screen.getByLabelText("Anzahl Tage").props.value).toBe("6");
    await press(screen, "Überspringen");
    await press(screen, "Weiter zur Startauswahl");
    await press(screen, "Als Gast starten");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.data()).toEqual(seed);
  });
  it.each([
    { preview: false, provider: "Apple" },
    { preview: false, provider: "Google" },
    { preview: true, provider: "Apple" },
    { preview: true, provider: "Google" },
  ])(
    "starts $provider directly after the guided steps (test mode $preview)",
    async ({ preview, provider }) => {
      const storage = workplaceDatabase();
      const screen = await render(
        appScreen(<OnboardingScreen setupPlan preview={preview} />, storage.db),
      );
      await press(screen, "Los geht’s");
      await press(screen, "Zurück");
      await press(screen, "Los geht’s");
      await press(screen, "Arbeitszeit einrichten");
      await select(screen, "Bundesland deines Arbeitsorts", "Hessen");
      await press(screen, "Übernehmen");
      await press(screen, "Weiter zum Gehalt");
      await press(screen, "Später einrichten");
      await press(screen, "Weiter zu den Sonderregelungen");
      await press(screen, "Überspringen");
      await press(screen, "Zur Zusammenfassung");
      await press(screen, "Weiter zur Startauswahl");
      await press(screen, "Zurück");
      await press(screen, "Weiter zur Startauswahl");
      expect(screen.getByRole("header", { name: "Mit Konto starten" })).toBeVisible();
      expect(screen.queryByTestId("onboarding-brand-image")).toBeNull();
      expect(mockUpdateProfile).not.toHaveBeenCalled();
      const login = provider === "Apple" ? mockApple : mockGoogle;
      login.mockResolvedValueOnce(null);
      const button = "Mit " + provider + " fortfahren";
      await press(screen, button);
      expect(mockUpdateProfile).not.toHaveBeenCalled();
      expect(mockRefreshAccount).not.toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Als Gast starten" })).toBeEnabled();
      await press(screen, button);
      expect(login).toHaveBeenCalledTimes(2);
      expect(mockRefreshAccount).toHaveBeenCalledTimes(1);
      expect(router.push).not.toHaveBeenCalled();
      if (preview) {
        expect(mockUpdateProfile).not.toHaveBeenCalled();
        expect(router.back).toHaveBeenCalledTimes(1);
      } else {
        expect(mockUpdateProfile).toHaveBeenCalledWith(
          expect.objectContaining({ federalState: "HE" }),
        );
        expect(router.replace).toHaveBeenCalledWith("/");
      }
      expect(storage.write).not.toHaveBeenCalled();
    },
  );
  it("shows the test note only in the explicit onboarding preview", async () => {
    const props = {
      testMode: true,
      reducedMotion: true,
      onBack: jest.fn(),
      onFinish: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const note = /Deine Testangaben werden verworfen/;
    const screen = await render(appScreen(<OnboardingStart {...props} />));
    expect(screen.queryByText(note)).toBeNull();
    expect(screen.getByText("Melde dich an, um deine Daten zu synchronisieren.")).toBeVisible();
    await screen.rerender(appScreen(<OnboardingStart {...props} preview />));
    expect(screen.getByText(note)).toBeVisible();
    await screen.rerender(appScreen(<OnboardingStart {...props} testMode={false} />));
    expect(screen.queryByText(note)).toBeNull();
  });
  it("retains the guest action when sign-in is unavailable", async () => {
    mockAuthConfigured = false;
    mockAppleAvailable.mockResolvedValue(false);
    const finish = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const screen = await render(
      appScreen(<OnboardingStart testMode reducedMotion onBack={jest.fn()} onFinish={finish} />),
    );
    expect(screen.queryByRole("button", { name: "Mit Apple fortfahren" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mit Google fortfahren" })).toBeDisabled();
    await press(screen, "Als Gast starten");
    expect(finish).toHaveBeenCalledTimes(1);
  });
  it("keeps the page usable after a provider error and serializes rapid taps", async () => {
    const finish = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    let reject!: (reason: Error) => void;
    mockGoogle.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const screen = await render(
      appScreen(<OnboardingStart testMode reducedMotion onBack={jest.fn()} onFinish={finish} />),
    );
    await press(screen, "Mit Google fortfahren");
    await press(screen, "Mit Google fortfahren");
    await press(screen, "Mit Apple fortfahren");
    await press(screen, "Als Gast starten");
    expect(mockGoogle).toHaveBeenCalledTimes(1);
    expect(mockApple).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    await act(async () => reject(new Error("provider offline")));
    expect(screen.getByRole("alert")).toBeVisible();
    await press(screen, "Als Gast starten");
    expect(finish).toHaveBeenCalledTimes(1);
  });
  it("retains the current signed-in account during a replay and when retrying setup", async () => {
    mockCloudUser = { id: "current" };
    const finish = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const screen = await render(
      appScreen(<OnboardingStart testMode reducedMotion onBack={jest.fn()} onFinish={finish} />),
    );
    await press(screen, "Mit Google fortfahren");
    expect(mockGoogle).not.toHaveBeenCalled();
    await screen.rerender(
      appScreen(
        <OnboardingStart
          testMode={false}
          reducedMotion
          onBack={jest.fn()}
          onFinish={finish}
          saveError="Bitte erneut versuchen."
        />,
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte erneut versuchen.");
    await press(screen, "Mit diesem Konto fortfahren");
    expect(finish).toHaveBeenCalledTimes(2);
  });
  it("reveals the illustration before the sign-in sheet and reserves the Apple row while probing iOS", async () => {
    let available!: (value: boolean) => void;
    mockAppleAvailable.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          available = resolve;
        }),
    );
    const timing = jest.spyOn(Animated, "timing");
    let complete: Parameters<Animated.CompositeAnimation["start"]>[0];
    const sequence = jest.spyOn(Animated, "sequence").mockReturnValue({
      start: (callback) => {
        complete = callback;
      },
      stop: jest.fn(),
      reset: jest.fn(),
    });
    const screen = await render(
      appScreen(
        <OnboardingStart
          testMode
          reducedMotion={false}
          onBack={jest.fn()}
          onFinish={jest.fn<() => Promise<void>>()}
        />,
      ),
    );
    const sheet = screen.getByTestId("onboarding-start-sheet", { includeHiddenElements: true });
    expect(sheet).toHaveStyle({ opacity: 0 });
    expect(sheet.props.pointerEvents).toBe("none");
    expect(screen.queryByRole("button", { name: "Als Gast starten" })).toBeNull();
    const heroIndex = timing.mock.calls.findIndex(
      ([, config]) => config.duration === MOTION.duration.normal,
    );
    const sheetIndex = timing.mock.calls.findIndex(
      ([, config]) => config.duration === MOTION.duration.deliberate,
    );
    expect(sequence).toHaveBeenCalledWith([
      timing.mock.results[heroIndex].value,
      timing.mock.results[sheetIndex].value,
    ]);
    const reservedHeight = screen.getByTestId("onboarding-apple-placeholder", {
      includeHiddenElements: true,
    }).props.style.height;
    await act(async () => available(true));
    expect(
      screen.queryByTestId("onboarding-apple-placeholder", { includeHiddenElements: true }),
    ).toBeNull();
    await act(async () => complete?.({ finished: true }));
    expect(
      screen.getByRole("button", { name: "Mit Apple fortfahren", includeHiddenElements: true }),
    ).toHaveStyle({ height: reservedHeight });
    expect(sheet.props.pointerEvents).toBe("auto");
    expect(sequence).toHaveBeenCalledTimes(1);
  });
  it("shows the final sheet immediately for reduced motion", async () => {
    const sequence = jest.spyOn(Animated, "sequence");
    const screen = await render(
      appScreen(
        <OnboardingStart
          testMode
          reducedMotion
          onBack={jest.fn()}
          onFinish={jest.fn<() => Promise<void>>()}
        />,
      ),
    );
    expect(screen.getByTestId("onboarding-start-sheet")).toHaveStyle({
      opacity: 1,
      transform: [{ translateY: 0 }],
    });
    expect(screen.getByRole("button", { name: "Als Gast starten" })).toBeVisible();
    expect(sequence).not.toHaveBeenCalled();
  });
});
