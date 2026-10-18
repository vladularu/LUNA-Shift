import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { NavigationAction } from "expo-router/react-navigation";
import { Alert } from "react-native";
import { useState } from "react";
import type { SaveProfileInput, UserProfile } from "@/domain/types";
import type { RouteParam } from "@/navigation/route-params";
import { CheckProfileForm, CheckProfileScreen } from "./check-profile-screen";

const mockSave = jest.fn<(input: SaveProfileInput) => Promise<void>>();
let mockProfile: UserProfile;
let mockQuestions: RouteParam;
const mockDispatch = jest.fn();
const mockNavigation = { dispatch: mockDispatch };
let mockGuard: {
  active: boolean;
  callback: (event: { data: { action: NavigationAction } }) => void;
};
jest.mock("expo-router/react-navigation", () => ({
  usePreventRemove: (active: boolean, callback: typeof mockGuard.callback) => {
    mockGuard = { active, callback };
  },
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile, updateProfile: mockSave }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
}));
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ questions: mockQuestions }),
  useNavigation: () => mockNavigation,
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
  jest.mocked(router.back).mockReset();
  mockProfile = profile;
  mockQuestions = undefined;
  mockGuard = { active: false, callback: jest.fn() };
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
  it("keeps unknown unknown when saved", async () => {
    const screen = await render(<CheckProfileForm profile={profile} questions={["work"]} />);
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(profile));
  });
  it("allows leaving unchanged questions without writing", async () => {
    const screen = await render(<CheckProfileForm profile={profile} questions={["work"]} />);
    await fireEvent.press(screen.getByRole("button", { name: "Später" }));
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockGuard.active).toBe(false);
    expect(router.back).toHaveBeenCalledTimes(1);
  });
  it("guards changed answers on Später and keeps them until explicitly discarded", async () => {
    const screen = await render(<CheckProfileForm profile={profile} questions={["work"]} />);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await fireEvent.press(screen.getByRole("radio", { name: "Ja" }));
    expect(mockGuard.active).toBe(true);
    const action: NavigationAction = { type: "GO_BACK" };
    jest.mocked(router.back).mockImplementation(() => mockGuard.callback({ data: { action } }));
    await fireEvent.press(screen.getByRole("button", { name: "Später" }));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    await act(() => alert.mock.calls[0][2]![0].onPress?.());
    expect(screen.getByRole("radio", { name: "Ja" }).props.accessibilityState.checked).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Später" }));
    await act(() => alert.mock.calls[1][2]![1].onPress?.());
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(action);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it.each(["GO_BACK", "POP"])("guards changed answers on native %s removal", async (type) => {
    const screen = await render(<CheckProfileForm profile={profile} questions={["work"]} />);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await fireEvent.press(screen.getByRole("radio", { name: "Nein" }));
    expect(mockGuard.active).toBe(true);
    const action: NavigationAction = { type };
    await act(() => mockGuard.callback({ data: { action } }));
    expect(mockDispatch).not.toHaveBeenCalled();
    await act(() => alert.mock.calls.at(-1)![2]![1].onPress?.());
    expect(mockDispatch).toHaveBeenCalledWith(action);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("keeps selected answers while going back within the wizard", async () => {
    const screen = await render(
      <CheckProfileForm profile={profile} questions={["work", "night"]} />,
    );
    await fireEvent.press(screen.getByRole("radio", { name: "Ja" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Nein" }));
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(screen.getByRole("radio", { name: "Ja" }).props.accessibilityState.checked).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(screen.getByRole("radio", { name: "Nein" }).props.accessibilityState.checked).toBe(true);
  });
  it("saves exactly once through pending and completed taps and leaves without discard confirmation", async () => {
    let complete!: () => void;
    mockSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const screen = await render(<CheckProfileForm profile={profile} questions={["work"]} />);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await fireEvent.press(screen.getByRole("radio", { name: "Ja" }));
    const button = screen.getByRole("button", { name: "Speichern" });
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockGuard.active).toBe(true);
    expect(router.back).not.toHaveBeenCalled();
    await act(() => complete());
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    await fireEvent.press(button);
    await fireEvent.press(screen.getByRole("button", { name: "Später" }));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockGuard.active).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });
  it.each([
    { value: true, label: "Ja" },
    { value: false, label: "Nein" },
    { value: null, label: "Weiß ich nicht" },
  ])(
    "preserves the deliberate $label value for all three check answers",
    async ({ value, label }) => {
      const screen = await render(<CheckProfileScreen />);
      for (let page = 0; page < 3; page++) {
        await fireEvent.press(screen.getByRole("radio", { name: label }));
        await fireEvent.press(
          screen.getByRole("button", { name: page === 2 ? "Speichern" : "Weiter" }),
        );
      }
      await waitFor(() =>
        expect(mockSave).toHaveBeenCalledWith({
          ...profile,
          allEmploymentWorkRecorded: value,
          regularRotatingNightWork: value,
          sundayHolidayWorkEligible: value,
        }),
      );
    },
  );
  it("opens the targeted region question without changing unrequested check answers", async () => {
    mockQuestions = "region";
    mockProfile = { ...profile, federalState: "BY", holidayRegion: "UNKNOWN" };
    const screen = await render(<CheckProfileScreen />);
    expect(screen.getByText("1 / 1")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Keine regionale Sonderregel" }));
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({ ...mockProfile, holidayRegion: "NONE" }),
    );
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
