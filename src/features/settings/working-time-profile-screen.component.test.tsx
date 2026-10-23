import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { work as mockWork } from "@/engine/remuneration-test-fixtures";
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
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockWork }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
}));
jest.mock("./use-profile-leave-guard", () => ({
  useProfileLeaveGuard: (dirty: boolean, busy: boolean) => {
    mockGuard(dirty, busy);
    return { saved: (reload: () => void) => reload() };
  },
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

describe("working time profile screen", () => {
  beforeEach(() => {
    mockGuard.mockClear();
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
  it("saves a new dated period and refreshes history without enabling claims", async () => {
    const screen = await renderEditor();
    expect(
      screen.getByText(/Auswertungen verwenden diese Angaben derzeit noch nicht/),
    ).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText("Gültig ab (JJJJ-MM-TT)"), "2026-12-01");
    expect(mockGuard).toHaveBeenLastCalledWith(true, false);
    await fireEvent.press(screen.getByText("Zeitraum speichern"));
    expect(save).toHaveBeenCalledWith(mockDb, {
      expected: empty,
      confirmedDates: [],
      context: {
        periods: [
          expect.objectContaining({
            validFrom: "2026-12-01",
            model: { kind: "UNKNOWN" },
            tariff: { kind: "UNVERIFIED", id: "UNCONFIRMED" },
          }),
        ],
        days: [],
      },
    });
    expect(screen.getByText("Ab 2026-12-01")).toBeTruthy();
    expect(mockGuard).toHaveBeenLastCalledWith(false, false);
  });
  it("leaves the current input intact after a visible concurrency conflict", async () => {
    save.mockRejectedValueOnce(
      new WorkingTimeTargetError("Die Sollzeitangaben wurden zwischenzeitlich geändert."),
    );
    const screen = await renderEditor();
    await fireEvent.changeText(screen.getByLabelText("Gültig ab (JJJJ-MM-TT)"), "2026-12-01");
    await fireEvent.press(screen.getByText("Zeitraum speichern"));
    expect(screen.getByText(/zwischenzeitlich geändert/)).toBeTruthy();
    expect(screen.getByLabelText("Gültig ab (JJJJ-MM-TT)").props.value).toBe("2026-12-01");
    expect(screen.queryByText("Ab 2026-12-01")).toBeNull();
    expect(mockGuard).toHaveBeenLastCalledWith(true, false);
  });
  it("shows a load failure instead of an editable empty profile", async () => {
    load.mockRejectedValueOnce(new Error("invalid future profile"));
    const screen = await renderEditor();
    expect(screen.getByText("Die Sollzeitangaben konnten nicht geladen werden.")).toBeTruthy();
    expect(screen.queryByText("Zeitraum speichern")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
