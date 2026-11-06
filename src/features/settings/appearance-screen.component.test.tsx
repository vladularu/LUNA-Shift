import { fireEvent, render, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as ReactNative from "react-native";
import { AppearanceContext, type AppearanceValue } from "@/theme/appearance-context";
import { resolvePalette } from "@/theme/theme-catalog";
import { AppearanceScreen } from "./appearance-screen";
import { CalendarBackgroundContext } from "./calendar-background-context";
import type { ShiftEntry } from "@/domain/types";
import { calendarChipPalette } from "@/theme/color-contrast";
import type { CalendarImageStrength } from "@/theme/calendar-image";

const nativeModule = jest.requireActual<typeof import("react-native")>("react-native");

const preferences: AppearanceValue = {
  themeId: "mint",
  mode: "system",
  ready: true,
  saving: false,
  error: null,
  setTheme: jest.fn(),
  setMode: jest.fn(),
  retry: jest.fn(),
  reset: jest.fn(),
};

const mockDisplay = {
  labelMode: "SHORT",
  ready: true,
  saving: false,
  error: null as string | null,
  retry: jest.fn(),
  resetDisplay: jest.fn(),
  setShowShifts: jest.fn(),
  setShowAppointments: jest.fn(),
  setShowHolidays: jest.fn(),
  setHolidayColor: jest.fn(),
  holidayColor: "ORANGE",
  pastelColors: false,
  setPastelColors: jest.fn(),
  setLabelMode: jest.fn(),
  setTimeDisplay: jest.fn(),
  setShowShiftTimes: jest.fn(),
  setShowShiftDuration: jest.fn(),
  showShiftTimes: false,
  showShiftDuration: false,
  showAppointments: true,
  showShifts: true,
  showHolidays: true,
};
const mockEntries: ShiftEntry[] = [
  {
    kind: "SHIFT",
    id: "own",
    date: "2026-10-06",
    templateId: null,
    title: "Früh",
    type: "EARLY",
    startTime: "06:00",
    endTime: "14:00",
    breakMinutes: 30,
    color: "#7E57C2",
    symbol: "F",
    note: "",
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    deletedAt: null,
  },
];
jest.mock("@/navigation/active-month", () => ({ useActiveMonth: () => "2026-10" }));
jest.mock("@/features/calendar/calendar-preferences", () => ({
  useCalendarPreferences: () => ({ ...mockDisplay }),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftTemplates: () => ({ templates: [] }),
  usePflegeShiftProfile: () => ({
    profile: { federalState: "HE", holidayRegion: "NONE", timeZone: "Europe/Berlin" },
  }),
}));
const setStrength = jest
  .fn<(_strength: CalendarImageStrength) => Promise<void>>()
  .mockResolvedValue();
const background = {
  uri: null as string | null,
  strength: "medium" as CalendarImageStrength,
  setStrength,
  ready: true,
  busy: false,
  error: null as string | null,
  supported: true,
  choose: jest.fn<() => Promise<void>>().mockResolvedValue(),
  remove: jest.fn<() => Promise<void>>().mockResolvedValue(),
  undoRemove: jest.fn<() => Promise<void>>().mockResolvedValue(),
  reset: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  canUndoRemoval: false,
  retry: jest.fn(),
};
function screenWith(
  overrides: Partial<AppearanceValue> = {},
  image: Partial<typeof background> = {},
) {
  return (
    <CalendarBackgroundContext value={{ ...background, ...image }}>
      <AppearanceContext value={{ ...preferences, ...overrides }}>
        <AppearanceScreen />
      </AppearanceContext>
    </CalendarBackgroundContext>
  );
}
function pictureScreen() {
  return screenWith({}, { uri: "file:///photo.jpg" });
}

describe("appearance controls", () => {
  beforeEach(() => {
    mockDisplay.ready = true;
    mockDisplay.error = null;
    mockDisplay.saving = false;
    mockDisplay.showShifts = true;
    mockDisplay.showAppointments = true;
    mockDisplay.showHolidays = true;
    mockDisplay.holidayColor = "ORANGE";
    mockDisplay.pastelColors = false;
    mockDisplay.labelMode = "SHORT";
    mockDisplay.showShiftTimes = false;
    mockDisplay.showShiftDuration = false;
    jest.spyOn(nativeModule, "useWindowDimensions").mockReturnValue({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1,
    });
  });

  it("offers persistent preset color modes with accessible rows and disabled loading state", async () => {
    const screen = await render(screenWith());
    const group = within(screen.getByLabelText("Farbschema für Dienste"));
    expect(group.getByRole("radio", { name: "Kräftige Farben", checked: true })).toHaveStyle({
      minHeight: 44,
    });
    expect(screen.queryByText("Eigene Farben bleiben erhalten.")).toBeNull();
    for (const mode of ["vivid", "pastel"]) {
      expect(screen.getByTestId(`shift-color-scheme-${mode}-swatches`).children).toHaveLength(3);
      expect(screen.getByTestId(`shift-color-scheme-${mode}-indicator`)).toBeTruthy();
    }
    expect(group.getByRole("radio", { name: "Kräftige Farben" })).toHaveStyle({
      backgroundColor: "transparent",
    });
    await fireEvent.press(group.getByRole("radio", { name: "Kräftige Farben" }));
    expect(mockDisplay.setPastelColors).not.toHaveBeenCalled();
    await fireEvent.press(group.getByRole("radio", { name: "Pastellfarben" }));
    expect(mockDisplay.setPastelColors).toHaveBeenCalledWith(true);
    mockDisplay.pastelColors = true;
    await screen.rerender(screenWith());
    expect(screen.getByRole("radio", { name: "Pastellfarben", checked: true })).toBeTruthy();
    expect(group.getByRole("radio", { name: "Pastellfarben" })).toHaveStyle({
      backgroundColor: "transparent",
    });
    await fireEvent.press(screen.getByRole("radio", { name: "Kräftige Farben" }));
    expect(mockDisplay.setPastelColors).toHaveBeenLastCalledWith(false);
    mockDisplay.ready = false;
    await screen.rerender(screenWith());
    expect(screen.getByRole("radio", { name: "Pastellfarben", disabled: true })).toBeTruthy();
  });

  it.each(["light", "dark"] as const)(
    "updates the live preview from legacy, current and custom colors in %s",
    async (mode) => {
      const original = mockEntries[0];
      try {
        mockEntries[0] = { ...original, color: "#4FCB68" };
        const screen = await render(screenWith({ mode }));

        const title = () => within(screen.getByLabelText("2026-10-06, Früh")).getByText("F");
        expect(title().parent).toHaveStyle({ backgroundColor: "#4FCB68" });
        mockDisplay.pastelColors = true;
        await screen.rerender(screenWith({ mode }));
        expect(title().parent).toHaveStyle({ backgroundColor: "#DDF4E2" });
        expect(mockEntries[0].color).toBe("#4FCB68");
        mockEntries[0] = { ...original, color: "#123456" };
        await screen.rerender(screenWith({ mode }));
        expect(title().parent).toHaveStyle({ backgroundColor: "#E1E6EA" });
        expect(mockEntries[0].color).toBe("#123456");
        mockEntries[0] = { ...original, color: "#E74C55" };
        await screen.rerender(screenWith({ mode }));
        expect(title().parent).toHaveStyle({ backgroundColor: "#F8D8DA" });
        mockDisplay.pastelColors = false;
        await screen.rerender(screenWith({ mode }));
        expect(title().parent).toHaveStyle({ backgroundColor: "#E74C55" });
      } finally {
        mockEntries[0] = original;
      }
    },
  );

  it("keeps the appearance mode and offers a custom calendar image without extra themes", async () => {
    const screen = await render(screenWith());
    expect(screen.getByRole("radio", { name: "System", checked: true })).toBeTruthy();
    for (const name of ["Minzbrise", "Lavendelruhe", "Rosenleinen", "Meeresluft"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Foto auswählen" })).toBeTruthy();
    expect(screen.queryByLabelText("Bildsichtbarkeit")).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Dunkel" }));
    expect(preferences.setMode).toHaveBeenCalledWith("dark");
    expect(preferences.setTheme).not.toHaveBeenCalled();
  });

  it("offers held ten-percent adjustments instead of the three preset buttons", async () => {
    const screen = await render(pictureScreen());
    expect(screen.queryByRole("radio", { name: "Mittel" })).toBeNull();
    const slider = screen.getByRole("adjustable", { name: "Deckkraft des Kalenderfotos" });
    expect(slider).toHaveProp("accessibilityValue", {
      min: 0,
      max: 100,
      now: 25,
      text: "25 Prozent",
    });
    await fireEvent(slider, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    expect(setStrength).toHaveBeenCalledWith(30);
    expect(screen.queryByText("0 %")).toBeNull();
    expect(screen.queryByText("100 %")).toBeNull();
    expect(
      screen.getByTestId("calendar-image-opacity-value", { includeHiddenElements: true }),
    ).toHaveTextContent("25 %");
    expect(
      screen.getByTestId("calendar-image-opacity-value", { includeHiddenElements: true }),
    ).toHaveStyle({ textAlign: "center" });
  });
  it("keeps an adjustable 44-point slider when text is large", async () => {
    jest
      .spyOn(nativeModule, "useWindowDimensions")
      .mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 2 });
    const screen = await render(pictureScreen());
    expect(screen.getByRole("adjustable", { name: "Deckkraft des Kalenderfotos" })).toHaveStyle({
      minHeight: 44,
    });
    expect(screen.getByRole("button", { name: "Foto ändern" })).toBeEnabled();
  });
  it("does not write again when the selected mode is pressed", async () => {
    const screen = await render(screenWith());
    await fireEvent.press(screen.getByRole("radio", { name: "System" }));
    expect(preferences.setMode).not.toHaveBeenCalled();
    expect(preferences.setTheme).not.toHaveBeenCalled();
  });
  it("keeps the mode choices in one row with usable touch targets at large text sizes", async () => {
    jest.spyOn(nativeModule, "useWindowDimensions").mockReturnValue({
      width: 320,
      height: 640,
      scale: 2,
      fontScale: 2,
    });
    const screen = await render(screenWith({ mode: "light" }));
    expect(screen.getByLabelText("Erscheinungsbild")).toHaveStyle({
      flexDirection: "row",
    });
    for (const name of ["Hell", "Dunkel", "System"]) {
      expect(screen.getByRole("radio", { name })).toHaveStyle({ minHeight: 44 });
    }
  });

  it("keeps the three mode choices horizontal at medium text sizes", async () => {
    jest.spyOn(nativeModule, "useWindowDimensions").mockReturnValue({
      width: 375,
      height: 812,
      scale: 3,
      fontScale: 1.3,
    });
    const screen = await render(screenWith());
    expect(screen.getByLabelText("Erscheinungsbild")).toHaveStyle({ flexDirection: "row" });
  });

  it("keeps one sliding surface with contrasting mode icons in light and dark appearance", async () => {
    const screen = await render(screenWith({ mode: "light" }));
    for (const mode of ["light", "dark"] as const) {
      await screen.rerender(screenWith({ mode }));
      await fireEvent(screen.getByTestId("appearance-mode-track"), "layout", {
        nativeEvent: { layout: { width: 308, height: 52, x: 0, y: 0 } },
      });
      const palette = resolvePalette("mint", mode === "dark");
      expect(screen.getAllByTestId("appearance-mode-active-surface")).toHaveLength(1);
      expect(screen.getByTestId("appearance-mode-active-surface")).toHaveStyle({
        width: 100,
        backgroundColor: palette.primary,
      });
      const group = within(screen.getByLabelText("Erscheinungsbild"));
      expect(group.getByText(mode === "light" ? "Hell" : "Dunkel")).toHaveStyle({
        color: palette.onPrimary,
      });
      expect(group.getAllByRole("radio")).toHaveLength(3);
      expect(group.getAllByRole("radio", { checked: true })).toHaveLength(1);
      expect(
        group.getByRole("radio", { name: mode === "light" ? "Hell" : "Dunkel", checked: true }),
      ).toBeTruthy();
      expect(group.getByRole("radio", { name: "System" })).toHaveProp(
        "accessibilityHint",
        "Folgt der Darstellung deines Geräts",
      );
    }
  });

  it("keeps saving feedback, retry and resetting available", async () => {
    const screen = await render(screenWith({ saving: true }));
    expect(screen.getByText("Wird gespeichert …")).toBeTruthy();
    await screen.rerender(screenWith({ error: "Darstellung konnte nicht gespeichert werden." }));
    expect(screen.getByText("Nicht alle Änderungen wurden gespeichert.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Modus erneut speichern" }));
    expect(preferences.retry).toHaveBeenCalled();
    const alert = jest.spyOn(ReactNative.Alert, "alert");
    await fireEvent.press(screen.getByRole("button", { name: "Kalenderoptionen zurücksetzen" }));
    expect(preferences.reset).not.toHaveBeenCalled();
    await alert.mock.calls[0][2]?.find((button) => button.text === "Zurücksetzen")?.onPress?.();
    expect(background.reset).toHaveBeenCalled();
    expect(mockDisplay.resetDisplay).toHaveBeenCalled();
    expect(preferences.reset).not.toHaveBeenCalled();
  });
  it("renders calendar examples, stored shift colors and date markers above settings", async () => {
    const screen = await render(pictureScreen());

    const preview = screen.getByTestId("appearance-calendar-preview");
    expect(within(preview).queryByText("Oktober 2026")).toBeNull();
    expect(within(preview).getByLabelText("2026-10-06, Früh")).toBeTruthy();
    const chip = within(within(preview).getByLabelText("2026-10-06, Früh")).getByText("F");
    expect(chip.parent).toHaveStyle({
      backgroundColor: calendarChipPalette("#7E57C2", false).main,
    });
    expect(
      within(preview).getByTestId("calendar-date-marker-2026-10-06", {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    const root = screen.toJSON();
    expect(JSON.stringify(root).indexOf("appearance-calendar-preview")).toBeLessThan(
      JSON.stringify(root).indexOf("appearance-settings"),
    );
  });
  it("keeps the live preview fixed above the scrolling sections with a non-interactive fade", async () => {
    const screen = await render(pictureScreen());

    const preview = screen.getByTestId("appearance-calendar-preview");
    const controls = screen.getByTestId("calendar-design-controls");
    const serialized = JSON.stringify(screen.toJSON());
    const sections = [
      "appearance-settings",
      "calendar-background-settings",
      "calendar-shift-colors-settings",
      "calendar-label-settings",
      "calendar-time-settings",
      "calendar-content-settings",
      "calendar-holiday-color-settings",
      "Kalenderoptionen zurücksetzen",
    ];
    const positions = sections.map((id) => serialized.indexOf(id));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(screen.getAllByTestId(/^appearance-preview-week-/)).toHaveLength(2);
    for (const week of screen.getAllByTestId(/^appearance-preview-week-/)) {
      expect(within(week).getAllByTestId(/^calendar-combined-day-/)).toHaveLength(7);
    }
    expect(within(preview).queryByText("Oktober 2026")).toBeNull();

    expect(within(controls).queryByTestId("appearance-calendar-preview")).toBeNull();
    expect(
      screen.getByTestId("calendar-design-scroll-fade", { includeHiddenElements: true }),
    ).toHaveProp("pointerEvents", "none");
    for (const name of [
      "Aussehen",
      "Eigenes Hintergrundbild",
      "Kalenderinhalt",
      "Dienstbezeichnung",
      "Zeitangabe",
    ])
      expect(within(controls).getByText(name)).toBeTruthy();
    for (const name of ["Dienste & Abwesenheiten", "Termine", "Feiertage"])
      expect(within(controls).getByRole("switch", { name })).toBeTruthy();
    expect(
      within(controls).getByRole("button", { name: "Kalenderoptionen zurücksetzen" }),
    ).toBeTruthy();
    await fireEvent.scroll(controls, {
      nativeEvent: {
        contentOffset: { x: 0, y: 600 },
        contentSize: { width: 390, height: 1400 },
        layoutMeasurement: { width: 390, height: 350 },
      },
    });
    expect(screen.getByTestId("appearance-calendar-preview")).toBe(preview);
    expect(preview).toBeVisible();
  });
  it("updates the real preview for each saved strength and mode without replacing its date nodes", async () => {
    const screen = await render(pictureScreen());

    const marker = screen.getByTestId("calendar-date-marker-2026-10-06", {
      includeHiddenElements: true,
    });
    for (const mode of ["light", "dark"] as const) {
      for (const [strength, opacity] of [
        ["subtle", 0.9],
        ["medium", 0.75],
        ["strong", 0.6],
        [0, 1],
        [100, 0],
      ] as const) {
        await screen.rerender(screenWith({ mode }, { uri: "file:///photo.jpg", strength }));
        expect(
          screen.getByTestId("calendar-custom-background-overlay", { includeHiddenElements: true }),
        ).toHaveStyle({
          opacity,
          backgroundColor: resolvePalette("mint", mode === "dark").calendarBackground,
        });
        expect(
          screen.getByTestId("calendar-date-marker-2026-10-06", { includeHiddenElements: true }),
        ).toBe(marker);
      }
    }
  });
  it.each([null, "file:///photo.jpg"])(
    "shows the selected background once with one direct photo picker (photo=%s)",
    async (uri) => {
      const alert = jest.spyOn(ReactNative.Alert, "alert");
      const screen = await render(screenWith({}, { uri }));
      expect(screen.getByText("Eigenes Hintergrundbild")).toBeTruthy();
      expect(
        within(screen.getByTestId("calendar-photo-actions")).queryAllByRole("radio"),
      ).toHaveLength(0);
      expect(screen.queryByRole("button", { name: /Hintergrund/ })).toBeNull();
      await fireEvent.press(
        screen.getByRole("button", { name: uri ? "Foto ändern" : "Foto auswählen" }),
      );
      expect(background.choose).toHaveBeenCalledTimes(1);
      expect(background.remove).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    "limits the real preview to two accessible weeks (times=%s)",
    async (times) => {
      mockDisplay.showShiftTimes = times;
      const screen = await render(pictureScreen());

      const hidden = { includeHiddenElements: true };
      const dates = screen.getAllByTestId(/^calendar-date-marker-/, hidden);
      const adjacentDates = screen.getAllByTestId(/^calendar-adjacent-\d{4}/, hidden);
      expect(dates.length + adjacentDates.length).toBe(14);
      expect(screen.queryByTestId("calendar-date-marker-2026-10-12", hidden)).toBeNull();
      expect(screen.queryByLabelText(/2026-10-12/, hidden)).toBeNull();
      expect(screen.getByLabelText("2026-10-06, Früh")).toBeTruthy();
      expect(screen.getByTestId("appearance-preview-month").props.style.height).toBeLessThan(300);
    },
  );
  it("keeps preview height and date positions stable when shift details are toggled", async () => {
    const screen = await render(pictureScreen());

    const hidden = { includeHiddenElements: true };
    const height = screen.getByTestId("appearance-preview-month").props.style.height;
    const datePositions = () =>
      screen
        .getAllByTestId(/^calendar-date-marker-/, hidden)
        .map((marker) => ReactNative.StyleSheet.flatten(marker.props.style));
    const positions = datePositions();

    for (const [times, duration] of [
      [true, false],
      [true, true],
      [false, true],
      [false, false],
    ] as const) {
      mockDisplay.showShiftTimes = times;
      mockDisplay.showShiftDuration = duration;
      await screen.rerender(pictureScreen());
      expect(screen.getByTestId("appearance-preview-month")).toHaveStyle({ height });
      expect(datePositions()).toEqual(positions);
      const shift = within(screen.getByTestId("appearance-calendar-preview")).getByLabelText(
        "2026-10-06, Früh",
      );
      expect(within(shift).queryByText(/06:00/) !== null).toBe(times);
    }
  });
  it("uses a red text row for removing only the photo and provides undo", async () => {
    const screen = await render(pictureScreen());
    expect(screen.getByText("Foto entfernen")).toHaveStyle({
      color: resolvePalette("mint", false).danger,
    });
    await fireEvent.press(screen.getByRole("button", { name: "Foto entfernen" }));
    expect(background.remove).toHaveBeenCalled();
    expect(preferences.reset).not.toHaveBeenCalled();
    expect(preferences.setMode).not.toHaveBeenCalled();
    expect(setStrength).not.toHaveBeenCalled();
    await screen.rerender(screenWith({}, { canUndoRemoval: true }));
    expect(screen.getByRole("button", { name: "Foto auswählen" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "LUNA Standard" })).toBeNull();
    expect(screen.queryByLabelText("Bildsichtbarkeit")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Rückgängig" }));
    expect(background.undoRemove).toHaveBeenCalled();
  });
  it("leaves settings and photos unchanged when resetting is canceled", async () => {
    const alert = jest.spyOn(ReactNative.Alert, "alert");
    const screen = await render(pictureScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Kalenderoptionen zurücksetzen" }));
    await alert.mock.calls[0][2]?.find((button) => button.text === "Abbrechen")?.onPress?.();
    expect(preferences.reset).not.toHaveBeenCalled();
    expect(background.reset).not.toHaveBeenCalled();
  });
  it("keeps the mode when the confirmed background reset cannot be saved", async () => {
    background.reset.mockResolvedValueOnce(false);
    const alert = jest.spyOn(ReactNative.Alert, "alert");
    const screen = await render(pictureScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Kalenderoptionen zurücksetzen" }));
    await alert.mock.calls[0][2]?.find((button) => button.text === "Zurücksetzen")?.onPress?.();
    expect(preferences.reset).not.toHaveBeenCalled();
  });
  it("keeps mode and photo rows operable with large type on a small iPhone", async () => {
    jest
      .spyOn(nativeModule, "useWindowDimensions")
      .mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 3 });
    const screen = await render(pictureScreen());
    for (const name of ["Hell", "Dunkel", "System"])
      expect(screen.getByRole("radio", { name })).toHaveStyle({ minHeight: 44 });
    expect(screen.getByRole("adjustable")).toHaveStyle({ minHeight: 44 });
    for (const name of ["Foto ändern", "Foto entfernen"])
      expect(screen.getByRole("button", { name })).toHaveStyle({ minHeight: 56 });
    expect(screen.getByRole("button", { name: "Kalenderoptionen zurücksetzen" })).toHaveStyle({
      minHeight: 40,
    });
    expect(screen.getByText("Änderungen werden automatisch gespeichert.")).toBeTruthy();
  });
  it("offers one photo entry and restores a removed photo through undo", async () => {
    const screen = await render(screenWith());
    expect(screen.getByText("Eigenes Hintergrundbild")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "LUNA Standard" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Eigenes Foto" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Foto auswählen" }));
    expect(background.choose).toHaveBeenCalledTimes(1);
    await screen.rerender(pictureScreen());
    expect(screen.queryByRole("button", { name: "Foto auswählen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Foto ändern" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Foto entfernen" }));
    expect(background.remove).toHaveBeenCalledTimes(1);
    await screen.rerender(screenWith({}, { canUndoRemoval: true }));
    await fireEvent.press(screen.getByRole("button", { name: "Rückgängig" }));
    expect(background.undoRemove).toHaveBeenCalledTimes(1);
    expect(background.choose).toHaveBeenCalledTimes(1);
  });
  it("keeps independent content switches and separates label and time choices", async () => {
    const screen = await render(screenWith());
    for (const [name, setter] of [
      ["Dienste & Abwesenheiten", mockDisplay.setShowShifts],
      ["Termine", mockDisplay.setShowAppointments],
      ["Feiertage", mockDisplay.setShowHolidays],
    ] as const) {
      await fireEvent.press(screen.getByRole("switch", { name }));
      expect(setter).toHaveBeenCalledWith(false);
    }
    const labels = within(screen.getByTestId("calendar-label-settings"));
    const times = within(screen.getByTestId("calendar-time-settings"));
    expect(labels.getAllByRole("radio")).toHaveLength(3);
    expect(times.getAllByRole("radio")).toHaveLength(3);
    expect(labels.queryByRole("radio", { name: "Startzeit" })).toBeNull();
    expect(times.queryByRole("radio", { name: "Name" })).toBeNull();
    await fireEvent.press(labels.getByRole("radio", { name: "Kürzel" }));
    expect(mockDisplay.setLabelMode).not.toHaveBeenCalled();
    await fireEvent.press(labels.getByRole("radio", { name: "Name" }));
    expect(mockDisplay.setLabelMode).toHaveBeenCalledWith("FULL");
    await fireEvent.press(times.getByRole("radio", { name: "Keine", checked: true }));
    expect(mockDisplay.setTimeDisplay).not.toHaveBeenCalled();
    await fireEvent.press(times.getByRole("radio", { name: "Startzeit" }));
    expect(mockDisplay.setTimeDisplay).toHaveBeenLastCalledWith("START");
    await fireEvent.press(times.getByRole("radio", { name: "Gesamtdauer" }));
    expect(mockDisplay.setTimeDisplay).toHaveBeenLastCalledWith("DURATION");
    mockDisplay.showShiftDuration = true;
    await screen.rerender(screenWith());
    expect(times.getByRole("radio", { name: "Gesamtdauer", checked: true })).toBeTruthy();
    await fireEvent.press(times.getByRole("radio", { name: "Keine" }));
    expect(mockDisplay.setTimeDisplay).toHaveBeenLastCalledWith("NONE");
    expect(mockDisplay.setShowShiftTimes).not.toHaveBeenCalled();
    expect(mockDisplay.setShowShiftDuration).not.toHaveBeenCalled();
  });
  it.each<[boolean, boolean, string | null]>([
    [false, false, "Keine"],
    [true, false, "Startzeit"],
    [false, true, "Gesamtdauer"],
    [true, true, null],
  ])(
    "keeps the stored time combination %s/%s until an explicit choice",
    async (times, duration, label) => {
      mockDisplay.showShiftTimes = times;
      mockDisplay.showShiftDuration = duration;
      const screen = await render(screenWith());
      const group = within(screen.getByTestId("calendar-time-settings"));
      if (label) {
        expect(group.getAllByRole("radio", { checked: true })).toHaveLength(1);
        expect(group.getByRole("radio", { name: label, checked: true })).toBeTruthy();
      } else {
        expect(group.queryAllByRole("radio", { checked: true })).toHaveLength(0);
        expect(group.getByText(/Bisher werden Startzeit und Gesamtdauer angezeigt/)).toBeTruthy();
      }
      expect(mockDisplay.setTimeDisplay).not.toHaveBeenCalled();
    },
  );
  it("offers three named color dots with fixed opacity and follows the selection in the live preview", async () => {
    const screen = await render(screenWith());
    const group = within(screen.getByTestId("calendar-holiday-color-settings"));
    expect(group.getAllByRole("radio")).toHaveLength(3);
    expect(group.getByRole("radio", { name: "Orange", checked: true })).toBeTruthy();
    expect(group.queryByRole("adjustable")).toBeNull();
    await fireEvent.press(group.getByRole("radio", { name: "Blau" }));
    expect(mockDisplay.setHolidayColor).toHaveBeenCalledWith("BLUE");
    mockDisplay.holidayColor = "BLUE";
    await screen.rerender(screenWith());
    expect(screen.getByTestId("calendar-combined-day-2026-10-01")).toHaveStyle({
      backgroundColor: "#3B82D040",
    });
    mockDisplay.showHolidays = false;
    await screen.rerender(screenWith());
    expect(group.getByRole("radio", { name: "Blau", checked: true })).toBeDisabled();
    expect(screen.getByTestId("calendar-combined-day-2026-10-01")).toHaveStyle({
      backgroundColor: "transparent",
    });
  });

  it("retains label and time values while hidden services disable their controls", async () => {
    mockDisplay.showShifts = false;
    mockDisplay.showShiftTimes = true;
    mockDisplay.showShiftDuration = true;
    const screen = await render(screenWith());
    expect(screen.getByRole("radio", { name: "Kürzel", checked: true })).toBeDisabled();
    for (const name of ["Name", "Kürzel", "Symbol"]) {
      await fireEvent.press(screen.getByRole("radio", { name }));
      expect(screen.getByRole("radio", { name })).toBeDisabled();
    }
    for (const name of ["Startzeit", "Gesamtdauer"])
      expect(screen.getByRole("radio", { name })).toBeDisabled();
    expect(screen.getByText(/Aktiviere Dienste/)).toBeTruthy();
    expect(mockDisplay.setLabelMode).not.toHaveBeenCalled();
    expect(mockDisplay.setShowShiftTimes).not.toHaveBeenCalled();
    expect(mockDisplay.setShowShiftDuration).not.toHaveBeenCalled();
    mockDisplay.showShifts = true;
    await screen.rerender(screenWith());
    expect(screen.getByRole("radio", { name: "Kürzel", checked: true })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Startzeit" })).toBeEnabled();
    expect(screen.getByText(/Bisher werden Startzeit und Gesamtdauer angezeigt/)).toBeTruthy();
    expect(mockDisplay.setTimeDisplay).not.toHaveBeenCalled();
  });
  it("shows a calendar persistence failure and never announces a saved selection", async () => {
    mockDisplay.error = "Kalenderansicht konnte nicht gespeichert werden.";
    const screen = await render(screenWith());
    expect(screen.getByText(mockDisplay.error)).toBeTruthy();
    expect(screen.getByText("Nicht alle Änderungen wurden gespeichert.")).toBeTruthy();
    expect(screen.queryByText("Auswahl gespeichert.")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Kalenderoptionen erneut versuchen" }),
    );
    expect(mockDisplay.retry).toHaveBeenCalled();
  });
  it("does not allow default values to overwrite an unloaded profile's preferences", async () => {
    mockDisplay.ready = false;
    const screen = await render(screenWith());
    for (const name of ["Dienste & Abwesenheiten", "Termine", "Feiertage"])
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    for (const name of ["Name", "Kürzel", "Symbol", "Keine", "Startzeit", "Gesamtdauer"]) {
      expect(screen.getByRole("radio", { name })).toBeDisabled();
      await fireEvent.press(screen.getByRole("radio", { name }));
    }
    expect(mockDisplay.setTimeDisplay).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Kalenderoptionen zurücksetzen" })).toBeDisabled();
  });
  it("names the calendar-only reset scope explicitly", async () => {
    const alert = jest.spyOn(ReactNative.Alert, "alert");
    const screen = await render(screenWith({ mode: "dark" }));
    await fireEvent.press(screen.getByRole("button", { name: "Kalenderoptionen zurücksetzen" }));
    expect(alert.mock.calls[0][1]).toMatch(
      /Kalenderfoto wird entfernt und die Kalenderanzeige zurückgesetzt/,
    );
    expect(alert.mock.calls[0][1]).toMatch(
      /Hell-\/Dunkelmodus, Schichtfarben, Profile und Dienste bleiben erhalten/,
    );
    await alert.mock.calls[0][2]?.find((button) => button.text === "Zurücksetzen")?.onPress?.();
    expect(mockDisplay.resetDisplay).toHaveBeenCalledTimes(1);
    expect(preferences.reset).not.toHaveBeenCalled();
    expect(preferences.setMode).not.toHaveBeenCalled();
  });
});
