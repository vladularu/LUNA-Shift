import { SafeAreaProvider } from "react-native-safe-area-context";
import { expect } from "@jest/globals";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { SettingsEditorScreen } from "./settings-editor-screen";
import {
  ProfileSelectionProvider,
  ProfileSelectionScreen,
  useProfileSelection,
} from "./profile-selection";
type Screen = Awaited<ReturnType<typeof render>>;
function SelectionTestPage() {
  const { request } = useProfileSelection();
  return request ? <ProfileSelectionScreen /> : null;
}
export function SettingsEditorTestFlow({ children }: { readonly children?: React.ReactNode } = {}) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, right: 0, bottom: 34, left: 0 },
      }}
    >
      <ProfileSelectionProvider>
        {children ?? <SettingsEditorScreen />}
        <SelectionTestPage />
      </ProfileSelectionProvider>
    </SafeAreaProvider>
  );
}
export async function selectSettingsChoice(screen: Screen, field: string, option: string) {
  if (field === "Berechnung" && option === "Monatsbrutto selbst eintragen") {
    await fireEvent.press(screen.getByRole("radio", { name: "Eigenes Brutto" }));
    return [];
  }
  const mapped =
    field === "Berechnung"
      ? "Tarifvertrag"
      : field === "Tarifgebiet"
        ? "Tarifregion"
        : field === "Tarifbereich"
          ? "Einrichtung"
          : field === "Tarifliche Vollzeit pro Woche"
            ? "Vollzeit laut Tarif"
            : field;
  const next =
    field === "Tarifbereich"
      ? option
          .replace("Krankenhaus · BT-K", "Krankenhaus (BT-K)")
          .replace("Pflege · BT-B", "Pflegeeinrichtung (BT-B)")
      : field === "Tarifliche Vollzeit pro Woche"
        ? `${option} Std.`
        : option;
  const picker = screen.queryByTestId(`profile-native-options:${mapped}`);
  if (picker) {
    const options = within(picker);
    const target = options.getByTestId(`profile-native-option:${next}`);
    const [{ tag }] = target.props.modifiers;
    await fireEvent(picker, "selectionChange", { nativeEvent: { selection: tag } });
    return options.getAllByTestId(/^profile-native-option:/).map((choice) => {
      const label = (choice.props.testID as string).slice("profile-native-option:".length);
      return field === "Tarifliche Vollzeit pro Woche" ? label.replace(" Std.", "") : label;
    });
  }
  await fireEvent.press(screen.getByRole("button", { name: new RegExp(`^${mapped}:`) }));
  const page = within(screen.getByTestId("profile-selection-content"));
  const choices = page
    .getAllByRole("button")
    .filter((button) => typeof button.props.accessibilityState?.selected === "boolean")
    .map((button) => button.props.accessibilityLabel as string);
  await fireEvent.press(page.getByRole("button", { name: next }));
  await waitFor(() => expect(screen.queryByTestId("profile-selection-content")).toBeNull());
  return field === "Tarifliche Vollzeit pro Woche"
    ? choices.map((label) => label.replace(" Std.", ""))
    : choices;
}

export async function chooseTariffGroup(screen: Screen, tariff: string) {
  const group =
    tariff === "TVöD-P"
      ? "P8"
      : tariff === "TVöD VKA · E-Tabelle"
        ? "E9b"
        : tariff.startsWith("TV-UK")
          ? "P-UK8"
          : "KR8";
  await selectSettingsChoice(screen, "Entgeltgruppe", group);
}
export async function chooseTariffDetails(screen: Screen, tariff: string) {
  if (tariff.startsWith("TVA"))
    await selectSettingsChoice(screen, "Ausbildungsjahr", "2. Ausbildungsjahr");
  else {
    await chooseTariffGroup(screen, tariff);
    await selectSettingsChoice(screen, "Stufe", "Stufe 4");
  }
}

export async function saveSettingsChoice(screen: Screen) {
  await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
  if (screen.queryByText("Seit wann gelten diese Angaben?")) {
    await fireEvent.press(screen.getByRole("radio", { name: "Für den gesamten Zeitraum" }));
    await fireEvent.press(screen.getByRole("button", { name: "Gesamten Zeitraum berichtigen" }));
  }
}

export async function closeSettingsSave(screen: Screen) {
  await fireEvent.press(screen.getByRole("button", { name: "Zurück zu deinen Angaben" }));
  await waitFor(() => expect(screen.queryByText("Seit wann gelten diese Angaben?")).toBeNull());
}
