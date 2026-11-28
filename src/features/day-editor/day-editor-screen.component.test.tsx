import { SharedCalendarsContext } from "@/application/shared-calendars-context";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { Alert, Dimensions } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type {
  Appointment,
  CalendarEntry,
  SaveAppointmentInput,
  ShiftEntry,
  UserProfile,
} from "@/domain/types";
import { EMPTY_ABSENCE_PAY } from "@/domain/absence-pay";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS as mockWorkPattern } from "@/engine/simple-pay";
import { DayEditorScreen } from "@/features/day-editor/day-editor-screen";
import {
  clearEntryTextEditorRequest,
  pendingEntryTextEditor,
  type EntryTextKind,
} from "@/features/day-editor/entry-text-editor-session";
import { FeedbackProvider } from "@/ui/feedback";
import { deletionFeedback, successFeedback } from "@/ui/haptics";

const mockUpsertShift = jest.fn<() => Promise<ShiftEntry>>();
const mockUpsertAppointment = jest.fn<(input: SaveAppointmentInput) => Promise<Appointment>>();
const mockRemoveEntry = jest.fn<(entry: CalendarEntry) => Promise<void>>();
let mockProfile: UserProfile | null = null;
let mockEntries: CalendarEntry[] = [];
let mockBeforeRemoveListener:
  ((event: { preventDefault: () => void; data: { action: { type: string } } }) => void) | null =
  null;
const mockNavigationDispatch = jest.fn();
const dragEditorSheet = (translationY: number, editor = "shift") =>
  act(() => {
    fireGestureHandler(getByGestureTestId(`${editor}-edit-dismiss-gesture`), [
      { state: State.BEGAN, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationY, velocityY: 0 },
      { state: State.END, translationY, velocityY: 0 },
    ]);
  });
let mockRouteParams: {
  date: string;
  mode: "SHIFT" | "APPOINTMENT";
  entryId?: string;
  sharedCalendarId?: string;
} = {
  date: "2026-08-04",
  mode: "SHIFT",
};

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), dismissTo: jest.fn(), push: jest.fn() },
  Stack: {
    Screen: ({ options }: { options: { headerLeft?: () => React.ReactNode } }) =>
      options.headerLeft?.() ?? null,
  },
  useFocusEffect: (effect: () => void) => effect(),
  useNavigation: () => ({
    addListener: () => jest.fn(),
    dispatch: mockNavigationDispatch,
  }),
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock("expo-router/react-navigation", () => ({
  usePreventRemove: (
    enabled: boolean,
    callback: (event: { data: { action: { type: string } } }) => void,
  ) => {
    mockBeforeRemoveListener = enabled
      ? (event) => {
          event.preventDefault();
          callback({ data: event.data });
        }
      : null;
  },
}));

jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({
    entries: mockEntries,
    upsertShift: mockUpsertShift,
    upsertAppointment: mockUpsertAppointment,
    removeEntry: mockRemoveEntry,
  }),
  usePflegeShiftProfile: () => ({ profile: mockProfile }),
  usePflegeShiftTariff: () => ({ tariffDecisions: [], workPatternSettings: mockWorkPattern }),
  usePflegeShiftTestData: () => ({ testMonths: [] }),
  usePflegeShiftStatus: () => ({ error: null, ready: true, reload: jest.fn() }),
  usePflegeShiftTemplates: () => ({ templates: [] }),
}));

jest.mock("@/application/rule-catalog-runtime-provider", () => {
  const { bundledRuleResolver } =
    jest.requireActual<typeof import("@/rules/rule-resolver")>("@/rules/rule-resolver");
  return { useRuleCatalogRuntime: () => ({ resolver: bundledRuleResolver }) };
});

jest.mock("@/ui/haptics", () => ({
  deletionFeedback: jest.fn(),
  selectionFeedback: jest.fn(),
  successFeedback: jest.fn(),
  warningFeedback: jest.fn(),
}));

async function confirmEntryText(
  screen: Awaited<ReturnType<typeof render>>,
  kind: EntryTextKind,
  value: string,
) {
  const name = kind === "title" ? /^Titel:/ : /^Notiz (hinzufügen|bearbeiten)/;
  await fireEvent.press(screen.getByRole("button", { name }));
  const href = jest.mocked(router.push).mock.lastCall?.[0];
  const request = typeof href === "object" ? href.params?.request : undefined;
  const textEditor = pendingEntryTextEditor(request);
  if (!textEditor || textEditor.kind !== kind) throw new Error("Unexpected text editor request");
  clearEntryTextEditorRequest(request);
  await act(() => textEditor.onConfirm(value));
}

describe("DayEditorScreen", () => {
  beforeEach(() => {
    mockRemoveEntry.mockReset().mockResolvedValue(undefined);
    jest.mocked(deletionFeedback).mockClear();
    mockUpsertShift.mockReset();
    mockUpsertShift.mockResolvedValue({ id: "saved" } as ShiftEntry);
    mockUpsertAppointment.mockReset();
    mockUpsertAppointment.mockResolvedValue({ id: "saved-appointment" } as Appointment);
    jest.mocked(router.back).mockClear();
    jest.mocked(router.push).mockClear();
    jest.mocked(router.dismissTo).mockClear();
    jest.mocked(successFeedback).mockClear();
    mockBeforeRemoveListener = null;
    mockNavigationDispatch.mockClear();
    mockProfile = null;
    mockEntries = [];
    mockRouteParams = { date: "2026-08-04", mode: "SHIFT" };
  });

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "protects %s native dismissal until one pending save succeeds",
    async (mode) => {
      mockRouteParams = { date: "2026-08-20", mode };
      let finish!: () => void;
      if (mode === "SHIFT")
        mockUpsertShift.mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = () => resolve({ id: "saved" } as ShiftEntry);
            }),
        );
      else
        mockUpsertAppointment.mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = () => resolve({ id: "saved" } as Appointment);
            }),
        );
      const screen = await render(deletionScreen());
      if (mode === "APPOINTMENT") {
        await fireEvent(
          screen.getByRole("switch", { name: "Termin ganztägig" }),
          "valueChange",
          true,
        );
      }
      const action = { type: "GO_BACK" };
      const preventDefault = jest.fn();
      await act(() => {
        mockBeforeRemoveListener?.({ preventDefault, data: { action } });
        mockBeforeRemoveListener?.({ preventDefault, data: { action } });
      });
      expect(preventDefault).toHaveBeenCalledTimes(2);
      expect(mode === "SHIFT" ? mockUpsertShift : mockUpsertAppointment).toHaveBeenCalledTimes(1);
      expect(mockNavigationDispatch).not.toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Schließen und speichern" })).toBeDisabled();
      expect(
        screen.getByTestId(mode === "SHIFT" ? "shift-edit-sheet" : "appointment-edit-sheet"),
      ).toHaveProp("pointerEvents", "none");
      await act(() => finish());
      expect(mockNavigationDispatch).toHaveBeenCalledTimes(1);
      expect(mockNavigationDispatch).toHaveBeenCalledWith(action);
      expect(mockBeforeRemoveListener).toBeNull();
      expect(router.back).not.toHaveBeenCalled();
    },
  );

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "keeps the %s draft after a native-dismiss save failure and retries only deliberately",
    async (mode) => {
      mockRouteParams = { date: "2026-08-20", mode };
      if (mode === "SHIFT") mockUpsertShift.mockRejectedValueOnce(new Error("offline database"));
      else mockUpsertAppointment.mockRejectedValueOnce(new Error("offline database"));
      const screen = await render(deletionScreen());
      await confirmEntryText(screen, "note", "Entwurf behalten");
      const event = { preventDefault: jest.fn(), data: { action: { type: "GO_BACK" } } };
      await act(async () => {
        mockBeforeRemoveListener?.(event);
      });
      expect(screen.getByText("Entwurf behalten")).toBeTruthy();
      expect(screen.getByText("Eintrag konnte nicht gespeichert werden.")).toBeTruthy();
      expect(mockNavigationDispatch).not.toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
      expect(mockBeforeRemoveListener).not.toBeNull();
      expect(
        screen.getByTestId(mode === "SHIFT" ? "shift-edit-sheet" : "appointment-edit-sheet"),
      ).toHaveProp("pointerEvents", "auto");
      expect(mode === "SHIFT" ? mockUpsertShift : mockUpsertAppointment).toHaveBeenCalledTimes(1);
      await act(async () => {
        mockBeforeRemoveListener?.(event);
      });
      expect(mode === "SHIFT" ? mockUpsertShift : mockUpsertAppointment).toHaveBeenCalledTimes(2);
      expect(mockNavigationDispatch).toHaveBeenCalledTimes(1);
    },
  );

  it("blocks native dismissal of an invalid appointment before persistence", async () => {
    mockRouteParams = { date: "2026-08-20", mode: "APPOINTMENT" };
    const screen = await render(deletionScreen());
    await confirmEntryText(screen, "title", "");
    const preventDefault = jest.fn();
    await act(async () => {
      mockBeforeRemoveListener?.({ preventDefault, data: { action: { type: "GO_BACK" } } });
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockUpsertAppointment).not.toHaveBeenCalled();
    expect(mockNavigationDispatch).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Titel: Ohne Titel" })).toBeEnabled();
  });

  function deletionEntry(kind: "SHIFT" | "APPOINTMENT"): CalendarEntry {
    const common = {
      id: "delete-target",
      date: "2026-08-20",
      title: "Testeintrag",
      allDay: false,
      startTime: "08:00",
      endTime: "16:00",
      color: "#F05C68",
      note: "Notiz behalten",
      notification: null,
      location: null,
      revision: 4,
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
      deletedAt: null,
    };
    return kind === "SHIFT"
      ? {
          ...common,
          kind,
          templateId: null,
          type: "EARLY",
          breakMinutes: 30,
          symbol: "F",
          alarmEnabled: false,
          overtimeMinutes: 0,
          holidayPremiumMode: "WITH_TIME_OFF",
        }
      : { ...common, kind, recurrence: null };
  }

  function deletionScreen() {
    return (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 430, height: 932 },
          insets: { top: 59, right: 0, bottom: 34, left: 0 },
        }}
      >
        <FeedbackProvider>
          <DayEditorScreen />
        </FeedbackProvider>
      </SafeAreaProvider>
    );
  }

  it.each(["VACATION", "SICK"] as const)(
    "shows the saved %s day’s U/K amount directly in the calendar sheet",
    async (type) => {
      mockProfile =
        type === "VACATION"
          ? forecastProfile
          : {
              ...forecastProfile,
              tariff: null,
              vkaETariff: { payGroup: "E8", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
            };
      const entry = forecastShift({
        id: "absence",
        date: "2026-10-12",
        type,
        allDay: true,
        startTime: null,
        endTime: null,
        absencePay:
          type === "SICK" ? { ...EMPTY_ABSENCE_PAY, day: "PAID", dailyRateCents: 1442 } : null,
      });
      mockEntries = [
        ...["2026-07-12", "2026-08-09", "2026-09-13"].map((date) =>
          forecastShift({ id: date, date }),
        ),
        entry,
      ];
      mockRouteParams = { date: entry.date, mode: "SHIFT", entryId: entry.id };
      const screen = await render(deletionScreen());
      const card = within(screen.getByTestId("shift-edit-overview"));
      expect(card.getByText("U/K-Aufschlag")).toBeTruthy();
      const rate = card.getByText(type === "SICK" ? /14,42.*€/ : /ca\. [1-9]\d*,\d{2}.*€/).props
        .children;
      expect(card.queryByText(/Auszahlung/)).toBeNull();
      expect(card.queryByText("Zuschlag gesamt")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Dienst bearbeiten" }));
      expect(screen.getByText(rate)).toBeTruthy();
    },
  );

  it("shows a duty-free absence without a payment month", async () => {
    mockProfile = forecastProfile;
    const entry = forecastShift({
      id: "free",
      date: "2026-10-12",
      type: "VACATION",
      allDay: true,
      startTime: null,
      endTime: null,
      absencePay: { ...EMPTY_ABSENCE_PAY, day: "FREE" },
    });
    mockEntries = [entry];
    mockRouteParams = { date: entry.date, mode: "SHIFT", entryId: entry.id };
    const screen = await render(deletionScreen());
    const card = within(screen.getByTestId("shift-edit-overview"));
    expect(card.getByText("Kein Aufschlag")).toBeTruthy();
    expect(card.queryByText(/Auszahlung/)).toBeNull();
  });
  it("explains a missing reference month directly on the vacation overview", async () => {
    mockProfile = forecastProfile;
    const entry = forecastShift({
      id: "absence",
      date: "2026-10-12",
      type: "VACATION",
      allDay: true,
      startTime: null,
      endTime: null,
    });
    mockEntries = [entry];
    mockRouteParams = { date: entry.date, mode: "SHIFT", entryId: entry.id };
    const screen = await render(deletionScreen());
    const card = within(screen.getByTestId("shift-edit-overview"));
    expect(card.getByText("Offen")).toBeTruthy();
    expect(card.getByText(/Juli 2026/)).toBeTruthy();
    expect(card.queryByText(/0,00.*€/)).toBeNull();
    expect(card.queryByText(/Auszahlung/)).toBeNull();
  });

  it("opens the full editor by button or swipe and keeps the draft when returning to the overview", async () => {
    const saved = deletionEntry("SHIFT");
    if (saved.kind !== "SHIFT") throw new Error("Expected a shift fixture");
    const entry = {
      ...saved,
      date: "2026-11-27",
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:30",
      breakMinutes: 60,
    } satisfies CalendarEntry;
    mockEntries = [entry];
    mockRouteParams = { date: entry.date, mode: "SHIFT", entryId: entry.id };
    const screen = await render(deletionScreen());
    expect(screen.getByText("21:00 – 07:30")).toBeTruthy();
    expect(screen.getByText(/Ende am Sa\.? · 60 Min\. Pause/)).toBeTruthy();
    expect(screen.getByText("9 h 30 min")).toBeTruthy();
    expect(screen.getByText("Zuschlag gesamt")).toBeTruthy();
    expect(screen.getByLabelText("Nicht verfügbar")).toBeTruthy();
    expect(screen.queryByText("Notiz behalten")).toBeNull();
    const card = within(screen.getByTestId("shift-edit-card"));
    const footer = within(screen.getByTestId("shift-edit-close-arrival"));
    expect(card.queryByRole("button", { name: "Schließen und speichern" })).toBeNull();
    expect(footer.getByRole("button", { name: "Schließen und speichern" })).toBeTruthy();
    await fireEvent.press(card.getByRole("button", { name: "Dienst bearbeiten" }));
    expect(screen.getByText("Notiz behalten")).toBeTruthy();
    await confirmEntryText(screen, "note", "Geänderte Übergabe");
    await dragEditorSheet(110);
    expect(screen.getByText("Zuschlag gesamt")).toBeTruthy();
    expect(screen.queryByText("Notiz behalten")).toBeNull();
    expect(screen.queryByLabelText("Notizen")).toBeNull();
    expect(mockUpsertShift).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    await dragEditorSheet(-110);
    expect(screen.getByText("Geänderte Übergabe")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  });

  it.each<{ mode: "light" | "dark"; opacity: number }>([
    { mode: "light", opacity: 0.9 },
    { mode: "dark", opacity: 1 },
  ])(
    "dims the $mode overview and closes it with a full downward swipe",
    async ({ mode, opacity }) => {
      const colorScheme = jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(mode);
      try {
        const entry = deletionEntry("SHIFT");
        mockEntries = [entry];
        mockRouteParams = { date: entry.date, mode: "SHIFT", entryId: entry.id };
        const screen = await render(deletionScreen());
        expect(screen.getByTestId("shift-edit-backdrop")).toHaveStyle({ opacity });
        await dragEditorSheet(25);
        expect(screen.getByTestId("shift-edit-overview")).toBeTruthy();
        expect(router.back).not.toHaveBeenCalled();
        await dragEditorSheet(110);
        await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
        expect(mockUpsertShift).not.toHaveBeenCalled();
      } finally {
        colorScheme.mockRestore();
      }
    },
  );

  it("stages a saved appointment in the detached overview and keeps its draft across swipes", async () => {
    const saved = deletionEntry("APPOINTMENT");
    if (saved.kind !== "APPOINTMENT") throw new Error("Expected an appointment fixture");
    const entry = {
      ...saved,
      title: "Digidata",
      startTime: "12:00",
      endTime: "13:00",
      location: {
        name: "Besprechungsort",
        address: "Musterstraße 1",
        latitude: 49.64,
        longitude: 8.64,
      },
    };
    mockEntries = [entry];
    mockRouteParams = { date: entry.date, mode: entry.kind, entryId: entry.id };
    const screen = await render(deletionScreen());
    const card = screen.getByTestId("appointment-edit-card");
    const footer = screen.getByTestId("appointment-edit-close-arrival");
    expect(card).toHaveStyle({ marginHorizontal: 16 });
    expect(footer).toHaveStyle({ paddingHorizontal: 16 });
    expect(within(card).getByText("Digidata")).toBeTruthy();
    expect(within(card).getByText("12:00 – 13:00")).toBeTruthy();
    const map = screen.getByTestId("appointment-overview-map");
    expect(map).toHaveStyle({ marginTop: "auto" });
    expect(
      within(map).getByRole("button", { name: "Besprechungsort in Karten öffnen" }),
    ).toHaveStyle({ height: 100 });
    expect(screen.getByTestId("appointment-edit-sheet").parent).toHaveStyle({
      height: Dimensions.get("window").height * 0.54,
    });
    expect(within(card).queryByText("Notiz behalten")).toBeNull();
    expect(within(card).queryByText("Musterstraße 1")).toBeNull();
    expect(within(card).queryByText("Schließen")).toBeNull();
    expect(within(footer).getByText("Schließen")).toBeTruthy();
    const confirmDeletion = jest.spyOn(Alert, "alert");
    await fireEvent.press(within(card).getByRole("button", { name: "Termin löschen" }));
    expect(confirmDeletion.mock.calls.at(-1)?.[0]).toBe("Termin löschen?");
    expect(mockRemoveEntry).not.toHaveBeenCalled();
    await fireEvent.press(within(card).getByRole("button", { name: "Termin bearbeiten" }));
    expect(screen.getByText("Notiz behalten")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Besprechungsort in Karten öffnen" })).toHaveStyle({
      height: 126,
    });
    await confirmEntryText(screen, "title", "Geänderter Termin");
    await dragEditorSheet(110, "appointment");
    expect(screen.getByText("Geänderter Termin")).toBeTruthy();
    expect(mockUpsertAppointment).not.toHaveBeenCalled();
    await dragEditorSheet(-110, "appointment");
    expect(screen.getByRole("button", { name: "Titel: Geänderter Termin" })).toBeEnabled();
    await dragEditorSheet(110, "appointment");
    await dragEditorSheet(110, "appointment");
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(mockUpsertAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ id: entry.id, title: "Geänderter Termin" }),
    );
  });

  it.each([
    {
      scenario: "a blank note",
      note: "  ",
      location: { name: "Musterstraße 1", latitude: 49.64, longitude: 8.64 },
      hasMap: true,
    },
    { scenario: "no address", note: "Agenda", location: null, hasMap: false },
    {
      scenario: "an address without coordinates",
      note: "Agenda",
      location: { name: "Musterstraße 1" },
      hasMap: false,
    },
  ])("handles $scenario in the appointment overview", async ({ note, location, hasMap }) => {
    const saved = deletionEntry("APPOINTMENT");
    mockEntries = [{ ...saved, note, location }];
    mockRouteParams = { date: saved.date, mode: "APPOINTMENT", entryId: saved.id };
    const screen = await render(deletionScreen());
    const overview = within(screen.getByTestId("appointment-edit-overview"));
    expect(Boolean(overview.queryByRole("button", { name: /in Karten öffnen/ }))).toBe(hasMap);
    expect(overview.queryByText("Agenda")).toBeNull();
    expect(overview.queryByText("Musterstraße 1")).toBeNull();
  });

  it("opens a new appointment in the glass sheet and dismisses an untouched draft by swipe", async () => {
    mockRouteParams = { date: "2026-08-23", mode: "APPOINTMENT" };
    const screen = await render(deletionScreen());

    const card = within(screen.getByTestId("appointment-edit-card"));
    const footer = within(screen.getByTestId("appointment-edit-close-arrival"));
    expect(screen.getByTestId("appointment-edit-backdrop")).toBeTruthy();
    expect(card.getByRole("button", { name: /^Titel:/ })).toBeTruthy();
    expect(card.queryByRole("button", { name: "Schließen und speichern" })).toBeNull();
    expect(card.queryByRole("button", { name: "Termin bearbeiten" })).toBeNull();
    expect(footer.getByRole("button", { name: "Schließen und speichern" })).toBeTruthy();
    expect(mockBeforeRemoveListener).toBeNull();

    await dragEditorSheet(-110, "appointment");
    expect(card.getByRole("button", { name: "Speichern" })).toBeTruthy();
    await dragEditorSheet(110, "appointment");
    expect(screen.getByRole("button", { name: /^Titel:/ })).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    await dragEditorSheet(110, "appointment");

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(mockUpsertAppointment).not.toHaveBeenCalled();
    expect(mockUpsertShift).not.toHaveBeenCalled();
    expect(mockRemoveEntry).not.toHaveBeenCalled();
  });

  it("does not create an appointment after visiting options and reverting edits", async () => {
    mockRouteParams = { date: "2026-08-23", mode: "APPOINTMENT" };
    const screen = await render(deletionScreen());

    await fireEvent.press(screen.getByRole("button", { name: "Wiederholen: Niemals" }));
    await fireEvent.press(screen.getByRole("button", { name: "Wiederholung schließen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Keine" }));
    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung schließen" }));
    await confirmEntryText(screen, "title", "Arzttermin");
    expect(mockBeforeRemoveListener).not.toBeNull();
    await confirmEntryText(screen, "title", "Ohne Titel");
    await fireEvent(screen.getByRole("switch", { name: "Termin ganztägig" }), "valueChange", true);
    await fireEvent(screen.getByRole("switch", { name: "Termin ganztägig" }), "valueChange", false);
    await confirmEntryText(screen, "note", "Notiz");
    await confirmEntryText(screen, "note", "");

    expect(mockBeforeRemoveListener).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(mockUpsertAppointment).not.toHaveBeenCalled();
  });

  it("saves a new untitled appointment exactly once when only its settings change", async () => {
    mockRouteParams = { date: "2026-08-23", mode: "APPOINTMENT" };
    const screen = await render(deletionScreen());
    await fireEvent(screen.getByRole("switch", { name: "Termin ganztägig" }), "valueChange", true);
    const action = { type: "GO_BACK" };
    await act(async () => {
      mockBeforeRemoveListener?.({ preventDefault: jest.fn(), data: { action } });
    });

    expect(mockUpsertAppointment).toHaveBeenCalledTimes(1);
    expect(mockUpsertAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-08-23",
        title: "Ohne Titel",
        allDay: true,
        startTime: null,
        endTime: null,
      }),
    );
    expect(mockNavigationDispatch).toHaveBeenCalledTimes(1);
    expect(mockNavigationDispatch).toHaveBeenCalledWith(action);
  });

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "lets unchanged saved %s entries dismiss and protects edits until saved",
    async (kind) => {
      const entry = deletionEntry(kind);
      mockEntries = [entry];
      mockRouteParams = { date: entry.date, mode: kind, entryId: entry.id };
      const screen = await render(deletionScreen());
      await fireEvent.press(
        screen.getByRole("button", {
          name: kind === "SHIFT" ? "Dienst bearbeiten" : "Termin bearbeiten",
        }),
      );
      expect(screen.getByText("Notiz behalten")).toBeTruthy();
      expect(mockBeforeRemoveListener).toBeNull();
      await confirmEntryText(screen, "note", "Neue Übergabe");
      expect(mockBeforeRemoveListener).not.toBeNull();
      await confirmEntryText(screen, "note", "Notiz behalten");
      expect(mockBeforeRemoveListener).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
      expect(mockUpsertShift).not.toHaveBeenCalled();
      expect(mockUpsertAppointment).not.toHaveBeenCalled();
    },
  );

  async function openDeleteDialog(kind: "SHIFT" | "APPOINTMENT") {
    const entry = deletionEntry(kind);
    mockEntries = [entry];
    mockRouteParams = { date: entry.date, mode: kind, entryId: entry.id };
    const alert = jest.spyOn(Alert, "alert");
    const screen = await render(deletionScreen());
    await fireEvent.press(
      screen.getByRole("button", {
        name: kind === "SHIFT" ? "Dienst bearbeiten" : "Termin bearbeiten",
      }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Notiz bearbeiten: Notiz behalten" }));
    await fireEvent.press(
      screen.getByRole("button", {
        name: kind === "SHIFT" ? "Dienst löschen" : "Termin löschen",
      }),
    );
    const buttons = alert.mock.calls.at(-1)?.[2];
    expect(buttons?.map((button) => button.text)).toEqual(["Abbrechen", "Löschen"]);
    return { screen, entry, cancel: buttons![0], confirm: buttons![1] };
  }

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "cancels %s deletion without writes or navigation",
    async (kind) => {
      const { screen, entry, cancel } = await openDeleteDialog(kind);
      await act(async () => {
        cancel.onPress?.();
      });
      expect(mockRemoveEntry).not.toHaveBeenCalled();
      expect(mockUpsertShift).not.toHaveBeenCalled();
      expect(mockUpsertAppointment).not.toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Speichern" })).toBeEnabled();
      expect(deletionFeedback).not.toHaveBeenCalled();
      expect(mockEntries).toEqual([entry]);
      expect(screen.getByText("Notiz behalten")).toBeTruthy();
    },
  );

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "keeps the %s editor mounted while deletion cleanup is pending",
    async (kind) => {
      let finish!: () => void;
      mockRemoveEntry.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const { screen, entry, confirm } = await openDeleteDialog(kind);
      await act(async () => {
        confirm.onPress?.();
      });
      expect(mockRemoveEntry).toHaveBeenCalledWith(entry);
      // Provider has removed the persisted entry, but notification cleanup is still pending.
      mockEntries = [];
      await screen.rerender(deletionScreen());
      expect(screen.queryByText("Eintrag nicht verfügbar")).toBeNull();
      expect(screen.getByText("Notiz behalten")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
      expect(router.back).not.toHaveBeenCalled();
      const preventDefault = jest.fn();
      await act(async () => {
        mockBeforeRemoveListener?.({ preventDefault, data: { action: { type: "GO_BACK" } } });
        confirm.onPress?.();
      });
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(mockRemoveEntry).toHaveBeenCalledTimes(1);
      await act(async () => {
        finish();
      });
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(deletionFeedback).toHaveBeenCalledTimes(1);
      const exitPreventDefault = jest.fn();
      await act(async () => {
        mockBeforeRemoveListener?.({
          preventDefault: exitPreventDefault,
          data: { action: { type: "GO_BACK" } },
        });
        confirm.onPress?.();
      });
      expect(exitPreventDefault).not.toHaveBeenCalled();
      expect(mockRemoveEntry).toHaveBeenCalledTimes(1);
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(mockUpsertShift).not.toHaveBeenCalled();
      expect(mockUpsertAppointment).not.toHaveBeenCalled();
      expect(screen.queryByText("Eintrag nicht verfügbar")).toBeNull();
    },
  );

  it("keeps inputs after a deletion failure and allows a deliberate retry", async () => {
    mockRemoveEntry.mockRejectedValueOnce(new Error("database unavailable"));
    const { screen, confirm } = await openDeleteDialog("SHIFT");
    await act(async () => {
      confirm.onPress?.();
    });
    expect(screen.getByText("Eintrag konnte nicht gelöscht werden.")).toBeTruthy();
    expect(screen.getByText("Notiz behalten")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    expect(deletionFeedback).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Dienst löschen" }));
    const retry = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1];
    await act(async () => {
      retry?.onPress?.();
    });
    expect(mockRemoveEntry).toHaveBeenCalledTimes(2);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("still reports an externally removed entry as missing", async () => {
    const { screen } = await openDeleteDialog("SHIFT");
    mockEntries = [];
    await screen.rerender(deletionScreen());
    expect(screen.getByText("Eintrag nicht verfügbar")).toBeTruthy();
    expect(mockRemoveEntry).not.toHaveBeenCalled();
  });

  it("does not reuse a deleting entry for another route", async () => {
    let finish!: () => void;
    mockRemoveEntry.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { screen, confirm } = await openDeleteDialog("SHIFT");
    await act(async () => {
      confirm.onPress?.();
    });
    mockEntries = [];
    mockRouteParams = { date: "2026-08-20", mode: "SHIFT", entryId: "other-entry" };
    await screen.rerender(deletionScreen());
    expect(screen.getByText("Eintrag nicht verfügbar")).toBeTruthy();
    // Settle the request only after teardown; route changes must not reuse its snapshot.
    await screen.unmount();
    await act(async () => {
      finish();
    });
  });

  it("enters a new shift in the compact overlay and saves without deletion", async () => {
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 430, height: 932 },
          insets: { top: 59, right: 0, bottom: 34, left: 0 },
        }}
      >
        <FeedbackProvider>
          <DayEditorScreen />
        </FeedbackProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("shift-edit-overlay")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dienst löschen" })).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));
    });

    await waitFor(() => expect(mockUpsertShift).toHaveBeenCalledTimes(1));
    expect(successFeedback).not.toHaveBeenCalled();
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Eintrag gespeichert.")).toBeNull();
    expect(screen.queryByText("Eintrag aktualisiert.")).toBeNull();
  });

  it("opens an existing shift in the compact overlay and preserves its revision", async () => {
    mockEntries = [
      {
        kind: "SHIFT",
        id: "shift-1",
        date: "2026-08-20",
        templateId: null,
        title: "Spätdienst",
        type: "LATE",
        allDay: false,
        startTime: "13:00",
        endTime: "21:30",
        breakMinutes: 30,
        color: "#F05C68",
        symbol: "S",
        note: "Übergabe",
        notification: null,
        alarmEnabled: false,
        location: null,
        overtimeMinutes: 0,
        holidayPremiumMode: "WITH_TIME_OFF",
        revision: 4,
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-01T08:00:00.000Z",
        deletedAt: null,
      },
    ];
    mockRouteParams = { date: "2026-08-20", mode: "SHIFT", entryId: "shift-1" };

    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 430, height: 932 },
          insets: { top: 59, right: 0, bottom: 34, left: 0 },
        }}
      >
        <FeedbackProvider>
          <DayEditorScreen />
        </FeedbackProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("shift-edit-overlay")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Dienst bearbeiten" }));
    expect(screen.queryByLabelText("Pausendauer in 15-Minuten-Schritten")).toBeNull();
    const pause = screen.getByTestId("shift-edit-pause-options");
    expect(pause).toHaveProp("selection", "30");
    await fireEvent(pause, "selectionChange", { nativeEvent: { selection: "60" } });
    await fireEvent.press(screen.getByRole("button", { name: "Wecker: Aus" }));
    expect(
      screen.getByText("Fokusmodus und Stummschaltung können den Ton unterdrücken."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Zum Dienstbeginn" }));
    expect(screen.getByRole("button", { name: "Wecker: Zum Dienstbeginn" })).toBeTruthy();
    const preventDefault = jest.fn();
    await act(async () => {
      mockBeforeRemoveListener?.({
        preventDefault,
        data: { action: { type: "GO_BACK" } },
      });
    });

    await waitFor(() =>
      expect(mockUpsertShift).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "shift-1",
          expectedRevision: 4,
          date: "2026-08-20",
          startTime: "13:00",
          endTime: "21:30",
          breakMinutes: 60,
          alarmEnabled: true,
        }),
      ),
    );
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockNavigationDispatch).toHaveBeenCalledWith({ type: "GO_BACK" }));
    expect(successFeedback).not.toHaveBeenCalled();
  });

  it("opens an existing appointment in the compact overlay and preserves its revision", async () => {
    mockEntries = [
      {
        kind: "APPOINTMENT",
        id: "appointment-1",
        date: "2026-08-22",
        title: "Ohne Titel",
        allDay: false,
        startTime: "12:00",
        endTime: "13:00",
        color: "#2F80ED",
        note: null,
        recurrence: null,
        notification: null,
        location: null,
        revision: 3,
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-01T08:00:00.000Z",
        deletedAt: null,
      },
    ];
    mockRouteParams = {
      date: "2026-08-22",
      mode: "APPOINTMENT",
      entryId: "appointment-1",
    };

    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 430, height: 932 },
          insets: { top: 59, right: 0, bottom: 34, left: 0 },
        }}
      >
        <FeedbackProvider>
          <DayEditorScreen />
        </FeedbackProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("appointment-edit-overlay")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Termin bearbeiten" }));
    await confirmEntryText(screen, "title", "Arzttermin");
    const preventDefault = jest.fn();
    await act(async () => {
      mockBeforeRemoveListener?.({
        preventDefault,
        data: { action: { type: "GO_BACK" } },
      });
    });

    await waitFor(() =>
      expect(mockUpsertAppointment).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "appointment-1",
          expectedRevision: 3,
          date: "2026-08-22",
          title: "Arzttermin",
          startTime: "12:00",
          endTime: "13:00",
        }),
      ),
    );
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockNavigationDispatch).toHaveBeenCalledWith({ type: "GO_BACK" }));
    expect(successFeedback).not.toHaveBeenCalled();
  });

  it("enters a new appointment in the compact overlay without deletion", async () => {
    mockRouteParams = { date: "2026-08-23", mode: "APPOINTMENT" };

    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 430, height: 932 },
          insets: { top: 59, right: 0, bottom: 34, left: 0 },
        }}
      >
        <FeedbackProvider>
          <DayEditorScreen />
        </FeedbackProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("appointment-edit-overlay")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Termin löschen" })).toBeNull();
    await confirmEntryText(screen, "title", "Physiotherapie");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));
    });

    await waitFor(() =>
      expect(mockUpsertAppointment).toHaveBeenCalledWith(
        expect.objectContaining({
          date: "2026-08-23",
          title: "Physiotherapie",
          allDay: false,
          startTime: "12:00",
          endTime: "13:00",
        }),
      ),
    );
    expect(mockUpsertAppointment.mock.calls[0]?.[0]).not.toHaveProperty("id");
    expect(successFeedback).not.toHaveBeenCalled();
  });
});

it("shows shared shifts and appointments in the read-only overview and removes revoked data", async () => {
  mockUpsertShift.mockClear();
  mockUpsertAppointment.mockClear();
  mockRemoveEntry.mockClear();
  jest.mocked(router.back).mockClear();
  const calendarId = "20000000-0000-4000-8000-000000000001",
    entryId = "20000000-0000-4000-8000-000000000002";
  const cache: CachedSharedCalendar = {
    accountId: "accountA",
    visible: true,
    fetchedAt: new Date().toISOString(),
    calendar: {
      id: calendarId,
      ownerId: "owner",
      name: "Selena",
      color: "#527D92",
      visibility: "DETAILS",
      revision: 1,
      isOwner: false,
      publishedAt: new Date().toISOString(),
    },
    entries: [
      {
        id: entryId,
        title: "Urlaub",
        kind: "SHIFT",
        note: "Freigegebene Notiz\nZweite Zeile",
        symbol: "star",
        color: "#8899AA",
        startsAt: "2026-08-03T22:00:00Z",
        endsAt: "2026-08-04T22:00:00Z",
        timeZone: "Europe/Berlin",
        allDay: true,
      },
    ],
  };
  mockRouteParams = { date: "2026-08-04", mode: "SHIFT", entryId, sharedCalendarId: calendarId };
  const content = (items: readonly CachedSharedCalendar[]) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 844, width: 390, x: 0, y: 0 },
        insets: { top: 47, bottom: 34, left: 0, right: 0 },
      }}
    >
      <SharedCalendarsContext value={items}>
        <DayEditorScreen />
      </SharedCalendarsContext>
    </SafeAreaProvider>
  );
  const screen = await render(content([cache]));
  expect(screen.getByRole("header", { name: "Ganztägig" })).toBeVisible();
  expect(screen.getByText("Selena")).toBeTruthy();
  expect(screen.getAllByText("Urlaub").length).toBeGreaterThan(0);
  expect(screen.getByText("Freigegebene Notiz\nZweite Zeile")).toBeTruthy();
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  expect(screen.queryByLabelText("Dienst löschen")).toBeNull();
  expect(screen.queryByLabelText("Dienst: Urlaub")).toBeNull();
  expect(mockUpsertShift).not.toHaveBeenCalled();
  expect(mockRemoveEntry).not.toHaveBeenCalled();
  await screen.rerender(
    content([{ ...cache, entries: cache.entries.map((entry) => ({ ...entry, note: null })) }]),
  );
  expect(screen.queryByText("Freigegebene Notiz\nZweite Zeile")).toBeNull();
  expect(screen.getByText("Selena")).toBeTruthy();

  const nightShift = cache.entries.map((entry) => ({
    ...entry,
    allDay: false,
    title: "Nacht",
    startsAt: "2026-08-04T19:00:00Z",
    endsAt: "2026-08-05T05:30:00Z",
    note: null,
  }));
  await screen.rerender(content([{ ...cache, entries: nightShift }]));
  const overview = within(screen.getByTestId("shared-entry-overview"));
  expect(overview.getByRole("header", { name: "21:00 – 07:30" })).toBeVisible();
  expect(overview.getByText("Ende am 05.08.")).toBeVisible();
  expect(overview.queryByText(/Arbeitszeit/)).toBeNull();
  expect(screen.queryByText("Ganztägig")).toBeNull();

  await screen.rerender(
    content([{ ...cache, entries: nightShift.map((entry) => ({ ...entry, breakMinutes: 30 })) }]),
  );
  expect(screen.getByText("10 h 0 min")).toBeVisible();
  expect(screen.getByText("Arbeitszeit · 30 Min. Pause")).toBeVisible();

  const appointments = cache.entries.map((entry) => ({
    ...entry,
    kind: "APPOINTMENT" as const,
    allDay: false,
    title: "Physiotherapie",
    startsAt: "2026-08-04T09:00:00Z",
    endsAt: "2026-08-04T10:15:00Z",
    note: "Freigegebene Terminnotiz",
  }));
  await screen.rerender(content([{ ...cache, entries: appointments }]));
  expect(screen.getByRole("header", { name: "11:00 – 12:15" })).toBeVisible();
  expect(screen.getByText("1 h 15 min")).toBeVisible();
  expect(screen.getByText("Dauer")).toBeVisible();
  expect(screen.getByText("Geteilter Termin · nur ansehen")).toBeVisible();
  expect(screen.getByText("Freigegebene Terminnotiz")).toBeVisible();
  expect(screen.queryByText(/Arbeitszeit|Pause|Ende am/)).toBeNull();
  await dragEditorSheet(-110);
  expect(screen.getByTestId("shared-entry-overview")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Dienst bearbeiten" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Termin bearbeiten" })).toBeNull();
  const footer = within(screen.getByTestId("shift-edit-close-arrival"));
  await fireEvent.press(footer.getByRole("button", { name: "Schließen" }));
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  expect(mockUpsertShift).not.toHaveBeenCalled();
  expect(mockUpsertAppointment).not.toHaveBeenCalled();
  expect(mockRemoveEntry).not.toHaveBeenCalled();

  await screen.rerender(content([]));
  expect(screen.queryByText("Physiotherapie")).toBeNull();
  expect(screen.getByText("Dienst nicht mehr verfügbar")).toBeTruthy();
});
