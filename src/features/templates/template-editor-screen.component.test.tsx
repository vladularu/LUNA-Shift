import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import type { ReactNode } from "react";
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

async function selectNativeOption(prefix: string, label: string) {
  const picker = screen.getByTestId(prefix + "-options");
  const option = within(picker).getByTestId(prefix + "-option:" + label);
  await fireEvent(picker, "selectionChange", {
    nativeEvent: { selection: option.props.modifiers[0].tag },
  });
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

      await selectNativeOption("template-type", "Dienst");
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
    expect(screen.getByTestId("template-type-menu")).toBeTruthy();
    expect(screen.getByTestId("template-all-day-row")).toHaveStyle({ minHeight: 56 });
    expect(screen.getByTestId("template-pause-menu")).toBeTruthy();
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

  it("uses the native service-editor pause menu and keeps the choice when dismissed", async () => {
    await renderEditor();

    const picker = screen.getByTestId("template-pause-options");
    expect(picker).toHaveProp("selection", "30");
    expect(within(picker).getAllByTestId(/^template-pause-option:/)).toHaveLength(5);
    await selectNativeOption("template-pause", "45 Min.");
    expect(screen.getByTestId("template-pause-options")).toHaveProp("selection", "45");
    await fireEvent(picker, "selectionChange", { nativeEvent: { selection: null } });
    expect(screen.getByTestId("template-pause-options")).toHaveProp("selection", "45");
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

  it.each<[string, ShiftType]>([
    ["Dienst", "CUSTOM"],
    ["Fortbildung", "TRAINING"],
    ["Urlaub", "VACATION"],
    ["Krank", "SICK"],
    ["Frei", "FREE"],
  ])("selects and saves entry type %s", async (label, type) => {
    mockUpsertTemplate.mockImplementation(async (input) => ({
      ...input,
      id: "saved-template",
      revision: 1,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      deletedAt: null,
    }));
    await renderEditor();

    const options = within(screen.getByTestId("template-type-options")).getAllByTestId(
      /^template-type-option:/,
    );
    expect(options.map((row) => row.props.testID.split(":")[1])).toEqual([
      "Dienst",
      "Fortbildung",
      "Urlaub",
      "Krank",
      "Frei",
    ]);
    await selectNativeOption("template-type", label);
    expect(screen.getByTestId("template-type-options")).toHaveProp("selection", type);
    const absence = (["VACATION", "SICK", "FREE"] as readonly ShiftType[]).includes(type);
    if (absence) {
      expect(screen.queryByTestId("template-start-row")).toBeNull();
      expect(screen.queryByTestId("template-end-row")).toBeNull();
      expect(screen.queryByTestId("template-pause-menu")).toBeNull();
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
    await renderEditor();
    const picker = screen.getByTestId("template-type-options");
    await fireEvent(picker, "selectionChange", { nativeEvent: { selection: null } });
    expect(picker).toHaveProp("selection", "CUSTOM");
    expect(mockUpsertTemplate).not.toHaveBeenCalled();
  });

  it("hides timed values when the template is all-day", async () => {
    await renderEditor();

    await fireEvent(screen.getByLabelText("Dienstvorlage ganztägig"), "valueChange", true);

    expect(screen.queryByTestId("template-start-row")).toBeNull();
    expect(screen.queryByTestId("template-end-row")).toBeNull();
    expect(screen.queryByTestId("template-pause-menu")).toBeNull();
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
      expect(screen.queryByTestId("template-pause-menu")).toBeNull();
      expect(screen.queryByLabelText("Einsatz hinzufügen")).toBeNull();
      if (kind === "SPLIT")
        expect(screen.getByTestId("duty-pause-Dienstteil 2-options")).toHaveProp("selection", "7");
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
    await renderEditor();
    await selectNativeOption("duty-choice:Dienstform", "Bereitschaftsdienst");
    await fireEvent.press(screen.getByText("Abrechnung"));
    expect(screen.getByText("Tarif aus deinem Profil: TVöD Pflege/Betreuung")).toBeTruthy();
    expect(screen.queryByText("Tarifbereich der Bereitschaft")).toBeNull();
    expect(screen.getByText("Bewertung laut Arbeitgeber")).toBeTruthy();
  });
});
