import { SharedCalendarsContext } from "@/application/shared-calendars-context";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { Appointment, CalendarEntry, SaveAppointmentInput, ShiftEntry } from "@/domain/types";
import { DayEditorScreen } from "@/features/day-editor/day-editor-screen";
import { FeedbackProvider } from "@/ui/feedback";
import { deletionFeedback, successFeedback } from "@/ui/haptics";

const mockUpsertShift = jest.fn<() => Promise<ShiftEntry>>();
const mockUpsertAppointment = jest.fn<(input: SaveAppointmentInput) => Promise<Appointment>>();
const mockRemoveEntry = jest.fn<(entry: CalendarEntry) => Promise<void>>();
let mockEntries: CalendarEntry[] = [];
let mockBeforeRemoveListener:
  ((event: { preventDefault: () => void; data: { action: { type: string } } }) => void) | null =
  null;
const mockNavigationDispatch = jest.fn();
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
  router: { back: jest.fn(), dismissTo: jest.fn() },
  Stack: {
    Screen: ({ options }: { options: { headerLeft?: () => React.ReactNode } }) =>
      options.headerLeft?.() ?? null,
  },
  useFocusEffect: (effect: () => void) => effect(),
  useNavigation: () => ({
    addListener: (
      _event: string,
      listener: (event: { preventDefault: () => void; data: { action: { type: string } } }) => void,
    ) => {
      mockBeforeRemoveListener = listener;
      return jest.fn();
    },
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
  usePflegeShiftProfile: () => ({ profile: null }),
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

describe("DayEditorScreen", () => {
  beforeEach(() => {
    mockRemoveEntry.mockReset().mockResolvedValue(undefined);
    jest.mocked(deletionFeedback).mockClear();
    mockUpsertShift.mockReset();
    mockUpsertShift.mockResolvedValue({ id: "saved" } as ShiftEntry);
    mockUpsertAppointment.mockReset();
    mockUpsertAppointment.mockResolvedValue({ id: "saved-appointment" } as Appointment);
    jest.mocked(router.back).mockClear();
    jest.mocked(router.dismissTo).mockClear();
    jest.mocked(successFeedback).mockClear();
    mockBeforeRemoveListener = null;
    mockNavigationDispatch.mockClear();
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
      await fireEvent.press(screen.getByRole("button", { name: "Notiz hinzufügen" }));
      await fireEvent.changeText(screen.getByLabelText("Notizen"), "Entwurf behalten");
      const event = { preventDefault: jest.fn(), data: { action: { type: "GO_BACK" } } };
      await act(async () => {
        mockBeforeRemoveListener?.(event);
      });
      expect(screen.getByDisplayValue("Entwurf behalten")).toBeTruthy();
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
    await fireEvent.changeText(screen.getByLabelText("Titel"), "");
    const preventDefault = jest.fn();
    await act(async () => {
      mockBeforeRemoveListener?.({ preventDefault, data: { action: { type: "GO_BACK" } } });
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockUpsertAppointment).not.toHaveBeenCalled();
    expect(mockNavigationDispatch).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Titel")).toHaveProp("value", "");
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

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "lets unchanged saved %s entries dismiss natively and protects edits until saved",
    async (kind) => {
      const entry = deletionEntry(kind);
      mockEntries = [entry];
      mockRouteParams = { date: entry.date, mode: kind, entryId: entry.id };
      const screen = await render(deletionScreen());
      expect(screen.getByText("Notiz behalten")).toBeTruthy();
      expect(mockBeforeRemoveListener).toBeNull();
      await fireEvent.press(
        screen.getByRole("button", { name: "Notiz bearbeiten: Notiz behalten" }),
      );
      await fireEvent.changeText(screen.getByLabelText("Notizen"), "Neue Übergabe");
      expect(mockBeforeRemoveListener).not.toBeNull();
      await fireEvent.changeText(screen.getByLabelText("Notizen"), "Notiz behalten");
      expect(mockBeforeRemoveListener).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));
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
    await fireEvent.press(screen.getByRole("button", { name: "Notiz bearbeiten: Notiz behalten" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Aktionen" }));
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
      expect(screen.getByRole("button", { name: "Schließen und speichern" })).toBeEnabled();
      expect(deletionFeedback).not.toHaveBeenCalled();
      expect(mockEntries).toEqual([entry]);
      expect(screen.getByDisplayValue("Notiz behalten")).toBeTruthy();
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
      expect(screen.getByDisplayValue("Notiz behalten")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Schließen und speichern" })).toBeDisabled();
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
    expect(screen.getByDisplayValue("Notiz behalten")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    expect(deletionFeedback).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Aktionen" }));
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
    expect(screen.queryByLabelText("Pausendauer in 15-Minuten-Schritten")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Pause: 30 Minuten" }));
    await fireEvent.press(screen.getByRole("radio", { name: "60 Minuten" }));
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
    await fireEvent.changeText(screen.getByLabelText("Titel"), "Arzttermin");
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
    await fireEvent.changeText(screen.getByLabelText("Titel"), "Physiotherapie");
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

it("uses the normal editor frame without local mutations for a foreign shift and removes revoked data", async () => {
  mockUpsertShift.mockClear();
  mockRemoveEntry.mockClear();
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
  expect(screen.getByTestId("shift-edit-time-group")).toBeTruthy();
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
  await screen.rerender(content([]));
  expect(screen.queryByText("Urlaub")).toBeNull();
  expect(screen.getByText("Dienst nicht mehr verfügbar")).toBeTruthy();
});
