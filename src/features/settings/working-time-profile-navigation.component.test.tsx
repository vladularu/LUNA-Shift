import { fireEvent } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router, Stack } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Pressable, Text } from "react-native";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import { DARK_PALETTE } from "@/theme/palette-values";
import { work as mockWork } from "@/engine/remuneration-test-fixtures";
import {
  loadWorkingTimeTargetSettings,
  saveWorkingTimeTargetSettings,
} from "@/infrastructure/database/working-time-target-repository";
import { ProfileSelectionProvider } from "./profile-selection";
import { WorkingTimeProfileScreen } from "./working-time-profile-screen";

Object.assign(jest.requireMock<Record<string, unknown>>("react-native-reanimated"), {
  useReducedMotion: () => false,
});
const mockDb = {};
const mockPalette = DARK_PALETTE;
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({
    profile: { ...mockWork, federalState: "HE", holidayRegion: "NONE", weeklyMinutes: 2310 },
  }),
  usePflegeShiftEntries: () => ({ entries: [] }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({
    resolver:
      jest.requireActual<typeof import("@/rules/rule-resolver")>("@/rules/rule-resolver")
        .bundledRuleResolver,
  }),
}));
jest.mock("@/infrastructure/database/working-time-target-repository", () => ({
  loadWorkingTimeTargetSettings: jest.fn(),
  saveWorkingTimeTargetSettings: jest.fn(),
}));

const load = jest.mocked(loadWorkingTimeTargetSettings);
const save = jest.mocked(saveWorkingTimeTargetSettings);
const empty: WorkingTimeTargetSnapshot = {
  saved: null,
  context: undefined,
  staleDates: [],
  planRevision: "plan",
};

function Layout() {
  return (
    <ProfileSelectionProvider>
      <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }} />
    </ProfileSelectionProvider>
  );
}
function More() {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: "/working-time-profile", params: { origin: "settings" } })
      }
    >
      <Text>Sollzeitangaben öffnen</Text>
    </Pressable>
  );
}
async function openEditor() {
  const screen = await renderRouter({
    _layout: Layout,
    index: More,
    "working-time-profile": WorkingTimeProfileScreen,
  });
  await fireEvent.press(screen.getByRole("button", { name: "Sollzeitangaben öffnen" }));
  await screen.findByText("Sollarbeitszeit");
  return screen;
}

describe("working time overview with real Expo Router navigation", () => {
  beforeEach(() => {
    load.mockReset().mockResolvedValue(empty);
    save.mockReset().mockImplementation(async (_db, input) => ({
      ...empty,
      context: input.context,
      saved: {
        settings: { version: 1, context: input.context, planBindings: [] },
        revision: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    }));
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it("opens a quiet overview from More and leaves without saving", async () => {
    const screen = await openEditor();
    expect(screen.queryByLabelText("Stunden pro Woche")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zu Mehr" }));
    await screen.findByRole("button", { name: "Sollzeitangaben öffnen" });
    expect(save).not.toHaveBeenCalled();
  });
  it("opens and closes the explanation without navigating to any employment editor", async () => {
    const screen = await openEditor();
    await fireEvent.press(screen.getByText("So wird die Sollzeit berechnet"));
    expect(screen.getByText(/Monatsbasis:/)).toBeTruthy();
    expect(screen.queryByText("Deine Beschäftigung")).toBeNull();
    expect(screen.queryByText("Änderung eintragen")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zu Mehr" }));
    await screen.findByRole("button", { name: "Sollzeitangaben öffnen" });
    expect(save).not.toHaveBeenCalled();
  });
});
