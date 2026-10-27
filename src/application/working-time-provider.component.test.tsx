import { createContext, useContext } from "react";
import { Text, Pressable } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { UserProfile } from "@/domain/types";
import type { PflegeShiftPorts } from "./pflegeshift-ports";
import { WorkingTimeProvider, type PflegeShiftProfileValue } from "./working-time-provider";
import {
  CheckPreferencesProvider,
  useCheckPreferences,
} from "@/features/settings/check-preferences";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import { work } from "@/engine/remuneration-test-fixtures";
import {
  loadPlanningHintsPreference,
  loadYouthProtectionPreference,
  saveYouthProtectionPreference,
} from "@/infrastructure/database/preferences-repository";

const mockDb = {};
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("./remuneration-provider", () => ({
  useRemunerationData: () => ({ status: "ready", profiles: [] }),
}));
jest.mock("@/infrastructure/database/preferences-repository", () => ({
  loadPlanningHintsPreference: jest.fn(),
  loadYouthProtectionPreference: jest.fn(),
  saveYouthProtectionPreference: jest.fn(),
  savePlanningHintsPreference: jest.fn(),
}));
const planning = jest.mocked(loadPlanningHintsPreference),
  youth = jest.mocked(loadYouthProtectionPreference),
  save = jest.mocked(saveYouthProtectionPreference);
const profileContext = createContext<PflegeShiftProfileValue | null>(null);
const base: UserProfile = {
  ...work,
  tariff: null,
  federalState: "HE",
  nursingTrainingTariff: { trainingYear: 2, sector: "BT_K", tariffRegion: "OTHER" },
};
const snapshot = { saved: null, context: undefined, staleDates: [], planRevision: "plan" };
const ports = {
  repository: { loadWorkingTimeTargetSettings: async () => snapshot },
  diagnostics: { record: jest.fn() },
} as unknown as PflegeShiftPorts;
function Harness() {
  const p = useContext(profileContext),
    prefs = useCheckPreferences();
  let number = "loading",
    codes = "";
  if (p?.calculationProfile?.workingTimeTarget?.status === "ready") {
    const r = calculateMonthlyWorkingTimeTarget("2026-12", p.calculationProfile);
    number = r.status + ":" + String(r.targetMinutes);
    codes = r.notices.map((n) => n.code).join(" ");
  }
  return (
    <>
      <Text>{number}</Text>
      <Text testID="codes">{codes}</Text>
      <Pressable onPress={() => void prefs.saveYouth(true)}>
        <Text>Jugendschutz an</Text>
      </Pressable>
      <Pressable onPress={() => void prefs.saveYouth(false)}>
        <Text>Jugendschutz aus</Text>
      </Pressable>
      <Pressable onPress={prefs.retry}>
        <Text>Neu laden</Text>
      </Pressable>
    </>
  );
}
const tree = (profile = base) => (
  <CheckPreferencesProvider>
    <WorkingTimeProvider
      ports={ports}
      base={{ profile, updateProfile: async () => profile }}
      entries={[]}
      ready
      profileContext={profileContext}
    >
      <Harness />
    </WorkingTimeProvider>
  </CheckPreferencesProvider>
);
describe("existing youth preference gates only the training target projection", () => {
  beforeEach(() => {
    planning.mockReset().mockResolvedValue(true);
    youth.mockReset().mockResolvedValue(false);
    save.mockReset().mockResolvedValue(undefined);
  });
  it("recalculates immediately when the existing setting is switched on and back off", async () => {
    const screen = await render(tree());
    expect(await screen.findByText("PROVISIONAL:8778")).toBeTruthy();
    await fireEvent.press(screen.getByText("Jugendschutz an"));
    expect(await screen.findByText("UNAVAILABLE:null")).toBeTruthy();
    expect(screen.getByTestId("codes").props.children).toContain(
      "TRAINING_YOUTH_TARGET_UNSUPPORTED",
    );
    await fireEvent.press(screen.getByText("Jugendschutz aus"));
    expect(await screen.findByText("PROVISIONAL:8778")).toBeTruthy();
    expect(save).toHaveBeenNthCalledWith(1, mockDb, true);
    expect(save).toHaveBeenNthCalledWith(2, mockDb, false);
  });
  it("does not flash an adult value while the stored preference is pending", async () => {
    let resolve!: (value: boolean) => void;
    youth.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const screen = await render(tree());
    expect(await screen.findByText("UNAVAILABLE:null")).toBeTruthy();
    expect(screen.getByTestId("codes").props.children).toContain(
      "TRAINING_YOUTH_PREFERENCE_LOADING",
    );
    expect(screen.queryByText("PROVISIONAL:8778")).toBeNull();
    await act(async () => {
      resolve(true);
    });
    await waitFor(() =>
      expect(screen.getByTestId("codes").props.children).toContain(
        "TRAINING_YOUTH_TARGET_UNSUPPORTED",
      ),
    );
    expect(screen.queryByText("PROVISIONAL:8778")).toBeNull();
  });
  it("preserves the error guard and recovers through the existing retry", async () => {
    youth.mockRejectedValueOnce(new Error("read failed"));
    const screen = await render(tree());
    expect(await screen.findByText("UNAVAILABLE:null")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("codes").props.children).toContain(
        "TRAINING_YOUTH_PREFERENCE_ERROR",
      ),
    );
    expect(screen.queryByText("PROVISIONAL:8778")).toBeNull();
    await fireEvent.press(screen.getByText("Neu laden"));
    expect(await screen.findByText("PROVISIONAL:8778")).toBeTruthy();
  });
  it("leaves an employee target available even when reading the youth setting fails", async () => {
    youth.mockRejectedValueOnce(new Error("read failed"));
    const screen = await render(tree({ ...work, federalState: "HE" }));
    expect(await screen.findByText("PROVISIONAL:8778")).toBeTruthy();
    expect(screen.getByTestId("codes").props.children).not.toContain("TRAINING_YOUTH_");
  });
});
