import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";

import { SettingsInfoDetailsScreen } from "@/features/settings/settings-info-details-screen";
import { APP_RUNTIME_LABEL } from "@/infrastructure/app-version";

let mockParams: { section: string; tariff?: string } = { section: "STORAGE" };

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));

describe("SettingsInfoDetailsScreen visible information", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { section: "STORAGE" };
  });
  it("shows the privacy topics including optional private cloud without opening extra controls", async () => {
    const screen = await render(<SettingsInfoDetailsScreen />);
    expect(screen.getByText(/LUNA funktioniert offline und ohne Konto/)).toBeVisible();
    for (const title of [
      "Kein Konto erforderlich",
      "Kalender teilen ist optional",
      "Privates Cloud-Konto ist optional",
      "Backup selbst ablegen",
      "Löschen",
      "Ortssuche",
      "Karten",
      "Datenschutz",
    ])
      expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(/LUNA-Cloud gespeichert/)).toBeVisible();
    expect(screen.getByText(/mindestens 90 Tage/)).toBeVisible();
    expect(screen.getByText(/aktuelle GPS-Position/)).toBeVisible();
    expect(router.back).not.toHaveBeenCalled();
  });
  it("keeps sharing optional and explains its actual privacy boundaries directly", async () => {
    const screen = await render(<SettingsInfoDetailsScreen />);
    expect(
      screen.getByText(
        /Nur von dir ausgewählte Dienste, Termine und Notizen.*beim Erstellen der Einladung.*LUNA-Cloud gespeichert/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Orte, Gehalts- und Steuerdaten werden nicht in der Kalenderfreigabe geteilt/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Nach deiner ausdrücklichen Auswahl.*eigenen Daten.*Notizen, Gehalts- und Steuerangaben.*Kalenderfoto.*höchstens eine ältere Sicherung pro Tag.*30 Kalendertage/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Zum Teilen oder Annehmen einer Einladung brauchst du ein Konto.*Andere können die Inhalte nur ansehen.*Deine Freigaben kannst du jederzeit beenden.*offline höchstens 24 Stunden.*Erkennt LUNA einen Widerruf, entfernt sie den Kalender sofort/,
      ),
    ).toBeVisible();
    expect(router.back).not.toHaveBeenCalled();
  });
  it("shows the TV-L care allowance source through the existing information route", async () => {
    mockParams = { section: "CARE_ALLOWANCE", tariff: "TVL" };
    const screen = await render(<SettingsInfoDetailsScreen />);
    expect(screen.getByText(/Die allgemeine Pflegezulage für Pflegepersonen/)).toBeTruthy();
    expect(screen.getByText(/TV-L Entgeltordnung Anlage A/)).toBeTruthy();
    expect(screen.queryByText(/unterstütztes TVöD-P-Profil/)).toBeNull();
  });
  it("shows the own fixed TV-UK nursing allowance explanation", async () => {
    mockParams = { section: "CARE_ALLOWANCE", tariff: "TVUK" };
    const screen = await render(<SettingsInfoDetailsScreen />);
    expect(screen.getByText(/200 € bei Vollzeit/)).toBeTruthy();
    expect(screen.getByText(/P-UK6 bis P-UK15 einschließlich P-UK9L/)).toBeTruthy();
    expect(screen.getByText(/TV-UK-Entgelt, Anlage D Teil B/)).toBeTruthy();
    expect(screen.queryByText(/TV-L Entgeltordnung Anlage A/)).toBeNull();
  });
  it("shows backup limits and deletion retention before any interaction", async () => {
    const screen = await render(<SettingsInfoDetailsScreen />);
    expect(
      screen.getByText(
        /Gelöschte Dienste und Termine sind sofort ausgeblendet.*mindestens 90 Tage verschlüsselt auf dem Gerät.*Bei ausstehender Freigabeübertragung warten sie zusätzlich auf die Serverbestätigung.*Vorlagen bleiben gespeichert, solange Dienste oder ein offenes Testlabor-Backup sie benötigen/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Mehr → Datensicherung.*zusätzlich eine lokale Backup-Datei erstellen.*vor dem Wiederherstellen prüfen.*außerhalb der App sicher ablegen.*Eine Deinstallation kann lokale Daten löschen/,
      ),
    ).toBeVisible();
  });
  it("shows all calculation notes and the estimate boundary directly", async () => {
    mockParams = { section: "CALCULATION" };
    const screen = await render(<SettingsInfoDetailsScreen />);
    for (const title of [
      "Arbeitszeit",
      "Pausendauer",
      "Feiertage und Zuschläge",
      "Tarifüberstunden",
      "Schätzung statt Abrechnung",
    ])
      expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(/Arbeitszeiten aus allen Arbeitsverhältnissen/)).toBeVisible();
    expect(screen.getByText(/nur die gesamte Pausendauer/)).toBeVisible();
    expect(screen.getByText(/Überschneidungen werden minutengenau aufgeteilt/)).toBeVisible();
    expect(screen.getByText(/ausdrücklich als tariflich bestätigt/)).toBeVisible();
    expect(screen.getByText(/keine Lohnabrechnung oder Rechtsberatung/)).toBeVisible();
  });
  it("keeps the version directly readable without a disclosure", async () => {
    mockParams = { section: "ABOUT" };
    const screen = await render(<SettingsInfoDetailsScreen />);
    expect(screen.getByText("Version")).toBeVisible();
    expect(screen.getByText(APP_RUNTIME_LABEL)).toBeVisible();
    expect(screen.getByText("Produktprinzip")).toBeVisible();
    expect(screen.getByText(/ist eigenständig/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Version" })).toBeNull();
  });
  it.each([
    { section: "TVOED_ALLOWANCE", heading: "Geltungsbereich" },
    { section: "CARE_ALLOWANCE", heading: "Tarifprofil" },
  ])("keeps $section details directly readable", async ({ section, heading }) => {
    mockParams = { section };
    const screen = await render(<SettingsInfoDetailsScreen />);
    expect(screen.getByText(heading)).toBeVisible();
    expect(screen.queryByRole("button", { name: heading })).toBeNull();
    expect(screen.getByText(/unterstützte[s]? TVöD-P/)).toBeVisible();
  });
  it.each([{ section: "UNKNOWN" }, { section: "STORAGE", tariff: "UNKNOWN" }])(
    "closes invalid information links through the existing back action: %s",
    async (params) => {
      mockParams = params;
      const screen = await render(<SettingsInfoDetailsScreen />);
      expect(
        screen.getByText("Der Link zur Information enthält einen unbekannten Bereich."),
      ).toBeVisible();
      await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
      expect(router.back).toHaveBeenCalledTimes(1);
    },
  );
  it("closes directly through the original footer", async () => {
    const screen = await render(<SettingsInfoDetailsScreen />);
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: /^Zurück/ }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
  it("shows the requested information immediately after changing routes", async () => {
    const screen = await render(<SettingsInfoDetailsScreen />);
    mockParams = { section: "CALCULATION" };
    await screen.rerender(<SettingsInfoDetailsScreen />);
    expect(screen.getByText(/Arbeitszeiten aus allen Arbeitsverhältnissen/)).toBeVisible();
    expect(screen.queryByText(/LUNA-Cloud gespeichert/)).toBeNull();
    mockParams = { section: "STORAGE" };
    await screen.rerender(<SettingsInfoDetailsScreen />);
    expect(screen.getByText(/LUNA-Cloud gespeichert/)).toBeVisible();
  });
});

it("shows TV-H dates and eligible nursing groups via the existing info route", async () => {
  mockParams = { section: "CARE_ALLOWANCE", tariff: "TVH" };
  const screen = await render(<SettingsInfoDetailsScreen />);
  expect(screen.getByText(/142,22/)).toBeTruthy();
  expect(screen.getByText(/KR13 bis KR16/)).toBeTruthy();
  expect(screen.queryByText(/200 € bei Vollzeit/)).toBeNull();
});
