import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import EntryTextEditorRoute from "../../../app/entry-text-editor";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppointmentEditOverlay } from "@/features/day-editor/appointment-edit-overlay";
import { CORNER_CURVE, RADII } from "@/theme/tokens";

let mockTextRequest: string | undefined;
jest.mock("expo-router", () => ({
  Redirect: () => null,
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ request: mockTextRequest }),
}));

function getTextRequest() {
  const href = jest.mocked(router.push).mock.lastCall?.[0];
  expect(href).toEqual({
    pathname: "/entry-text-editor",
    params: { request: expect.any(String) },
  });
  return typeof href === "object" ? (href.params?.request as string) : undefined;
}

async function renderOverlay(
  overrides: Partial<React.ComponentProps<typeof AppointmentEditOverlay>> = {},
) {
  const props: React.ComponentProps<typeof AppointmentEditOverlay> = {
    allDay: false,
    appointmentColor: "#2F80ED",
    busy: false,
    date: "2026-08-22",
    durationMinutes: 60,
    endTime: "13:00",
    error: null,
    location: null,
    note: "",
    notification: null,
    onAllDayChange: jest.fn(),
    onDelete: jest.fn(),
    onDismiss: jest.fn(),
    onEndTimeChange: jest.fn(),
    onLocationPress: jest.fn(),
    onNoteChange: jest.fn(),
    onNotificationChange: jest.fn(),
    onNotificationPress: jest.fn(),
    onRecurrenceChange: jest.fn(),
    onRequestClose: jest.fn(async () => true),
    onStartTimeChange: jest.fn(),
    onTitleChange: jest.fn(),
    recurrence: null,
    startTime: "12:00",
    title: "Ohne Titel",
    ...overrides,
  };
  const tree = (request?: string) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 932 },
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
      }}
    >
      <AppointmentEditOverlay {...props} />
      {request ? <EntryTextEditorRoute key={request} /> : null}
    </SafeAreaProvider>
  );
  const screen = await render(tree());
  return {
    props,
    screen,
    showTextSheet: async () => {
      mockTextRequest = getTextRequest();
      await screen.rerender(tree(mockTextRequest));
    },
    hideTextSheet: () => screen.rerender(tree()),
  };
}

describe("AppointmentEditOverlay", () => {
  it("shows the appointment map and preserves location selection", async () => {
    const { screen, props } = await renderOverlay({
      location: { name: "Heppenheim", latitude: 49.64, longitude: 8.64 },
      note: "Unterlagen mitbringen.\nEingang neben der Apotheke.",
    });
    expect(screen.getByText("Unterlagen mitbringen.\nEingang neben der Apotheke.")).toBeTruthy();
    expect(screen.queryByLabelText("Notizen")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Notiz bearbeiten: Unterlagen mitbringen.\nEingang neben der Apotheke.",
      }),
    );
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/entry-text-editor",
      params: { request: expect.any(String) },
    });
    expect(screen.getByRole("button", { name: "Heppenheim in Karten öffnen" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Ort: Heppenheim" }));
    expect(props.onLocationPress).toHaveBeenCalledTimes(1);
    expect(props.onRequestClose).not.toHaveBeenCalled();
  });

  it("opens separate title and note sheets and applies changes only on confirmation", async () => {
    const { props, screen, showTextSheet, hideTextSheet } = await renderOverlay({
      note: "Erste Zeile",
    });
    await fireEvent.press(screen.getByRole("button", { name: "Titel: Ohne Titel" }));
    await showTextSheet();
    expect(screen.getByRole("button", { name: "Titel übernehmen" })).toBeDisabled();
    const title = screen.getByLabelText("Titel");
    expect(title).toHaveProp("autoFocus", true);
    await fireEvent.changeText(title, "Abgebrochener Titel");
    expect(props.onTitleChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Abbrechen" }));
    expect(props.onTitleChange).not.toHaveBeenCalled();
    await hideTextSheet();

    await fireEvent.press(screen.getByRole("button", { name: "Titel: Ohne Titel" }));
    await showTextSheet();
    await fireEvent.changeText(screen.getByLabelText("Titel"), "Neuer Termin");
    await fireEvent(screen.getByLabelText("Titel"), "submitEditing");
    expect(props.onTitleChange).toHaveBeenCalledTimes(1);
    expect(props.onTitleChange).toHaveBeenCalledWith("Neuer Termin");
    await hideTextSheet();

    await fireEvent.press(screen.getByRole("button", { name: "Notiz bearbeiten: Erste Zeile" }));
    await showTextSheet();
    const note = screen.getByLabelText("Notizen");
    expect(note).toHaveProp("submitBehavior", "newline");
    expect(note).toHaveProp("value", "Erste Zeile");
    await fireEvent.changeText(note, "");
    expect(props.onNoteChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Notizen übernehmen" }));
    expect(props.onNoteChange).toHaveBeenCalledWith("");
    expect(props.onRequestClose).not.toHaveBeenCalled();
  });

  it("retains a text-only appointment location without a map", async () => {
    const { screen } = await renderOverlay({ location: { name: "Besprechungsraum" } });
    expect(screen.getByRole("button", { name: "Ort: Besprechungsraum" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /in Karten öffnen/ })).toBeNull();
  });

  it("matches the compact appointment reference and keeps the accepted overlay behavior", async () => {
    const { props, screen } = await renderOverlay();

    expect(screen.getByTestId("appointment-edit-overlay")).toBeTruthy();
    expect(screen.getByTestId("appointment-edit-card")).toHaveStyle({
      borderRadius: 0,
      borderCurve: CORNER_CURVE,
      boxShadow: "none",
    });
    expect(screen.queryByTestId("appointment-edit-backdrop")).toBeNull();
    expect(screen.getByTestId("appointment-edit-sheet")).toHaveProp(
      "accessibilityViewIsModal",
      true,
    );
    expect(screen.getByText("Sa. 22. Aug.")).toBeTruthy();
    expect(screen.getByText("1h")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Titel: Ohne Titel" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "Termin ganztägig" })).toBeTruthy();
    expect(screen.getByText("Start")).toBeTruthy();
    expect(screen.getByText("Ende")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wiederholen: Niemals" })).toBeTruthy();
    expect(screen.getByText("Kalender")).toBeTruthy();
    expect(screen.getByText("Termine")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Erinnerung: Keine" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Notizen")).toBeNull();
    expect(screen.getByRole("button", { name: "Ort: Kein Ort" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Termin löschen" })).toBeTruthy();
    expect(screen.queryByText("Mehr hinzufügen")).toBeNull();

    await fireEvent(screen.getByRole("switch", { name: "Termin ganztägig" }), "valueChange", true);
    expect(props.onAllDayChange).toHaveBeenCalledWith(true);
    await fireEvent.press(screen.getByRole("button", { name: "Wiederholen: Niemals" }));
    expect(screen.getByTestId("appointment-recurrence-presets")).toBeTruthy();
    expect(screen.getByTestId("appointment-recurrence-sheet")).toHaveStyle({
      borderTopLeftRadius: RADII.sheet,
      borderTopRightRadius: RADII.sheet,
    });
    expect(screen.getByTestId("appointment-recurrence-preset-card")).toHaveStyle({
      borderRadius: RADII.card,
    });
    expect(screen.getByTestId("appointment-recurrence-custom-row")).toHaveStyle({ minHeight: 44 });
    expect(screen.getByRole("radio", { name: "Nie", checked: true })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Benutzerdefiniert" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Wiederholung schließen" }));

    await fireEvent.press(screen.getByRole("button", { name: "Wiederholen: Niemals" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Alle 2 Wochen" }));
    expect(props.onRecurrenceChange).toHaveBeenCalledWith({ frequency: "WEEK", interval: 2 });
    expect(screen.queryByTestId("appointment-recurrence-presets")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung: Keine" }));
    expect(screen.getByTestId("shift-notification-presets")).toBeTruthy();
    expect(props.onNotificationPress).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung schließen" }));

    await fireEvent.press(screen.getByRole("button", { name: "Ort: Kein Ort" }));
    expect(props.onLocationPress).toHaveBeenCalledTimes(1);
    const deleteAction = screen.getByRole("button", { name: "Termin löschen" });
    expect(deleteAction).toHaveStyle({ minHeight: 44 });
    await fireEvent.press(deleteAction);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));
    expect(props.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("shows an all-day duration without time rows", async () => {
    const { screen } = await renderOverlay({ allDay: true, durationMinutes: null });

    expect(screen.getAllByText("Ganztägig")).toHaveLength(2);
    expect(screen.queryByText("Start")).toBeNull();
    expect(screen.queryByText("Ende")).toBeNull();
  });

  it("hides deletion while entering a new appointment", async () => {
    const { screen } = await renderOverlay({ onDelete: undefined });

    expect(screen.queryByRole("button", { name: "Termin löschen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ort: Kein Ort" })).toBeTruthy();
  });

  it("blocks close and delete while saving without losing the visible close label", async () => {
    const { screen, props } = await renderOverlay({ busy: true });
    expect(screen.getByText("Schließen")).toBeTruthy();
    const close = screen.getByRole("button", { name: "Schließen und speichern" });
    expect(close.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await fireEvent.press(close);
    const deleteAction = screen.getByRole("button", { name: "Termin löschen" });
    expect(deleteAction).toBeDisabled();
    await fireEvent.press(deleteAction);
    expect(props.onRequestClose).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("keeps custom recurrence behind Benutzerdefiniert and applies its wheel selection", async () => {
    const { props, screen } = await renderOverlay();

    await fireEvent.press(screen.getByRole("button", { name: "Wiederholen: Niemals" }));
    expect(screen.getByRole("radio", { name: "Wöchentlich" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Alle 2 Wochen" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Monatlich" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Jährlich" })).toBeTruthy();
    expect(screen.queryByTestId("appointment-recurrence-custom")).toBeNull();

    await fireEvent.press(screen.getByRole("radio", { name: "Benutzerdefiniert" }));
    expect(screen.getByTestId("appointment-recurrence-custom")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Intervall: 3" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Einheit: Monate" }));
    await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));

    expect(props.onRecurrenceChange).toHaveBeenCalledWith({
      frequency: "MONTH",
      interval: 3,
    });
    expect(screen.queryByTestId("appointment-recurrence-custom")).toBeNull();
  });
});
