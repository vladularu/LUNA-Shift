import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { MonthlySummary } from "@/domain/types";
import { router } from "expo-router";
import { WorktimeDetailsScreen } from "./worktime-details-screen";

let mockSummary: Pick<MonthlySummary, "actualMinutes" | "targetMinutes" | "balanceMinutes"> &
  Partial<MonthlySummary>;
beforeEach(() => {
  mockSummary = { actualMinutes: 0, targetMinutes: 2310, balanceMinutes: -2310 };
});

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
      value: mockSummary,
    },
    shiftTypeAnalysis: { totalCount: 0, totalMinutes: 0 },
  }),
}));

describe("Stunden ohne Dienste", () => {
  it("shows precise agreed account time separately from recorded work and opens the duty", async () => {
    mockSummary = {
      actualMinutes: 450,
      timeAccountMinutes: 337.5,
      targetMinutes: 2310,
      balanceMinutes: -1972.5,
      specialDutyTimeCredits: [
        {
          shiftId: "standby",
          date: "2026-08-09",
          title: "Bereitschaftsdienst",
          recordedMinutes: 450,
          creditedMinutes: 337.5,
          settlement: "TIME_OFF",
          notes: [],
        },
      ],
    };
    const screen = await render(<WorktimeDetailsScreen />);
    expect(screen.getByLabelText("Zeitkonto: 5:37:30 h")).toBeTruthy();
    expect(screen.getByText(/Erfasst: 7:30 h/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /09\.08\. · Bereitschaftsdienst/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/shift-editor",
      params: { date: "2026-08-09", mode: "SHIFT", entryId: "standby" },
    });
  });
  it("keeps an unconfirmed account visible as open without inventing zero credit", async () => {
    mockSummary = {
      actualMinutes: 450,
      timeAccountMinutes: null,
      targetMinutes: 2310,
      balanceMinutes: -1860,
      specialDutyNotes: ["Abgeltung noch offen"],
    };
    const screen = await render(<WorktimeDetailsScreen />);
    expect(screen.getByLabelText("Zeitkonto: Noch offen")).toBeTruthy();
    expect(screen.getByLabelText("Stundensaldo: Noch offen")).toBeTruthy();
    expect(screen.getByText(/Erfasst: 7:30 h/)).toBeTruthy();
  });
  it("öffnet aus dem Leerzustand den Kalender im ausgewerteten Monat", async () => {
    const screen = await render(<WorktimeDetailsScreen />);
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Kalender öffnen" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/", params: { month: "2026-08" } });
  });
});
