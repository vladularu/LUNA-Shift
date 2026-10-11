import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { useState } from "react";
import type { SaveProfileInput, UserProfile } from "@/domain/types";
import type { RouteParam } from "@/navigation/route-params";
import { CheckProfileForm, CheckProfileScreen } from "./check-profile-screen";

const mockSave = jest.fn<(input: SaveProfileInput) => Promise<void>>();
let mockProfile: UserProfile;
let mockQuestions: RouteParam;
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile, updateProfile: mockSave }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
}));
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ questions: mockQuestions }),
}));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);
const profile: UserProfile = {
  federalState: "NW",
  holidayRegion: "NONE",
  industry: "HEALTHCARE",
  weeklyMinutes: 1920,
  timeZone: "Europe/Berlin",
  tariff: null,
  manualMonthlyGrossCents: 345000,
  allEmploymentWorkRecorded: null,
  regularRotatingNightWork: null,
  sundayHolidayWorkEligible: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = profile;
  mockQuestions = undefined;
  mockSave.mockResolvedValue(undefined);
});
describe("short check setup", () => {
  it.each(["unknown", "night,", ["night", "work"]])(
    "rejects malformed question routes without opening or saving the form: %s",
    async (questions) => {
      mockQuestions = questions;
      const screen = await render(<CheckProfileScreen />);
      expect(screen.getByText("Der Link enthält unbekannte Fragen.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();
      expect(mockSave).not.toHaveBeenCalled();
    },
  );
  it("asks a repeated requested question once and preserves unrelated answers", async () => {
    mockQuestions = "night,night";
    const screen = await render(<CheckProfileScreen />);
    expect(screen.getByText("1 / 1")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Ja" }));
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({ ...profile, regularRotatingNightWork: true }),
    );
  });
  it("saves deliberate answers while preserving salary and answers that were not requested", async () => {
    const screen = await render(
      <CheckProfileForm profile={profile} questions={["work", "night"]} />,
    );
    await fireEvent.press(screen.getByRole("radio", { name: "Ja" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Nein" }));
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        ...profile,
        allEmploymentWorkRecorded: true,
        regularRotatingNightWork: false,
      }),
    );
    expect(router.back).toHaveBeenCalled();
  });
  it("keeps unknown unknown and allows leaving without saving", async () => {
    const screen = await render(<CheckProfileForm profile={profile} questions={["work"]} />);
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(profile));
    mockSave.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Später" }));
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("retains entries after save failure and allows retry", async () => {
    mockSave.mockRejectedValueOnce(new Error("disk unavailable"));
    const screen = await render(<CheckProfileForm profile={profile} questions={["work"]} />);
    await fireEvent.press(screen.getByRole("radio", { name: "Ja" }));
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenLastCalledWith({ ...profile, allEmploymentWorkRecorded: true }),
    );
  });
  it("keeps the final region question stable when saving updates the profile before navigation", async () => {
    function RegionSaveHarness() {
      const [current, setCurrent] = useState<UserProfile>({
        ...profile,
        federalState: "BY",
        holidayRegion: "UNKNOWN",
      });
      mockSave.mockImplementation(async (input) => {
        setCurrent({ ...current, ...input });
      });
      return (
        <CheckProfileForm
          profile={current}
          questions={
            current.holidayRegion === "UNKNOWN"
              ? ["work", "night", "sunday", "region"]
              : ["work", "night", "sunday"]
          }
        />
      );
    }
    const screen = await render(<RegionSaveHarness />);
    for (let page = 0; page < 3; page++)
      await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Keine regionale Sonderregel" }));
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(screen.getByText("4 / 4")).toBeTruthy();
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ federalState: "BY", holidayRegion: "NONE" }),
    );
  });
});
