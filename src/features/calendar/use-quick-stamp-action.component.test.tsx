import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AccessibilityInfo, Pressable, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { CalendarEntry, ShiftEntry, ShiftTemplate } from "@/domain/types";
import { buildQuickEntryActions } from "@/features/calendar/quick-entry-actions";
import { useQuickStampAction } from "@/features/calendar/use-quick-stamp-action";
import { FeedbackProvider } from "@/ui/feedback";
import { selectionFeedback, successFeedback } from "@/ui/haptics";
import { calendarPerformance } from "@/application/calendar-performance";

jest.mock("@/ui/haptics", () => ({
  selectionFeedback: jest.fn(),
  successFeedback: jest.fn(),
  warningFeedback: jest.fn(),
}));

const TEMPLATE: ShiftTemplate = {
  id: "day",
  name: "Tag",
  type: "DAY",
  startTime: "08:00",
  endTime: "16:00",
  breakMinutes: 30,
  color: "#2F80ED",
  symbol: "T",
  sortOrder: 1,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

function entry(id = "day-1"): ShiftEntry {
  return {
    kind: "SHIFT",
    id,
    date: "2026-08-04",
    templateId: TEMPLATE.id,
    title: TEMPLATE.name,
    type: TEMPLATE.type,
    startTime: TEMPLATE.startTime,
    endTime: TEMPLATE.endTime,
    breakMinutes: TEMPLATE.breakMinutes,
    color: TEMPLATE.color,
    symbol: TEMPLATE.symbol,
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

const mockRemoveEntry = jest.fn<(value: CalendarEntry) => Promise<void>>();
const mockUpsertShift = jest.fn<() => Promise<ShiftEntry>>();
const mockBusyChange = jest.fn<(busy: boolean) => void>();
const mockError = jest.fn<(message: string) => void>();

function Harness({ entries }: { readonly entries: readonly ShiftEntry[] }) {
  const { stamp: saveStamp, displayEntries } = useQuickStampAction({
    // A fresh database read can have identical values with new array/object identities.
    entries: entries.map((value) => ({ ...value })),
    removeEntry: mockRemoveEntry,
    upsertShift: mockUpsertShift,
    onBusyChange: mockBusyChange,
    onError: mockError,
  });
  const action = buildQuickEntryActions([TEMPLATE])[0];

  if (action.kind !== "TEMPLATE") throw new Error("Expected template action");
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => void saveStamp(action, "2026-08-04")}>
        <Text>Tag anwenden</Text>
      </Pressable>
      <Text testID="stamp-entry-count">{displayEntries.length}</Text>
    </>
  );
}

function TestProvider({ children }: React.PropsWithChildren) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 932 },
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
      }}
    >
      <FeedbackProvider>{children}</FeedbackProvider>
    </SafeAreaProvider>
  );
}

describe("useQuickStampAction", () => {
  afterEach(() => calendarPerformance.clear());
  beforeEach(() => {
    calendarPerformance.clear();
    mockRemoveEntry.mockResolvedValue(undefined);
    mockUpsertShift.mockResolvedValue(entry());
    jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(jest.fn());
  });

  it("adds a service with only subtle selection feedback and accessibility", async () => {
    const screen = await render(
      <TestProvider>
        <Harness entries={[]} />
      </TestProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Tag anwenden" }));
    });

    await waitFor(() => expect(mockUpsertShift).toHaveBeenCalledTimes(1));
    expect(selectionFeedback).toHaveBeenCalledTimes(1);
    expect(successFeedback).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      expect.stringContaining("hinzugefügt"),
    );
    expect(screen.queryByText("Tag eingetragen.")).toBeNull();
    expect(calendarPerformance.report().events).toEqual([]);
  });

  it("removes a matching service silently without offering undo", async () => {
    const screen = await render(
      <TestProvider>
        <Harness entries={[entry()]} />
      </TestProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Tag anwenden" }));
    });

    await waitFor(() => expect(mockRemoveEntry).toHaveBeenCalledWith(entry()));
    expect(selectionFeedback).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Tag entfernt.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Rückgängig" })).toBeNull();
  });

  it.each([false, true])(
    "shows every rapid toggle before persistence completes (existing=%s)",
    async (existing) => {
      calendarPerformance.start(true);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (existing) mockRemoveEntry.mockImplementationOnce(() => pending);
      else
        mockUpsertShift.mockImplementationOnce(async () => {
          await pending;
          return entry();
        });
      const screen = await render(
        <TestProvider>
          <Harness entries={existing ? [entry()] : []} />
        </TestProvider>,
      );
      const button = screen.getByRole("button", { name: "Tag anwenden" });
      for (const count of existing ? [0, 1, 0] : [1, 0, 1]) {
        await fireEvent.press(button);
        expect(screen.getByTestId("stamp-entry-count")).toHaveTextContent(String(count));
        expect(mockBusyChange).toHaveBeenLastCalledWith(true);
      }
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
      const pendingEvents = calendarPerformance.report().events;
      expect(pendingEvents.filter((event) => event.kind === "stamp-handler")).toHaveLength(3);
      expect(
        pendingEvents
          .filter((event) => event.kind === "stamp-preview" && event.values.phase === 2)
          .at(-1)?.values.input,
      ).toBe(existing ? 0 : 1);
      expect(pendingEvents.some((event) => event.kind === "stamp-persist")).toBe(false);
      await act(async () => release());
      await waitFor(() => expect(mockBusyChange).toHaveBeenLastCalledWith(false));
      expect(mockUpsertShift).toHaveBeenCalledTimes(existing ? 1 : 2);
      expect(mockRemoveEntry).toHaveBeenCalledTimes(existing ? 2 : 1);
      expect(screen.getByTestId("stamp-entry-count")).toHaveTextContent(existing ? "0" : "1");
      const completed = calendarPerformance.report().events;
      expect(completed.findIndex((event) => event.kind === "stamp-persist")).toBeGreaterThan(
        completed.findIndex((event) => event.kind === "stamp-handler"),
      );
      expect(completed.filter((event) => event.kind === "stamp-persist")).toHaveLength(3);
      expect(completed.find((event) => event.kind === "stamp-persist")?.values).toMatchObject({
        mode: existing ? 0 : 1,
        state: 1,
      });
    },
  );
});
