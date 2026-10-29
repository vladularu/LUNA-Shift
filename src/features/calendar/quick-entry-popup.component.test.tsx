import { act, fireEvent, render, renderHook, waitFor, within } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { CalendarEntry, ShiftEntry } from "@/domain/types";
import { QuickEntryPopup } from "@/features/calendar/quick-entry-popup";
import { usePopupEntryDeletion } from "@/features/calendar/use-popup-entry-deletion";
import { deletionFeedback } from "@/ui/haptics";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";

jest.mock("@/ui/haptics", () => ({ deletionFeedback: jest.fn() }));

// Native pan recognition is covered by the device acceptance, while this adapter
// delivers Swipeable's open/close events to the real popup and deletion flow.
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: React.forwardRef(function SwipeableMock(
      props: {
        children: React.ReactNode;
        testID: string;
        onSwipeableWillOpen: () => void;
        onSwipeableClose: () => void;
        renderRightActions: () => React.ReactNode;
      },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({ close: props.onSwipeableClose }));
      return React.createElement(
        View,
        { testID: props.testID, ...{ onSwipeableWillOpen: props.onSwipeableWillOpen } },
        props.renderRightActions(),
        props.children,
      );
    }),
  };
});

const earlyTemplateAction = {
  kind: "TEMPLATE" as const,
  key: "template:early",
  label: "Früh",
  color: "#7C4DCC",
  symbol: "F",
  template: {
    id: "early",
    name: "Früh",
    type: "EARLY" as const,
    startTime: "06:00",
    endTime: "14:12",
    breakMinutes: 30,
    color: "#7C4DCC",
    symbol: "F",
    sortOrder: 0,
    revision: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
  },
};

const existingShift: ShiftEntry = {
  kind: "SHIFT",
  id: "shift-night",
  date: "2026-08-04",
  templateId: "night",
  title: "Nacht",
  type: "NIGHT",
  startTime: "21:00",
  endTime: "07:30",
  breakMinutes: 60,
  color: "#D94F4F",
  symbol: "N",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  deletedAt: null,
};

async function renderCompact(
  entries: readonly CalendarEntry[],
  props: Partial<React.ComponentProps<typeof QuickEntryPopup>> = {},
  viewport = { width: 400, height: 800, fontScale: 1 },
  insets = { bottom: 0, left: 0, right: 0, top: 0 },
) {
  jest
    .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useWindowDimensions")
    .mockReturnValue({ ...viewport, scale: 1 });
  const content = (currentEntries: readonly CalendarEntry[]) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: viewport.height, width: viewport.width, x: 0, y: 0 },
        insets,
      }}
    >
      <QuickEntryPopup
        actions={[
          { kind: "CUSTOM_SHIFT", key: "editor:shift", label: "Dienst" },
          { kind: "APPOINTMENT", key: "editor:appointment", label: "Termin" },
        ]}
        anchor={{ height: 48, width: 48, x: 40, y: 100 }}
        busy={false}
        date="2026-08-04"
        entries={currentEntries}
        animateEntry={false}
        onClose={jest.fn()}
        onOpenEntry={jest.fn()}
        onOpenShiftPicker={jest.fn()}
        onSelectAction={jest.fn()}
        {...props}
      />
    </SafeAreaProvider>
  );
  const screen = await render(content(entries));
  return {
    ...screen,
    updateEntries: (next: readonly CalendarEntry[]) => screen.rerender(content(next)),
  };
}

describe("QuickEntryPopup", () => {
  it("grows to contain six services without a further-entries route", async () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      ...existingShift,
      id: `service-${index}`,
      title: `Dienst ${index + 1}`,
    }));
    const onOpenEntry = jest.fn();
    const screen = await renderCompact(entries, { onOpenEntry });
    for (const entry of entries)
      expect(screen.getByRole("button", { name: `${entry.title} bearbeiten` })).toBeTruthy();
    expect(screen.queryByText(/weitere/)).toBeNull();
    expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({ height: 418 });
    expect(screen.getByTestId("quick-entry-scroll")).toHaveProp("scrollEnabled", false);
    await fireEvent.press(screen.getByRole("button", { name: "Dienst 6 bearbeiten" }));
    expect(onOpenEntry).toHaveBeenCalledWith(entries[5]);
  });

  it.each([1, 2])(
    "scrolls all entries within the bounded card at fontScale=%s with fixed controls",
    async (fontScale) => {
      const entries = Array.from({ length: 30 }, (_, index) => ({
        ...existingShift,
        id: `service-${index}`,
        title: `Dienst ${index + 1}`,
      }));
      const onClose = jest.fn();
      const onSelectAction = jest.fn();
      const screen = await renderCompact(
        entries,
        { onClose, onSelectAction },
        { width: 375, height: 667, fontScale },
        { top: 20, bottom: 0, left: 0, right: 0 },
      );
      const popup = screen.getByTestId("quick-entry-popup");
      expect(popup).toHaveStyle({ height: 541 });
      const list = screen.getByTestId("quick-entry-scroll");
      expect(list).toHaveProp("scrollEnabled", true);
      expect(within(list).getByRole("button", { name: "Dienst 30 bearbeiten" })).toBeTruthy();
      expect(within(list).queryByRole("button", { name: "Termin hinzufügen" })).toBeNull();
      expect(within(list).queryByRole("button", { name: "Schnellauswahl schließen" })).toBeNull();
      expect(screen.queryByRole("header")).toBeNull();
      await fireEvent.press(
        within(screen.getByTestId("quick-entry-footer")).getByRole("button", {
          name: "Termin hinzufügen",
        }),
      );
      expect(onSelectAction).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "APPOINTMENT" }),
        "2026-08-04",
      );
      await fireEvent(popup, "accessibilityAction", { nativeEvent: { actionName: "dismiss" } });
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    },
  );

  it("measures taller content and discards its old height when the entries change", async () => {
    const screen = await renderCompact([existingShift]);
    const list = screen.getByTestId("quick-entry-scroll");
    await fireEvent(list, "contentSizeChange", 376, 250);
    expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({ height: 308 });
    await fireEvent(list, "contentSizeChange", 376, 900);
    expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({ height: 694 });
    expect(list).toHaveProp("scrollEnabled", true);
    await screen.updateEntries([]);
    expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({ height: 58 });
    expect(screen.getByTestId("quick-entry-scroll")).toHaveProp("scrollEnabled", false);
  });

  it("keeps shared entries beyond the former limit in the same read-only list", async () => {
    const sharedEntries = Array.from({ length: 30 }, (_, index) => ({
      calendarId: "shared-calendar",
      calendarName: "Selena",
      calendarColor: "#527D92",
      fetchedAt: "2026-08-04T10:00:00Z",
      when: "07:00–15:00",
      entry: {
        id: `foreign-${index}`,
        title: `Geteilt ${index + 1}`,
        color: "#6B67BE",
        symbol: "sunrise",
        startsAt: "2026-08-04T05:00:00Z",
        endsAt: "2026-08-04T13:00:00Z",
        timeZone: "Europe/Berlin",
        allDay: false,
      },
    }));
    const onOpenSharedEntry = jest.fn();
    const onDeleteEntry = jest.fn(async () => {});
    const screen = await renderCompact([existingShift], {
      sharedEntries,
      onOpenSharedEntry,
      onDeleteEntry,
    });
    const last = screen.getByRole("button", { name: "Geteilt 30 ansehen" });
    expect(last.props.accessibilityActions).toBeUndefined();
    expect(screen.getAllByTestId(/^swipe-entry-/)).toHaveLength(1);
    expect(screen.queryByText(/weitere/)).toBeNull();
    await fireEvent.press(last);
    expect(onOpenSharedEntry).toHaveBeenCalledWith(sharedEntries[29], "2026-08-04");
    expect(onDeleteEntry).not.toHaveBeenCalled();
  });

  it("deletes a later row from a long list with confirmation and keeps the popup open", async () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      ...existingShift,
      id: `service-${index}`,
      title: `Dienst ${index + 1}`,
    }));
    const onDeleteEntry = jest.fn(async (_entry: CalendarEntry) => {});
    const onClose = jest.fn();
    const screen = await renderCompact(entries, { onDeleteEntry, onClose });
    const swipe = screen.getByTestId("swipe-entry-SHIFT:service-7");
    await fireEvent(swipe, "swipeableWillOpen");
    expect(screen.getByRole("button", { name: "Dienst 8 löschen" })).toBeTruthy();
    await fireEvent(screen.getByTestId("quick-entry-scroll"), "scrollBeginDrag");
    expect(screen.queryByRole("button", { name: "Dienst 8 löschen" })).toBeNull();
    await fireEvent(screen.getByRole("button", { name: "Dienst 8 bearbeiten" }), "longPress");
    await fireEvent.press(screen.getByRole("button", { name: "Dienst 8 endgültig löschen" }));
    expect(onDeleteEntry).toHaveBeenCalledTimes(1);
    expect(onDeleteEntry).toHaveBeenCalledWith(entries[7]);
    await screen.updateEntries(entries.slice(0, 7));
    expect(screen.queryByRole("button", { name: "Dienst 8 bearbeiten" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dienst 7 bearbeiten" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Termin hinzufügen" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps swipe and confirmation actions filled red against the inverse popup in dark=%s",
    async (dark) => {
      jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(dark ? "dark" : "light");
      const palette = dark ? LIGHT_PALETTE : DARK_PALETTE;
      const remove = jest.fn(async () => {});
      const screen = await renderCompact([existingShift], { onDeleteEntry: remove });
      await fireEvent(screen.getByTestId("swipe-entry-SHIFT:shift-night"), "swipeableWillOpen");
      const swipeDelete = screen.getByRole("button", { name: "Nacht löschen" });
      expect(swipeDelete).toHaveStyle({ backgroundColor: palette.dangerAction });
      expect(within(swipeDelete).getByText("Löschen")).toHaveStyle({ color: palette.onDanger });
      await fireEvent.press(swipeDelete);
      const confirm = screen.getByRole("button", { name: "Nacht endgültig löschen" });
      expect(confirm).toHaveStyle({ backgroundColor: palette.dangerAction });
      expect(within(confirm).getByText("Löschen")).toHaveStyle({ color: palette.onDanger });
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it("replaces the fixed footer with accessible confirmation without moving the day card", async () => {
    const screen = await renderCompact([existingShift], {
      onDeleteEntry: jest.fn(async () => {}),
    });
    const popup = screen.getByTestId("quick-entry-popup");
    expect(popup).toHaveStyle({ height: 118 });
    await fireEvent(screen.getByRole("button", { name: "Nacht bearbeiten" }), "longPress");

    const footer = screen.getByTestId("quick-entry-footer");
    expect(within(footer).getByRole("button", { name: "Nacht endgültig löschen" })).toBeEnabled();
    expect(within(footer).getByRole("button", { name: "Löschen abbrechen" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Dienst hinzufügen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Termin hinzufügen" })).toBeNull();
    expect(popup).toHaveStyle({ height: 118 });
    expect(popup).toHaveProp("pointerEvents", "auto");
    expect(screen.getByTestId("quick-entry-scroll", { includeHiddenElements: true })).toHaveProp(
      "accessibilityElementsHidden",
      true,
    );
    expect(
      within(
        screen.getByTestId("quick-entry-scroll", { includeHiddenElements: true }),
      ).queryByTestId("quick-entry-delete-confirmation", { includeHiddenElements: true }),
    ).toBeNull();

    await fireEvent.press(within(footer).getByRole("button", { name: "Löschen abbrechen" }));
    expect(within(footer).getByRole("button", { name: "Dienst hinzufügen" })).toBeEnabled();
    expect(within(footer).getByRole("button", { name: "Termin hinzufügen" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Nacht bearbeiten" })).toBeEnabled();
    expect(popup).toHaveStyle({ height: 118 });
  });

  it("reveals delete on swipe, cancels locally and keeps the popup open after confirmed deletion", async () => {
    const onDeleteEntry = jest.fn<(entry: CalendarEntry) => Promise<void>>().mockResolvedValue();
    const onClose = jest.fn();
    const onOpenEntry = jest.fn();
    const screen = await renderCompact([existingShift], { onDeleteEntry, onClose, onOpenEntry });
    const swipe = () =>
      fireEvent(screen.getByTestId("swipe-entry-SHIFT:shift-night"), "swipeableWillOpen");
    await swipe();
    expect(onDeleteEntry).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Nacht löschen" }));
    expect(onDeleteEntry).not.toHaveBeenCalled();
    expect(screen.getByTestId("quick-entry-delete-confirmation")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Löschen abbrechen" }));
    expect(screen.queryByTestId("quick-entry-delete-confirmation")).toBeNull();
    expect(screen.getByRole("button", { name: "Nacht bearbeiten" })).toBeTruthy();
    expect(onDeleteEntry).not.toHaveBeenCalled();

    await swipe();
    await fireEvent.press(screen.getByRole("button", { name: "Nacht löschen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Nacht endgültig löschen" }));
    await waitFor(() => expect(screen.queryByTestId("quick-entry-delete-confirmation")).toBeNull());
    expect(onDeleteEntry).toHaveBeenCalledTimes(1);
    expect(onDeleteEntry).toHaveBeenCalledWith(existingShift);
    expect(deletionFeedback).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenEntry).not.toHaveBeenCalled();
    await screen.updateEntries([]);
    expect(screen.queryByRole("button", { name: "Nacht bearbeiten" })).toBeNull();
    expect(screen.getByTestId("quick-entry-popup")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dienst hinzufügen" })).toBeTruthy();
  });

  it("invalidates confirmation when the selected entry was changed or removed elsewhere", async () => {
    const onDeleteEntry = jest.fn<(entry: CalendarEntry) => Promise<void>>().mockResolvedValue();
    const screen = await renderCompact([existingShift], { onDeleteEntry });
    await fireEvent(screen.getByRole("button", { name: "Nacht bearbeiten" }), "longPress");
    await screen.updateEntries([{ ...existingShift, revision: 2 }]);
    expect(screen.queryByTestId("quick-entry-delete-confirmation")).toBeNull();
    expect(onDeleteEntry).not.toHaveBeenCalled();
    await fireEvent(screen.getByRole("button", { name: "Nacht bearbeiten" }), "longPress");
    await screen.updateEntries([]);
    expect(screen.queryByTestId("quick-entry-delete-confirmation")).toBeNull();
    expect(onDeleteEntry).not.toHaveBeenCalled();
  });

  it("does not reuse the taller error footer when a deletion is cancelled and requested again", async () => {
    const onDeleteEntry = jest
      .fn<(entry: CalendarEntry) => Promise<void>>()
      .mockRejectedValue(new Error("offline"));
    const screen = await renderCompact([existingShift], { onDeleteEntry });
    await fireEvent(screen.getByRole("button", { name: "Nacht bearbeiten" }), "longPress");
    await fireEvent.press(screen.getByRole("button", { name: "Nacht endgültig löschen" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await fireEvent(screen.getByTestId("quick-entry-delete-confirmation"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 374, height: 96 } },
    });
    expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({ height: 158 });
    await fireEvent.press(screen.getByRole("button", { name: "Löschen abbrechen" }));
    await fireEvent(screen.getByRole("button", { name: "Nacht bearbeiten" }), "longPress");
    expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({ height: 118 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("guards two confirmations in the same frame and clears selection when leaving the day", async () => {
    let resolveDelete!: () => void;
    const removeEntry = jest.fn<(entry: CalendarEntry) => Promise<void>>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const hook = await renderHook(
      ({ active }: { active: boolean }) =>
        usePopupEntryDeletion({
          entries: [existingShift],
          date: existingShift.date,
          active,
          removeEntry,
        }),
      { initialProps: { active: true } },
    );
    await act(() => hook.result.current.request(existingShift));
    let first!: Promise<boolean>;
    await act(async () => {
      first = hook.result.current.confirm();
      await hook.result.current.confirm();
    });
    expect(removeEntry).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveDelete();
      await first;
    });
    await act(() => hook.result.current.request(existingShift));
    await hook.rerender({ active: false });
    expect(hook.result.current.pending).toBeNull();
    await act(async () => {
      await hook.result.current.confirm();
    });
    expect(removeEntry).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed deletion visible, prevents duplicate writes and allows a retry", async () => {
    let rejectDelete!: (reason: Error) => void;
    const onDeleteEntry = jest
      .fn<(entry: CalendarEntry) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectDelete = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const onClose = jest.fn();
    const screen = await renderCompact([existingShift], { onDeleteEntry, onClose });
    await fireEvent(
      screen.getByRole("button", { name: "Nacht bearbeiten" }),
      "accessibilityAction",
      {
        nativeEvent: { actionName: "delete" },
      },
    );
    await fireEvent.press(screen.getByRole("button", { name: "Nacht endgültig löschen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Nacht endgültig löschen" }));
    await fireEvent.press(
      screen.getByTestId("quick-entry-backdrop", { includeHiddenElements: true }),
    );
    expect(onDeleteEntry).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      rejectDelete(new Error("offline"));
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByTestId("quick-entry-delete-confirmation")).toBeTruthy();
    const footer = screen.getByTestId("quick-entry-footer");
    expect(within(footer).getByRole("alert")).toBeTruthy();
    await fireEvent(screen.getByTestId("quick-entry-delete-confirmation"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 374, height: 96 } },
    });
    expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({ height: 158 });
    expect(within(footer).getByRole("button", { name: "Nacht endgültig löschen" })).toBeEnabled();
    expect(deletionFeedback).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Nacht endgültig löschen" }));
    expect(onDeleteEntry).toHaveBeenCalledTimes(2);
    expect(deletionFeedback).toHaveBeenCalledTimes(1);
  });

  it("supports appointments and cancels confirmation on a backdrop tap", async () => {
    const appointment: CalendarEntry = {
      kind: "APPOINTMENT",
      id: "appointment",
      title: "Zahnarzt",
      color: "#527D92",
      date: "2026-08-04",
      startTime: "10:00",
      endTime: "11:00",
      allDay: false,
      note: null,
      revision: 1,
      createdAt: existingShift.createdAt,
      updatedAt: existingShift.updatedAt,
      deletedAt: null,
    };
    const onDeleteEntry = jest.fn<(entry: CalendarEntry) => Promise<void>>().mockResolvedValue();
    const onClose = jest.fn();
    const screen = await renderCompact([appointment], { onDeleteEntry, onClose });
    await fireEvent(screen.getByRole("button", { name: "Zahnarzt bearbeiten" }), "longPress");
    await fireEvent.press(
      screen.getByTestId("quick-entry-backdrop", { includeHiddenElements: true }),
    );
    expect(screen.queryByTestId("quick-entry-delete-confirmation")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleteEntry).not.toHaveBeenCalled();
    await fireEvent(screen.getByRole("button", { name: "Zahnarzt bearbeiten" }), "longPress");
    await fireEvent.press(screen.getByRole("button", { name: "Zahnarzt endgültig löschen" }));
    expect(onDeleteEntry).toHaveBeenCalledWith(appointment);
  });

  it("only reveals one row at a time and a tap on an exposed row closes it without editing", async () => {
    const onOpenEntry = jest.fn();
    const screen = await renderCompact(
      [existingShift, { ...existingShift, id: "second", title: "Spät" }],
      {
        onDeleteEntry: jest.fn(async () => {}),
        onOpenEntry,
      },
    );
    await fireEvent(screen.getByTestId("swipe-entry-SHIFT:shift-night"), "swipeableWillOpen");
    await fireEvent(screen.getByTestId("swipe-entry-SHIFT:second"), "swipeableWillOpen");
    expect(screen.queryByRole("button", { name: "Nacht löschen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Spät löschen" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Spät bearbeiten" }));
    expect(onOpenEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Spät löschen" })).toBeNull();
  });

  it.each([false, true])(
    "shows only compact content and actions (withEntry=%s)",
    async (withEntry) => {
      const screen = await renderCompact(withEntry ? [existingShift] : []);
      expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({
        height: withEntry ? 118 : 58,
      });
      expect(screen.queryByTestId("quick-entry-header")).toBeNull();
      expect(screen.queryByRole("header")).toBeNull();
      expect(screen.queryByText("Di., 4. Aug.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Schnellauswahl schließen" })).toBeNull();
      expect(screen.getByRole("button", { name: "Dienst hinzufügen" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Termin hinzufügen" })).toBeTruthy();
      expect(screen.getByTestId("quick-entry-popup")).toHaveProp("accessibilityActions", [
        { name: "dismiss", label: "Schnellauswahl schließen" },
      ]);
      if (withEntry) expect(screen.getByText("9h 30min")).toBeTruthy();
    },
  );

  it.each([
    {
      date: "2026-10-08",
      type: "LATE" as const,
      startTime: "13:18",
      endTime: "21:30",
      breakMinutes: 30,
      label: "7h 42min",
    },
    {
      date: "2026-10-24",
      type: "NIGHT" as const,
      startTime: "21:00",
      endTime: "07:30",
      breakMinutes: 60,
      label: "10h 30min",
    },
  ])(
    "shows net duration with pauses and the local clock change: $label",
    async ({ label, ...fields }) => {
      const screen = await renderCompact([{ ...existingShift, ...fields }]);
      expect(screen.getByText(label)).toBeTruthy();
    },
  );

  it("supports accessible dismissal and keeps holiday information in the compact card", async () => {
    const onClose = jest.fn();
    const screen = await renderCompact([], { onClose, holidayName: "Tag der Deutschen Einheit" });
    expect(screen.getByText("Tag der Deutschen Einheit")).toBeTruthy();
    await fireEvent(screen.getByTestId("quick-entry-popup"), "accessibilityEscape");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    "inverts surface and text against the calendar (dark=%s)",
    async (dark) => {
      jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(dark ? "dark" : "light");
      const expected = dark ? LIGHT_PALETTE : DARK_PALETTE;
      const screen = await render(
        <SafeAreaProvider
          initialMetrics={{
            frame: { height: 800, width: 400, x: 0, y: 0 },
            insets: { bottom: 0, left: 0, right: 0, top: 0 },
          }}
        >
          <QuickEntryPopup
            actions={[]}
            anchor={{ height: 48, width: 48, x: 40, y: 100 }}
            busy={false}
            date="2026-08-04"
            entries={[existingShift]}
            onClose={jest.fn()}
            onOpenEntry={jest.fn()}
            onOpenShiftPicker={jest.fn()}
            onSelectAction={jest.fn()}
          />
        </SafeAreaProvider>,
      );
      expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({
        backgroundColor: expected.surfaceRaised,
        overflow: "visible",
      });
      expect(
        screen.getByTestId("quick-entry-backdrop", { includeHiddenElements: true }),
      ).toHaveStyle({ backgroundColor: "transparent" });
      expect(screen.getByTestId("quick-entry-clipped-content")).toHaveStyle({ overflow: "hidden" });
      expect(screen.getByTestId("quick-entry-pointer")).toHaveStyle({
        backgroundColor: expected.surfaceRaised,
        top: -8,
      });
      expect(screen.getByText("Nacht")).toHaveStyle({ color: expected.text });
    },
  );

  it("keeps the lower pointer outside the clip when the popup opens above a late day", async () => {
    jest
      .spyOn(
        jest.requireActual<typeof import("react-native")>("react-native"),
        "useWindowDimensions",
      )
      .mockReturnValue({ width: 400, height: 800, scale: 1, fontScale: 1 });
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <QuickEntryPopup
          actions={[]}
          anchor={{ height: 48, width: 48, x: 180, y: 700 }}
          busy={false}
          date="2026-08-04"
          entries={[existingShift]}
          animateEntry={false}
          onClose={jest.fn()}
          onOpenEntry={jest.fn()}
          onOpenShiftPicker={jest.fn()}
          onSelectAction={jest.fn()}
        />
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId("quick-entry-pointer")).toHaveStyle({ bottom: -8, left: 184 });
    expect(screen.getByTestId("quick-entry-popup")).toHaveStyle({ overflow: "visible" });
    expect(screen.getByTestId("quick-entry-clipped-content")).toHaveStyle({ overflow: "hidden" });
    expect(screen.getByTestId("quick-entry-pointer")).toHaveProp("pointerEvents", "none");
  });

  it("opens the stacked shift selection from the compact day popup", async () => {
    const onSelectAction = jest.fn();
    const onOpenShiftPicker = jest.fn();
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <QuickEntryPopup
          actions={[
            earlyTemplateAction,
            { kind: "CUSTOM_SHIFT", key: "editor:shift", label: "Dienst" },
            { kind: "APPOINTMENT", key: "editor:appointment", label: "Termin" },
          ]}
          anchor={{ height: 48, width: 48, x: 40, y: 100 }}
          busy={false}
          animateEntry={false}
          date="2026-08-04"
          entries={[existingShift]}
          onClose={jest.fn()}
          onOpenEntry={jest.fn()}
          onOpenShiftPicker={onOpenShiftPicker}
          onSelectAction={onSelectAction}
        />
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("quick-entry-popup")).toHaveProp("accessibilityViewIsModal", true);
    expect(screen.getByTestId("quick-entry-overlay")).toBeVisible();
    expect(screen.queryByTestId("quick-entry-native-modal")).toBeNull();
    expect(screen.getByText("Nacht")).toBeVisible();
    expect(screen.getByRole("button", { name: "Dienst hinzufügen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Termin hinzufügen" })).toBeVisible();
    expect(screen.queryByTestId("shift-selection-panel")).toBeNull();
    expect(screen.queryByText("Früh")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Dienst hinzufügen" }));
    expect(onOpenShiftPicker).toHaveBeenCalledWith("2026-08-04");
    expect(screen.queryByTestId("shift-selection-panel")).toBeNull();
  });

  it("can stay mounted without replaying its entering animation", async () => {
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <QuickEntryPopup
          actions={[
            earlyTemplateAction,
            { kind: "CUSTOM_SHIFT", key: "editor:shift", label: "Dienst" },
            { kind: "APPOINTMENT", key: "editor:appointment", label: "Termin" },
          ]}
          anchor={{ height: 48, width: 48, x: 40, y: 100 }}
          busy={false}
          date="2026-08-04"
          entries={[existingShift]}
          animateEntry={false}
          onClose={jest.fn()}
          onOpenEntry={jest.fn()}
          onOpenShiftPicker={jest.fn()}
          onSelectAction={jest.fn()}
        />
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("quick-entry-popup").props.entering).toBeUndefined();
    expect(screen.getByTestId("quick-entry-popup")).toBeVisible();
    expect(screen.getByText("Nacht")).toBeVisible();
  });

  it("releases the touch overlay immediately while its exit finishes", async () => {
    const onClose = jest.fn();
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <QuickEntryPopup
          actions={[{ kind: "CUSTOM_SHIFT", key: "editor:shift", label: "Dienst" }]}
          anchor={{ height: 48, width: 48, x: 40, y: 100 }}
          busy={false}
          date="2026-08-04"
          entries={[]}
          onClose={onClose}
          onOpenEntry={jest.fn()}
          onOpenShiftPicker={jest.fn()}
          onSelectAction={jest.fn()}
        />
      </SafeAreaProvider>,
    );

    await fireEvent.press(
      screen.getByTestId("quick-entry-backdrop", { includeHiddenElements: true }),
    );

    expect(screen.getByTestId("quick-entry-overlay", { includeHiddenElements: true })).toHaveProp(
      "pointerEvents",
      "none",
    );
    expect(screen.getByTestId("quick-entry-popup", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("quick-entry-overlay", { includeHiddenElements: true })).toHaveProp(
      "accessibilityElementsHidden",
      true,
    );
    // The overlay releases touches immediately; runOnJS completes the animation callback separately.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
  it("hides a retained iOS popup while another editing screen is focused", async () => {
    const props = {
      actions: [],
      anchor: { height: 48, width: 48, x: 40, y: 100 },
      busy: false,
      date: "2026-08-04",
      entries: [existingShift],
      onClose: jest.fn(),
      onOpenEntry: jest.fn(),
      onOpenShiftPicker: jest.fn(),
      onSelectAction: jest.fn(),
    };
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <QuickEntryPopup {...props} active={false} />
      </SafeAreaProvider>,
    );
    const overlay = screen.getByTestId("quick-entry-overlay", { includeHiddenElements: true });
    expect(overlay).toHaveStyle({ opacity: 0 });
    expect(overlay).toHaveProp("pointerEvents", "none");
    expect(overlay).toHaveProp("accessibilityElementsHidden", true);
    expect(screen.queryByRole("button", { name: "Nacht bearbeiten" })).toBeNull();
    await screen.rerender(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <QuickEntryPopup {...props} active />
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId("quick-entry-overlay")).toBe(overlay);
    expect(screen.getByTestId("quick-entry-overlay")).toHaveStyle({ opacity: 1 });
    expect(screen.getByRole("button", { name: "Nacht bearbeiten" })).toBeTruthy();
  });
});

it("opens own and foreign services from the same normal day tile", async () => {
  const ownOpen = jest.fn();
  const sharedOpen = jest.fn();
  const shared = {
    calendarId: "calendar-shared",
    calendarName: "Selena",
    calendarColor: "#527D92",
    fetchedAt: "2026-08-04T12:00:00Z",
    when: "07:00–15:00",
    entry: {
      id: "shared-early",
      startsAt: "2026-08-04T05:00:00Z",
      endsAt: "2026-08-04T13:00:00Z",
      timeZone: "Europe/Berlin",
      allDay: false,
      title: "Früh",
      color: "#00AA55",
      symbol: "sunrise",
    },
  };
  const screen = await renderCompact([existingShift], {
    sharedEntries: [shared],
    onDeleteEntry: jest.fn(async () => {}),
    onOpenEntry: ownOpen,
    onOpenSharedEntry: sharedOpen,
  });
  expect(screen.getByText("07:00–15:00 · Selena")).toBeTruthy();
  expect(screen.queryByText("sunrise")).toBeNull();
  expect(screen.getAllByTestId(/^swipe-entry-/)).toHaveLength(1);
  expect(screen.getByLabelText("Früh ansehen").props.accessibilityActions).toBeUndefined();
  await fireEvent.press(screen.getByLabelText("Nacht bearbeiten"));
  expect(ownOpen).toHaveBeenCalledWith(existingShift);
  expect(sharedOpen).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("Früh ansehen"));
  expect(sharedOpen).toHaveBeenCalledWith(shared, "2026-08-04");
  expect(ownOpen).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Dein Tag · geteilte Dienste nur ansehen")).toBeNull();
});
