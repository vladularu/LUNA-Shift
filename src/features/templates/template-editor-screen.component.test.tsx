import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { ActionSheetIOS } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { TemplateEditorScreen } from "@/features/templates/template-editor-screen";
import type { SaveShiftTemplateInput, ShiftTemplate, ShiftType, UserProfile } from "@/domain/types";
import { newSpecialDuty } from "@/domain/special-duty";

const mockUpsertShift = jest.fn<() => Promise<void>>();
const mockUpsertTemplate = jest.fn<(input: SaveShiftTemplateInput) => Promise<ShiftTemplate>>();
const mockRemoveTemplate = jest.fn<() => Promise<void>>();
let mockParams: { id?: string; quickEntryDate?: string } = {};
let mockTemplates: readonly ShiftTemplate[] = [];
let mockProfile: UserProfile | null = null;

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), dismiss: jest.fn(), push: jest.fn() },
  Stack: {
    Screen: () => null,
    Toolbar: Object.assign(({ children }: { children: ReactNode }) => children, {
      View: ({ children }: { children: ReactNode }) => children,
    }),
  },
  useFocusEffect: (effect: () => void) => effect(),
  useLocalSearchParams: () => mockParams,
}));

jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
  usePflegeShiftEntries: () => ({ entries: [], upsertShift: mockUpsertShift }),
  usePflegeShiftStatus: () => ({ error: null, ready: true, reload: jest.fn() }),
  usePflegeShiftTemplates: () => ({
    templates: mockTemplates,
    removeTemplate: mockRemoveTemplate,
    upsertTemplate: mockUpsertTemplate,
  }),
}));

async function renderEditor() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, right: 0, bottom: 34, left: 0 },
      }}
    >
      <TemplateEditorScreen />
    </SafeAreaProvider>,
  );
}

describe("TemplateEditorScreen compact layout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockTemplates = [];
    mockProfile = null;
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: true,
    } as Notifications.NotificationPermissionsStatus);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      granted: true,
    } as Notifications.NotificationPermissionsStatus);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns one level after saving from the replaced calendar picker", async () => {
    mockParams = { quickEntryDate: "2026-08-15" };
    mockUpsertTemplate.mockImplementation(async (input) => ({
      ...input,
      id: "saved-template",
      revision: 1,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      deletedAt: null,
    }));
    mockUpsertShift.mockResolvedValue(undefined);
    await renderEditor();
    await fireEvent.changeText(screen.getByLabelText("Titel"), "Testdienst");
    await fireEvent.press(screen.getByRole("button", { name: "Vorlage erstellen und eintragen" }));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(mockUpsertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Testdienst", type: "CUSTOM" }),
    );
    expect(mockUpsertShift).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-08-15", templateId: "saved-template" }),
    );
    expect(screen.queryByRole("button", { name: "Speichern und schließen" })).toBeNull();
    expect(router.dismiss).not.toHaveBeenCalled();
  });

  it.each(["EARLY", "LATE", "NIGHT", "DAY"] as const)(
    "preserves the existing %s service type when selecting Dienst and saving",
    async (type) => {
      const existing: ShiftTemplate = {
        id: "saved-template",
        name: "Früh",
        type,
        allDay: false,
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        color: "#7C4DCC",
        symbol: "F",
        notification: null,
        location: null,
        sortOrder: 10,
        revision: 1,
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
        deletedAt: null,
      };
      mockTemplates = [existing];
      mockParams = { id: existing.id, quickEntryDate: "2026-08-15" };
      mockUpsertTemplate.mockResolvedValue(existing);
      await renderEditor();

      expect(screen.getByLabelText("Eintragsart: Dienst")).toBeVisible();
      jest
        .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
        .mockImplementation((_options, callback) => callback(0));
      await fireEvent.press(screen.getByTestId("template-type-row"));
      await fireEvent.changeText(screen.getByLabelText("Titel"), "Früh geändert");
      await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));

      await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
      expect(mockUpsertTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: existing.id,
          name: "Früh geändert",
          type,
          startTime: existing.startTime,
          endTime: existing.endTime,
          color: existing.color,
          symbol: existing.symbol,
        }),
      );
      expect(mockUpsertShift).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Vorlage erstellen und eintragen" })).toBeNull();
    },
  );

  it("retries only the calendar entry when the new template was already saved", async () => {
    mockParams = { quickEntryDate: "2026-08-15" };
    mockUpsertTemplate.mockImplementation(async (input) => ({
      ...input,
      id: "saved-template",
      revision: 1,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      deletedAt: null,
    }));
    mockUpsertShift.mockRejectedValueOnce(new Error("Temporary write failure"));
    mockUpsertShift.mockResolvedValueOnce(undefined);
    await renderEditor();
    await fireEvent.changeText(screen.getByLabelText("Titel"), "Testdienst");
    await fireEvent.press(screen.getByRole("button", { name: "Vorlage erstellen und eintragen" }));
    await waitFor(() => expect(mockUpsertShift).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText("Vorlage gespeichert, Dienst nicht eingetragen. Versuche es erneut."),
      ).toBeVisible(),
    );
    expect(router.back).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Vorlage erstellen und eintragen" }));

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(mockUpsertTemplate).toHaveBeenCalledTimes(1);
    expect(mockUpsertShift).toHaveBeenCalledTimes(2);
    expect(mockUpsertShift).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: "2026-08-15", templateId: "saved-template" }),
    );
  });

  it("keeps the default editor compact and preserves usable row heights", async () => {
    await renderEditor();

    expect(screen.getByText("Standardwerte")).toBeVisible();
    expect(screen.queryByText("Darstellung")).toBeNull();
    expect(screen.queryByText("Zeiten")).toBeNull();
    expect(screen.queryByText("Weitere Angaben")).toBeNull();
    expect(screen.queryByTestId("template-appearance-options")).toBeNull();
    expect(screen.queryByLabelText("Symbol auswählen")).toBeNull();

    expect(screen.getByTestId("template-title-row")).toHaveStyle({ minHeight: 40 });
    expect(screen.getByTestId("template-appearance-toggle")).toHaveStyle({ minHeight: 56 });
    expect(screen.getByTestId("template-type-row")).toHaveStyle({ minHeight: 56 });
    expect(screen.getByTestId("template-all-day-row")).toHaveStyle({ minHeight: 56 });
    expect(screen.getByTestId("template-pause-row")).toHaveStyle({ minHeight: 56 });
    expect(screen.getByTestId("template-notification-row")).toHaveStyle({ minHeight: 56 });
    expect(screen.getByTestId("template-location-row")).toHaveStyle({ minHeight: 56 });
  });

  it("auto-applies symbol and color choices and collapses from the symbol row", async () => {
    await renderEditor();

    await fireEvent.press(screen.getByTestId("template-appearance-toggle"));

    expect(screen.getByTestId("template-appearance-options")).toBeVisible();
    expect(screen.getByLabelText("Symbol auswählen")).toBeVisible();
    expect(screen.getByText("Farbe")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Ok" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Symbol und Farbe schließen" }));

    expect(screen.queryByTestId("template-appearance-options")).toBeNull();
  });

  it("uses the compact service-editor pause wheel without a numeric input", async () => {
    await renderEditor();

    expect(screen.getByTestId("template-pause-row").props.accessibilityState).toMatchObject({
      expanded: false,
    });
    await fireEvent.press(screen.getByRole("button", { name: "Pause: 30 Minuten" }));

    expect(screen.getByTestId("template-pause-popover")).toBeVisible();
    expect(screen.getByTestId("template-pause-selection")).toHaveStyle({ height: 44 });
    expect(screen.getAllByRole("radio")).toHaveLength(5);

    await fireEvent.press(screen.getByRole("radio", { name: "45 Minuten" }));

    expect(screen.getByRole("button", { name: "Pause: 45 Minuten" })).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "45 Minuten" }).props.accessibilityState,
    ).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole("button", { name: "Pause: 45 Minuten" }));
    expect(screen.queryByTestId("template-pause-popover")).toBeNull();
  });

  it("uses the same compact notification overlay as shift and appointment editing", async () => {
    await renderEditor();

    await fireEvent.press(screen.getByTestId("template-notification-row"));

    expect(screen.getByTestId("shift-notification-presets")).toBeVisible();
    expect(screen.queryByLabelText("Erinnerung übernehmen")).toBeNull();

    await fireEvent.press(screen.getByRole("radio", { name: "5 Minuten vor Beginn" }));

    await waitFor(() => expect(screen.queryByTestId("shift-notification-presets")).toBeNull());
    expect(screen.getByLabelText("Erinnerung: 5 Min. vor Beginn")).toBeVisible();
  });

  it.each<[number, string, ShiftType]>([
    [0, "Dienst", "CUSTOM"],
    [1, "Fortbildung", "TRAINING"],
    [2, "Urlaub", "VACATION"],
    [3, "Krank", "SICK"],
    [4, "Frei", "FREE"],
  ])("selects and saves entry type %s: %s", async (index, label, type) => {
    const picker = jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((_options, callback) => callback(index));
    mockUpsertTemplate.mockImplementation(async (input) => ({
      ...input,
      id: "saved-template",
      revision: 1,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      deletedAt: null,
    }));
    await renderEditor();

    await fireEvent.press(screen.getByTestId("template-type-row"));

    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Eintragsart",
        options: ["Dienst", "Fortbildung", "Urlaub", "Krank", "Frei", "Abbrechen"],
        cancelButtonIndex: 5,
      }),
      expect.any(Function),
    );
    expect(screen.getByLabelText(`Eintragsart: ${label}`)).toBeVisible();
    const absence = (["VACATION", "SICK", "FREE"] as readonly ShiftType[]).includes(type);
    if (absence) {
      expect(screen.queryByTestId("template-start-row")).toBeNull();
      expect(screen.queryByTestId("template-end-row")).toBeNull();
      expect(screen.queryByTestId("template-pause-row")).toBeNull();
    } else {
      expect(screen.getByTestId("template-start-row")).toBeVisible();
    }
    await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
    await waitFor(() =>
      expect(mockUpsertTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ type, allDay: absence }),
      ),
    );
  });

  it("keeps Dienst selected when the entry-type picker is cancelled", async () => {
    jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((_options, callback) => callback(5));
    await renderEditor();

    await fireEvent.press(screen.getByTestId("template-type-row"));

    expect(screen.getByLabelText("Eintragsart: Dienst")).toBeVisible();
    expect(mockUpsertTemplate).not.toHaveBeenCalled();
  });

  it("hides timed values when the template is all-day", async () => {
    await renderEditor();

    await fireEvent(screen.getByLabelText("Dienstvorlage ganztägig"), "valueChange", true);

    expect(screen.queryByTestId("template-start-row")).toBeNull();
    expect(screen.queryByTestId("template-end-row")).toBeNull();
    expect(screen.queryByTestId("template-pause-row")).toBeNull();
  });

  it.each(["SPLIT", "ON_CALL", "STANDBY"] as const)(
    "opens, edits and saves the existing %s template without duplicate time or pause controls",
    async (kind) => {
      const existing: ShiftTemplate = {
        id: "special-template",
        name: "Sonderdienst",
        type: "CUSTOM",
        allDay: false,
        startTime: "08:00",
        endTime: "10:00",
        breakMinutes: kind === "ON_CALL" ? 0 : 15,
        specialDuty: {
          ...newSpecialDuty(kind, "08:00", "10:00", "Europe/Berlin"),
          parts: kind === "SPLIT" ? [{ start: 1020, end: 1260, breakMinutes: 7 }] : [],
          standbyLevel: kind === "STANDBY" ? "II" : "UNKNOWN",
          settlement: kind === "STANDBY" ? "PAY" : "UNKNOWN",
        },
        color: "#7C4DCC",
        symbol: "S",
        notification: null,
        location: null,
        sortOrder: 10,
        revision: 1,
        createdAt: "2026-10-29T00:00:00.000Z",
        updatedAt: "2026-10-29T00:00:00.000Z",
        deletedAt: null,
      };
      mockTemplates = [existing];
      mockParams = { id: existing.id };
      mockUpsertTemplate.mockResolvedValue(existing);
      await renderEditor();
      expect(screen.queryByTestId("template-start-row")).toBeNull();
      expect(screen.queryByTestId("template-pause-row")).toBeNull();
      expect(screen.queryByLabelText("Einsatz hinzufügen")).toBeNull();
      if (kind === "SPLIT")
        expect(screen.getByRole("button", { name: "Dienstteil 2: Pause: 7 Minuten" })).toBeTruthy();
      if (kind === "STANDBY") expect(screen.getByText("Stufe II")).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText("Titel"), "Sonderdienst geändert");
      await fireEvent.press(screen.getByRole("button", { name: "Speichern und schließen" }));
      await waitFor(() =>
        expect(mockUpsertTemplate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Sonderdienst geändert",
            startTime: "08:00",
            endTime: "10:00",
            breakMinutes: existing.breakMinutes,
            specialDuty: existing.specialDuty,
          }),
        ),
      );
    },
  );

  it("inherits the stored tariff profile for readiness templates without asking for it again", async () => {
    mockProfile = {
      federalState: "NW",
      holidayRegion: "NONE",
      timeZone: "Europe/Berlin",
      weeklyMinutes: 2310,
      regularRotatingNightWork: true,
      sundayHolidayWorkEligible: true,
      allEmploymentWorkRecorded: true,
      tariff: {
        payGroup: "P8",
        payLevel: 3,
        sector: "BT_B",
        tariffRegion: "OTHER",
        fullTimeWeeklyMinutes: 2310,
      },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((options, callback) => {
        const index = options.options.indexOf("Bereitschaftsdienst");
        expect(index).toBeGreaterThanOrEqual(0);
        callback(index);
      });
    await renderEditor();
    await fireEvent.press(screen.getByLabelText("Dienstform: Regulärer Dienst"));
    await fireEvent.press(screen.getByText("Abrechnung"));
    expect(screen.getByText("Tarif aus deinem Profil: TVöD Pflege/Betreuung")).toBeTruthy();
    expect(screen.queryByText("Tarifbereich der Bereitschaft")).toBeNull();
    expect(screen.getByText("Bewertung laut Arbeitgeber")).toBeTruthy();
  });
});
