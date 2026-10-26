import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import { work as mockWork, shift as enteredShift } from "@/engine/remuneration-test-fixtures";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import {
  loadWorkingTimeTargetSettings,
  saveWorkingTimeTargetSettings,
} from "@/infrastructure/database/working-time-target-repository";
import { ProfileSelectionProvider } from "./profile-selection";
import { WorkingTimeProfileScreen } from "./working-time-profile-screen";
const mockDb = {},
  mockPalette = LIGHT_PALETTE;
const mockGuard = jest.fn();
const mockNativeHeader = jest.fn();
let mockOrigin: string | undefined;
let mockMonth: string | undefined;
let mockCalculationProfile: ReturnType<typeof createWorkingTimeCalculationProfile> | undefined;
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
  Stack: {
    Screen: ({ options }: { options: { title?: string } }) => {
      mockNativeHeader(options);
      return null;
    },
  },
  useLocalSearchParams: () => ({ origin: mockOrigin, month: mockMonth }),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockWork, calculationProfile: mockCalculationProfile }),
  usePflegeShiftEntries: () => ({ entries: [] }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
}));
jest.mock("./use-profile-leave-guard", () => ({
  useProfileLeaveGuard: (dirty: boolean, busy: boolean) => {
    mockGuard(dirty, busy);
    return { saved: (reload: () => void) => reload() };
  },
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
const load = jest.mocked(loadWorkingTimeTargetSettings),
  save = jest.mocked(saveWorkingTimeTargetSettings);
const empty: WorkingTimeTargetSnapshot = {
  saved: null,
  context: undefined,
  staleDates: [],
  planRevision: "plan",
};
const renderEditor = () =>
  render(
    <ProfileSelectionProvider>
      <WorkingTimeProfileScreen />
    </ProfileSelectionProvider>,
  );

describe("automatic working time overview", () => {
  beforeEach(() => {
    mockCalculationProfile = undefined;
    mockOrigin = "analysis";
    mockMonth = "2026-12";
    jest.mocked(router.back).mockClear();
    jest.mocked(router.push).mockClear();
    mockGuard.mockClear();
    mockNativeHeader.mockClear();
    load.mockReset().mockResolvedValue(empty);
    save.mockReset().mockImplementation(async (_db, input) => ({
      ...empty,
      context: input.context,
      saved: {
        settings: { version: 1, context: input.context, planBindings: [] },
        revision: (input.expected.saved?.revision ?? 0) + 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-10-24T00:00:00Z",
      },
    }));
  });
  it("shows the same forecast with duties on all four reference days", async () => {
    const context = { ...decemberTargetContext, days: [] };
    const entries = [24, 25, 26, 31].map((day) =>
      enteredShift({
        id: String(day),
        date: "2026-12-" + day,
        startTime: "08:00",
        endTime: "16:00",
        type: "DAY",
      }),
    );
    mockCalculationProfile = createWorkingTimeCalculationProfile(
      mockWork,
      { ...empty, context },
      [],
      "ready",
      entries,
    );
    load.mockResolvedValue({ ...empty, context });
    const screen = await renderEditor();
    expect(screen.getByText("146:18 h")).toBeTruthy();
    expect(screen.queryByText(/Tage sind noch offen/)).toBeNull();
    expect(screen.queryByText("Arbeitszeitmodell ergänzen")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it("starts with the result and collapsed explanation, without duplicate profile inputs or day lists", async () => {
    const screen = await renderEditor();
    expect(screen.getByText("Sollarbeitszeit")).toBeTruthy();
    expect(screen.getByText("146:18 h")).toBeTruthy();
    expect(screen.getByText(/Prognose ·/)).toBeTruthy();
    expect(mockNativeHeader).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Arbeitszeit" }),
    );
    expect(screen.getByText("So wird die Sollzeit berechnet")).toBeTruthy();
    expect(screen.queryByLabelText("Stunden pro Woche")).toBeNull();
    expect(screen.queryByLabelText("Ab wann gilt das?")).toBeNull();
    expect(screen.queryByText("Feiertage und Sondertage")).toBeNull();
    expect(screen.queryByText("Änderung eintragen")).toBeNull();
    expect(screen.queryByText(/Monatsbasis:/)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it("shows the qualified 146:18 result and four dated deductions only when expanded", async () => {
    load.mockResolvedValue({ ...empty, context: decemberTargetContext });
    const screen = await renderEditor();
    expect(screen.getByText("146:18 h")).toBeTruthy();
    expect(screen.queryByText(/Tage sind noch offen/)).toBeNull();
    await fireEvent.press(screen.getByText("So wird die Sollzeit berechnet"));
    expect(screen.getByText("Monatsbasis: 177:06 h")).toBeTruthy();
    expect(screen.getByText("26.12.2026 · 2. Weihnachtstag")).toBeTruthy();
    expect(screen.getAllByText("−7:42 h")).toHaveLength(4);
    expect(screen.getByText(/24.12.2026.*tariflicher Sondertag/)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
  it("renders calculation dates as information without day actions or confirmations", async () => {
    load.mockResolvedValue({ ...empty, context: decemberTargetContext });
    const screen = await renderEditor();
    await fireEvent.press(screen.getByText("So wird die Sollzeit berechnet"));
    expect(screen.queryByRole("button", { name: /24.12.2026/ })).toBeNull();
    await fireEvent.press(screen.getByText("24.12.2026 · Heiligabend (tariflicher Sondertag)"));
    expect(screen.getByText("146:18 h")).toBeTruthy();
    expect(screen.queryByText("Ich habe Dienst")).toBeNull();
    expect(screen.queryByText("Dienstplanmäßig frei")).toBeNull();
    expect(screen.queryByText("Angabe übernehmen")).toBeNull();
    expect(screen.queryByLabelText("Ausgefallene Dienstplanstunden")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it("explains the conditional TV-L reference inside the existing collapsed breakdown", async () => {
    const tvl = {
      ...mockWork,
      tariff: null,
      tvlKrTariff: {
        payGroup: "KR8" as const,
        payLevel: 4 as const,
        universityRegion: "WEST" as const,
      },
      sundayHolidayWorkEligible: true,
    };
    mockCalculationProfile = createWorkingTimeCalculationProfile(tvl, null, []);
    const screen = await renderEditor();
    expect(screen.getByText("146:18 h")).toBeTruthy();
    expect(screen.queryByText(/Planwert für dienstplanmäßig freie/)).toBeNull();
    await fireEvent.press(screen.getByText("So wird die Sollzeit berechnet"));
    expect(screen.getByText(/TV-L\/KR.*Planwert für dienstplanmäßig freie Feiertage/)).toBeTruthy();
    expect(screen.queryByText("Dienstplanmäßig frei")).toBeNull();
    expect(screen.queryByText("Tag ergänzen")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it("has only the breakdown and no employment editor or model question", async () => {
    const screen = await renderEditor();
    for (const label of [
      "Deine Beschäftigung",
      "Frühere Beschäftigung ändern",
      "Änderung eintragen",
      "Wie verteilen sich deine Arbeitstage?",
      "Tag ergänzen",
    ])
      expect(screen.queryByText(label)).toBeNull();
    await fireEvent.press(screen.getByText("So wird die Sollzeit berechnet"));
    expect(screen.getAllByText("−7:42 h")).toHaveLength(4);
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps calendar conflicts outside the contractual forecast", async () => {
    const duty = enteredShift({
      date: "2026-12-24",
      startTime: "08:00",
      endTime: "16:00",
      type: "DAY",
    });
    mockCalculationProfile = createWorkingTimeCalculationProfile(mockWork, null, [], "ready", [
      duty,
      { ...duty, id: "free", type: "FREE", startTime: null, endTime: null },
    ]);
    const screen = await renderEditor();
    expect(screen.queryByText(/Tage sind noch offen/)).toBeNull();
    expect(screen.getByText("146:18 h")).toBeTruthy();
    expect(screen.queryByText("Widersprüchliche Dienste prüfen")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it("shows a read failure instead of an editable empty history", async () => {
    load.mockRejectedValueOnce(new Error("invalid future profile"));
    const screen = await renderEditor();
    expect(screen.getByText("Die Sollzeitangaben konnten nicht geladen werden.")).toBeTruthy();
    expect(screen.queryByText("Arbeitszeitmodell ergänzen")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects an invalid month instead of silently using the current month", async () => {
    mockMonth = "2026-13";
    const screen = await renderEditor();
    expect(screen.getByText("Der Link enthält keinen gültigen Monat.")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
  it("returns to the requesting analysis without writing", async () => {
    const screen = await renderEditor();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zur Auswertung" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
