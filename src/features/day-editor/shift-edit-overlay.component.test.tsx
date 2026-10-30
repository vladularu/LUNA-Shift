import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  ShiftEditOverlay,
  shouldDismissShiftEditOverlay,
} from "@/features/day-editor/shift-edit-overlay";
import { CORNER_CURVE, RADII } from "@/theme/tokens";

let mockNativePresentation = true;
jest.mock("@/features/day-editor/entry-edit-overlay-frame", () => {
  const actual = jest.requireActual<
    typeof import("@/features/day-editor/entry-edit-overlay-frame")
  >("@/features/day-editor/entry-edit-overlay-frame");
  return {
    ...actual,
    EntryEditOverlayFrame: (props: React.ComponentProps<typeof actual.EntryEditOverlayFrame>) => (
      <actual.EntryEditOverlayFrame {...props} nativePresentation={mockNativePresentation} />
    ),
  };
});

async function renderOverlay(
  overrides: Partial<React.ComponentProps<typeof ShiftEditOverlay>> = {},
) {
  const props: React.ComponentProps<typeof ShiftEditOverlay> = {
    alarmEnabled: false,
    breakMinutes: "0",
    busy: false,
    date: "2026-08-20",
    durationMinutes: 510,
    endTime: "21:30",
    error: null,
    location: null,
    note: "",
    notification: null,
    onAlarmPress: jest.fn(),
    onBreakMinutesChange: jest.fn(),
    onBreakPress: jest.fn(),
    onDelete: jest.fn(),
    onDismiss: jest.fn(),
    onEndTimeChange: jest.fn(),
    onLocationPress: jest.fn(),
    onNoteChange: jest.fn(),
    onNotificationChange: jest.fn(),
    onNotificationPress: jest.fn(),
    onOvertimeMinutesChange: jest.fn(),
    onRequestClose: jest.fn(async () => true),
    onShiftTypeChange: jest.fn(),
    onStartTimeChange: jest.fn(),
    onTariffOvertimeConfirmedChange: jest.fn(),
    overtimeInputRef: { current: null },
    overtimeMinutes: "0",
    shiftColor: "#D94E60",
    shiftIsTimed: true,
    shiftSymbol: "S",
    shiftTitle: "Dienst",
    shiftType: "LATE",
    startTime: "13:00",
    tariffOvertimeConfirmed: false,
    ...overrides,
  };
  const screen = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 932 },
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
      }}
    >
      <ShiftEditOverlay {...props} />
    </SafeAreaProvider>,
  );
  return { screen, props };
}

describe("ShiftEditOverlay", () => {
  it("shows the saved location map without changing the location action", async () => {
    const { screen, props } = await renderOverlay({
      location: { name: "Heppenheim", latitude: 49.64, longitude: 8.64 },
      note: "Übergabe\nSchlüssel auf Station 3 abholen.",
    });
    expect(screen.getByText("Übergabe\nSchlüssel auf Station 3 abholen.")).toBeTruthy();
    expect(screen.queryByLabelText("Notizen")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Notiz bearbeiten: Übergabe\nSchlüssel auf Station 3 abholen.",
      }),
    );
    expect(screen.getByLabelText("Notizen")).toHaveProp("autoFocus", true);
    expect(screen.getByDisplayValue("Übergabe\nSchlüssel auf Station 3 abholen.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Heppenheim in Karten öffnen" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Ort: Heppenheim" }));
    expect(props.onLocationPress).toHaveBeenCalledTimes(1);
    expect(props.onRequestClose).not.toHaveBeenCalled();
  });

  it("retains a text-only location without displaying a map", async () => {
    const { screen } = await renderOverlay({ location: { name: "Station 3" } });
    expect(screen.getByRole("button", { name: "Ort: Station 3" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /in Karten öffnen/ })).toBeNull();
  });

  beforeEach(() => {
    mockNativePresentation = true;
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      granted: true,
    } as Notifications.NotificationPermissionsStatus);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      granted: true,
    } as Notifications.NotificationPermissionsStatus);
  });

  it("lets native iOS navigation own dismissal without registering the fallback gesture", async () => {
    const { screen } = await renderOverlay();
    expect(screen.getByTestId("shift-edit-drag-handle")).toBeTruthy();
    expect(() => getByGestureTestId("shift-edit-dismiss-gesture")).toThrow();
    expect(screen.getByRole("button", { name: "Schließen und speichern" })).toBeTruthy();
  });

  it("supports the complete compact shift editing surface", async () => {
    const { screen, props } = await renderOverlay({ location: { name: "Station 3" } });

    expect(screen.getByText("Do. 20. Aug.")).toBeTruthy();
    expect(screen.getByText("8h 30min")).toBeTruthy();
    expect(screen.getByText("Spät")).toBeTruthy();
    expect(screen.queryByText("Mein Job")).toBeNull();
    expect(screen.queryByText("Mehr hinzufügen")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause: 0 Minuten" })).toBeTruthy();
    expect(screen.queryByLabelText("Pausendauer in 15-Minuten-Schritten")).toBeNull();
    expect(screen.getByRole("button", { name: "Wecker: Aus" })).toBeTruthy();
    expect(screen.getByTestId("shift-edit-sheet")).toHaveProp("accessibilityViewIsModal", true);
    expect(screen.getByTestId("shift-edit-card")).toHaveStyle({
      borderRadius: 0,
      borderCurve: CORNER_CURVE,
      boxShadow: "none",
    });
    expect(screen.queryByTestId("shift-edit-backdrop")).toBeNull();
    expect(screen.getByRole("button", { name: "Schließen und speichern" })).toHaveStyle({
      minHeight: 48,
      borderRadius: RADII.pill,
    });

    await fireEvent.press(screen.getByRole("button", { name: "Pause: 0 Minuten" }));
    expect(screen.getByTestId("shift-edit-pause-popover")).toHaveStyle({ height: 220, width: 210 });
    const pauseWheel = screen.getByTestId("shift-edit-pause-wheel");
    expect(pauseWheel.props).toMatchObject({
      decelerationRate: 0.97,
      scrollEventThrottle: 16,
    });
    expect(pauseWheel.props.disableIntervalMomentum).toBeUndefined();
    expect(screen.getByTestId("shift-edit-pause-selection")).toHaveStyle({ height: 44 });
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "60 Minuten" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "75 Minuten" })).toBeNull();

    await fireEvent.scroll(pauseWheel, {
      nativeEvent: { contentOffset: { x: 0, y: 88 } },
    });
    expect(screen.getByRole("radio", { name: "0 Minuten" }).props.accessibilityState).toMatchObject(
      { selected: true },
    );
    expect(props.onBreakMinutesChange).not.toHaveBeenCalled();
    await fireEvent(pauseWheel, "scrollEndDrag", {
      nativeEvent: {
        contentOffset: { x: 0, y: 88 },
        targetContentOffset: { x: 0, y: 88 },
      },
    });
    expect(props.onBreakMinutesChange).toHaveBeenCalledWith(30);

    await fireEvent(pauseWheel, "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: 0, y: 132 } },
    });
    expect(props.onBreakMinutesChange).toHaveBeenLastCalledWith(45);

    await fireEvent.press(screen.getByRole("radio", { name: "60 Minuten" }));
    expect(screen.getByTestId("shift-edit-pause-popover")).toBeTruthy();
    expect(props.onBreakMinutesChange).toHaveBeenCalledWith(60);
    expect(props.onBreakPress).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Auswahl schließen"));
    expect(screen.queryByTestId("shift-edit-pause-popover")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Keine" }));
    expect(screen.getByTestId("shift-notification-presets")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Zum Beginn" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "5 Minuten vor Beginn" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "1 Stunde vor Beginn" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "1 Tag vor Beginn" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Benutzerdefiniert" }));
    expect(screen.getByTestId("shift-notification-custom")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Abstand: 2" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Einheit: Stunden" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Richtung: nach" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Bezug: Ende" }));
    await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
    expect(props.onNotificationChange).toHaveBeenCalledWith({
      amount: 2,
      unit: "HOUR",
      direction: "AFTER",
      reference: "END",
    });
    expect(props.onNotificationPress).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("shift-notification-custom")).toBeNull());

    await fireEvent.press(screen.getByRole("button", { name: "Wecker: Aus" }));
    expect(props.onAlarmPress).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole("button", { name: "Dienst: Spät" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Fortbildung" }));
    expect(props.onShiftTypeChange).toHaveBeenCalledWith("TRAINING");

    await fireEvent.press(screen.getByRole("button", { name: "Ort: Station 3" }));
    expect(screen.queryByRole("button", { name: "Dienst löschen" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Aktionen" }));
    const deleteAction = screen.getByRole("button", { name: "Dienst löschen" });
    expect(deleteAction).toHaveStyle({ minHeight: 44 });
    expect(within(deleteAction).getByText("Dienst löschen")).toBeTruthy();
    expect(screen.queryByLabelText("Notizen")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Notiz hinzufügen" }));
    const notes = screen.getByLabelText("Notizen");
    expect(notes).toHaveStyle({ minHeight: 88 });
    expect(within(notes.parent!).queryByRole("button", { name: "Dienst löschen" })).toBeNull();
    await fireEvent.press(deleteAction);
    expect(props.onLocationPress).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));
    expect(props.onRequestClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(props.onDismiss).toHaveBeenCalledTimes(1));
  });

  it("closes the pause selector on a second tap without closing or saving the editor", async () => {
    const { screen, props } = await renderOverlay({ note: "Noch nicht gespeichert" });
    const pause = screen.getByRole("button", { name: "Pause: 0 Minuten" });

    await fireEvent.press(pause);
    expect(screen.getByTestId("shift-edit-pause-popover")).toBeTruthy();
    await fireEvent.press(pause);

    expect(screen.queryByTestId("shift-edit-pause-popover")).toBeNull();
    expect(screen.getByText("Noch nicht gespeichert")).toBeTruthy();
    expect(props.onBreakMinutesChange).not.toHaveBeenCalled();
    expect(props.onRequestClose).not.toHaveBeenCalled();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("uses the parent pause and notification pickers on Android instead of opening iOS selectors", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    try {
      const { screen, props } = await renderOverlay();
      await fireEvent.press(screen.getByRole("button", { name: "Pause: 0 Minuten" }));
      await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Keine" }));

      expect(props.onBreakPress).toHaveBeenCalledTimes(1);
      expect(props.onNotificationPress).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("shift-edit-pause-popover")).toBeNull();
      expect(screen.queryByTestId("shift-notification-presets")).toBeNull();
      expect(props.onRequestClose).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", platformDescriptor);
    }
  });

  it("hides deletion while entering a new shift", async () => {
    const { screen } = await renderOverlay({ onDelete: undefined });

    expect(screen.queryByRole("button", { name: "Dienst löschen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ort: Kein Ort" })).toBeTruthy();
  });

  it("keeps the action menu inside the sheet hit area after the header grows and cancels without deleting", async () => {
    const { screen, props } = await renderOverlay();
    await fireEvent(screen.getByTestId("shift-edit-drag-handle"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 148 } },
    });
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Aktionen" }));
    const menu = screen.getByRole("button", { name: "Dienst löschen" }).parent!;
    expect(menu).toHaveStyle({ top: 148 });
    expect(menu.parent).toBe(screen.getByTestId("shift-edit-card"));
    await fireEvent.press(screen.getByRole("button", { name: "Aktionsmenü schließen" }));
    expect(screen.queryByRole("button", { name: "Dienst löschen" })).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onRequestClose).not.toHaveBeenCalled();
  });

  it("anchors inline selectors to their measured groups after rows grow", async () => {
    const { screen } = await renderOverlay();
    await fireEvent(screen.getByTestId("shift-edit-time-group").parent!, "layout", {
      nativeEvent: { layout: { x: 0, y: 108, width: 340, height: 260 } },
    });
    const pause = screen.getByRole("button", { name: "Pause: 0 Minuten" });
    await fireEvent(screen.getByTestId("shift-edit-pause-overtime-pair"), "layout", {
      nativeEvent: { layout: { x: 0, y: 140, width: 312, height: 64 } },
    });
    await fireEvent.press(pause);
    expect(screen.getByTestId("shift-edit-pause-popover")).toHaveStyle({ top: 318 });
    await fireEvent.press(screen.getByLabelText("Auswahl schließen"));
    await fireEvent.press(screen.getByRole("button", { name: "Dienst: Spät" }));
    expect(screen.getByTestId("shift-edit-type-popover")).toHaveStyle({ top: 6 });
    expect(screen.getByRole("radio", { name: "Fortbildung" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Fortbildung" }));
  });

  it("offers the same five entry kinds as the template editor with one checked option", async () => {
    const { screen } = await renderOverlay();
    await fireEvent.press(screen.getByRole("button", { name: "Dienst: Spät" }));

    const menu = within(screen.getByTestId("shift-edit-type-popover"));
    expect(menu.getByText("Eintragsart")).toBeVisible();
    expect(menu.getAllByRole("radio").map((row) => row.props.accessibilityLabel)).toEqual([
      "Dienst",
      "Fortbildung",
      "Urlaub",
      "Krank",
      "Frei",
    ]);
    expect(menu.getAllByRole("radio", { checked: true })).toHaveLength(1);
    expect(menu.getByRole("radio", { name: "Dienst", checked: true })).toBeVisible();
  });

  it.each(["EARLY", "LATE", "NIGHT", "DAY", "CUSTOM"] as const)(
    "keeps an existing %s service unchanged when Dienst is selected again",
    async (shiftType) => {
      const { screen, props } = await renderOverlay({ shiftType, shiftTitle: "Station A" });
      await fireEvent.press(screen.getByRole("button", { name: /^Dienst: / }));
      await fireEvent.press(screen.getByRole("radio", { name: "Dienst", checked: true }));

      expect(props.onShiftTypeChange).not.toHaveBeenCalled();
      expect(props.onStartTimeChange).not.toHaveBeenCalled();
      expect(props.onEndTimeChange).not.toHaveBeenCalled();
      expect(screen.queryByTestId("shift-edit-type-popover")).toBeNull();
    },
  );

  it.each([
    ["Fortbildung", "TRAINING"],
    ["Urlaub", "VACATION"],
    ["Krank", "SICK"],
    ["Frei", "FREE"],
  ])("changes the entry kind to %s", async (label, type) => {
    const { screen, props } = await renderOverlay();
    await fireEvent.press(screen.getByRole("button", { name: "Dienst: Spät" }));
    await fireEvent.press(screen.getByRole("radio", { name: label }));

    expect(props.onShiftTypeChange).toHaveBeenCalledTimes(1);
    expect(props.onShiftTypeChange).toHaveBeenCalledWith(type);
    expect(screen.queryByTestId("shift-edit-type-popover")).toBeNull();
  });

  it("shows the iOS settings action when notifications are denied", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      canAskAgain: false,
      granted: false,
      ios: { status: Notifications.IosAuthorizationStatus.DENIED },
    } as Notifications.NotificationPermissionsStatus);
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    const { screen, props } = await renderOverlay();

    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Keine" }));
    const settingsButton = await screen.findByRole("button", { name: "iOS-Einstellungen" });
    expect(
      screen.getByText("Aktiviere Mitteilungen für LUNA in den iOS-Einstellungen."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "1 Stunde vor Beginn" }));

    expect(props.onNotificationChange).toHaveBeenCalledWith({
      amount: 1,
      unit: "HOUR",
      direction: "BEFORE",
      reference: "START",
    });
    expect(screen.getByTestId("shift-notification-presets")).toBeTruthy();

    await fireEvent.press(settingsButton);
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the reminder editable and closes normally when native permission lookups fail", async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockRejectedValue(new Error("Native bridge unavailable"));
    const { screen, props } = await renderOverlay();

    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Keine" }));
    await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByRole("radio", { name: "5 Minuten vor Beginn" }));

    expect(props.onNotificationChange).toHaveBeenCalledWith({
      amount: 5,
      unit: "MINUTE",
      direction: "BEFORE",
      reference: "START",
    });
    await waitFor(() => expect(screen.queryByTestId("shift-notification-presets")).toBeNull());
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(props.onRequestClose).not.toHaveBeenCalled();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("requests an undecided iOS permission after choosing a reminder", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      canAskAgain: true,
      granted: false,
      ios: { status: Notifications.IosAuthorizationStatus.NOT_DETERMINED },
    } as Notifications.NotificationPermissionsStatus);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      granted: true,
      ios: { status: Notifications.IosAuthorizationStatus.AUTHORIZED },
    } as Notifications.NotificationPermissionsStatus);
    const { screen, props } = await renderOverlay();

    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Keine" }));
    await screen.findByTestId("shift-notification-presets");
    await fireEvent.press(screen.getByRole("radio", { name: "5 Minuten vor Beginn" }));

    await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1));
    expect(props.onNotificationChange).toHaveBeenCalledWith({
      amount: 5,
      unit: "MINUTE",
      direction: "BEFORE",
      reference: "START",
    });
    await waitFor(() => expect(screen.queryByTestId("shift-notification-presets")).toBeNull());
  });

  it("keeps a zero-offset end reminder clear and preserves its reference when applied", async () => {
    const notification = {
      amount: 0,
      unit: "MINUTE" as const,
      direction: "BEFORE" as const,
      reference: "END" as const,
    };
    const { screen, props } = await renderOverlay({ notification });

    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Zum Ende" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Benutzerdefiniert" }));

    expect(
      within(screen.getByTestId("shift-notification-custom")).getByText("Zum Ende"),
    ).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
    expect(props.onNotificationChange).toHaveBeenCalledWith(notification);
  });

  it("discards custom changes when cancelling", async () => {
    const { screen, props } = await renderOverlay();

    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Keine" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Benutzerdefiniert" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Abstand: 30" }));
    await fireEvent.press(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.getByTestId("shift-notification-presets")).toBeTruthy();
    expect(props.onNotificationChange).not.toHaveBeenCalled();
  });

  it("keeps the sheet open when saving fails", async () => {
    const onDismiss = jest.fn();
    const onRequestClose = jest.fn(async () => false);
    const { screen } = await renderOverlay({ onDismiss, onRequestClose });

    await fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));

    await waitFor(() => expect(onRequestClose).toHaveBeenCalledTimes(1));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it.each(["false", "rejection"])(
    "does not retry a failed gesture save (%s) without user action",
    async (failure) => {
      mockNativePresentation = false;
      let finishSave!: (value: boolean) => void;
      let rejectSave!: (reason: Error) => void;
      const onRequestClose = jest.fn(
        () =>
          new Promise<boolean>((resolve, reject) => {
            finishSave = resolve;
            rejectSave = reject;
          }),
      );
      const { screen, props } = await renderOverlay({ onRequestClose, note: "Meine Notiz" });
      const drag = () =>
        fireGestureHandler(getByGestureTestId("shift-edit-dismiss-gesture"), [
          { state: State.BEGAN, translationY: 0, velocityY: 0 },
          { state: State.ACTIVE, translationY: 104, velocityY: 280 },
          { state: State.END, translationY: 104, velocityY: 280 },
        ]);
      await act(async () => {
        drag();
      });
      expect(onRequestClose).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (failure === "false") finishSave(false);
        else rejectSave(new Error("Speichern fehlgeschlagen"));
      });
      expect(onRequestClose).toHaveBeenCalledTimes(1);
      expect(props.onDismiss).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Notiz bearbeiten: Meine Notiz" })).toBeTruthy();
      await act(async () => {
        drag();
      });
      expect(onRequestClose).toHaveBeenCalledTimes(2);
      await act(async () => {
        finishSave(true);
      });
      await waitFor(() => expect(props.onDismiss).toHaveBeenCalledTimes(1));
    },
  );

  it("dismisses after a deliberate drag distance or downward fling", () => {
    expect(shouldDismissShiftEditOverlay(87, 899)).toBe(false);
    expect(shouldDismissShiftEditOverlay(88, 0)).toBe(true);
    expect(shouldDismissShiftEditOverlay(12, 900)).toBe(true);
  });

  it.each(["SPLIT", "ON_CALL", "STANDBY"] as const)(
    "lets the %s blocks own their times and pauses while preserving split overtime",
    async (kind) => {
      const { screen } = await renderOverlay({ specialDutyKind: kind, overtimeMinutes: "15" });
      expect(screen.queryByTestId("shift-edit-time-group")).toBeNull();
      expect(screen.queryByRole("button", { name: "Pause: 0 Minuten" })).toBeNull();
      if (kind === "SPLIT") {
        expect(screen.getByText("Überstunden im ersten Dienstteil")).toBeTruthy();
        expect(screen.getByTestId("shift-edit-split-overtime-group")).toBeTruthy();
      } else {
        expect(screen.queryByTestId("shift-edit-split-overtime-group")).toBeNull();
      }
      expect(screen.getByRole("button", { name: "Wecker: Aus" })).toBeTruthy();
    },
  );

  it("saves and dismisses after dragging the header down", async () => {
    mockNativePresentation = false;
    const { props } = await renderOverlay();

    fireGestureHandler(getByGestureTestId("shift-edit-dismiss-gesture"), [
      { state: State.BEGAN, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationY: 104, velocityY: 280 },
      { state: State.END, translationY: 104, velocityY: 280 },
    ]);

    await waitFor(() => expect(props.onRequestClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(props.onDismiss).toHaveBeenCalledTimes(1));
  });
});
