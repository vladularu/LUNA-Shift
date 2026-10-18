import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { WorktimeDetailsScreen } from "./worktime-details-screen";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ month: "2026-08" }),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
  usePflegeShiftEntries: () => ({ entries: [] }),
  usePflegeShiftProfile: () => ({ profile: { timeZone: "Europe/Berlin" } }),
  usePflegeShiftTariff: () => ({ tariffDecisions: [], workPatternSettings: {} }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: {} }),
}));
jest.mock("./monthly-analysis", () => ({
  calculateMonthlyAnalysis: () => ({
    summary: {
      ok: true,
      value: { actualMinutes: 0, targetMinutes: 2310, balanceMinutes: -2310 },
    },
    shiftTypeAnalysis: { totalCount: 0, totalMinutes: 0 },
  }),
}));

describe("Stunden ohne Dienste", () => {
  it("öffnet aus dem Leerzustand den Kalender im ausgewerteten Monat", async () => {
    const screen = await render(<WorktimeDetailsScreen />);
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Kalender öffnen" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/", params: { month: "2026-08" } });
  });
});
