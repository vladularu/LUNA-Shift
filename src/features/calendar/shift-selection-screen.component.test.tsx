import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { CalendarEntry, ShiftEntry, ShiftTemplate } from "@/domain/types";
import {
  beginShiftSelectionNavigation,
  consumeShiftSelectionPopupRestore,
} from "@/features/calendar/quick-entry-navigation";
import { ShiftSelectionScreen } from "@/features/calendar/shift-selection-screen";
import { SPACING } from "@/theme/tokens";

const template: ShiftTemplate = {
  id: "early",
  name: "Früh",
  type: "EARLY",
  allDay: false,
  startTime: "06:00",
  endTime: "14:12",
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

const mockUpsertShift = jest.fn<() => Promise<ShiftEntry>>();
const mockRemoveEntry = jest.fn<() => Promise<void>>();
let mockEntries: readonly CalendarEntry[] = [];

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), dismissTo: jest.fn(), push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ date: "2026-08-15" }),
}));

jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({
    entries: mockEntries,
    removeEntry: mockRemoveEntry,
    upsertShift: mockUpsertShift,
  }),
  usePflegeShiftStatus: () => ({ ready: true, error: null, reload: jest.fn() }),
  usePflegeShiftTemplates: () => ({ templates: [template] }),
}));

jest.mock("@/ui/use-theme-status-bar", () => ({ useThemeStatusBar: () => undefined }));

function TestScreen() {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 932 },
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
      }}
    >
      <ShiftSelectionScreen />
    </SafeAreaProvider>
  );
}

describe("ShiftSelectionScreen", () => {
  beforeEach(() => {
    beginShiftSelectionNavigation();
    jest.mocked(router.back).mockClear();
    jest.mocked(router.dismissTo).mockClear();
    jest.mocked(router.push).mockClear();
    jest.mocked(router.replace).mockClear();
    mockEntries = [];
    mockUpsertShift.mockReset();
    mockUpsertShift.mockResolvedValue({} as ShiftEntry);
    mockRemoveEntry.mockReset();
  });

  it("replaces the native selection sheet when editing or adding a template", async () => {
    const screen = await render(<TestScreen />);

    expect(screen.getByRole("header", { name: /Dienst auswählen/ })).toBeVisible();
    expect(screen.getByText(/15\. August 2026/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Dienstauswahl schließen" })).toHaveStyle({
      width: 44,
      height: 44,
    });
    expect(screen.getByText("Dienstvorlagen")).toBeVisible();
    expect(screen.getByTestId("shift-selection-panel").props.entering).toBeUndefined();
    expect(screen.getByTestId("shift-selection-panel").props.exiting).toBeUndefined();
    expect(screen.getByTestId("shift-selection-panel")).toHaveStyle({ paddingTop: SPACING.lg });

    await fireEvent.press(screen.getByRole("button", { name: "Früh Dienstvorlage bearbeiten" }));
    expect(router.replace).toHaveBeenLastCalledWith({
      pathname: "/template-editor",
      params: { id: "early" },
    });
    expect(screen.getByText("Dienstvorlagen")).toBeVisible();

    await fireEvent.press(screen.getByRole("button", { name: "Vorlage erstellen und eintragen" }));
    expect(router.replace).toHaveBeenLastCalledWith({
      pathname: "/template-editor",
      params: { quickEntryDate: "2026-08-15" },
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(mockUpsertShift).not.toHaveBeenCalled();
  });

  it("returns to the calendar after a normal template selection", async () => {
    const screen = await render(<TestScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Früh direkt eintragen" }));

    await waitFor(() =>
      expect(mockUpsertShift).toHaveBeenCalledWith(
        expect.objectContaining({ date: "2026-08-15", templateId: "early" }),
      ),
    );
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(consumeShiftSelectionPopupRestore()).toBe(false);
  });

  it("closes without writing when selection is cancelled", async () => {
    const screen = await render(<TestScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Dienstauswahl schließen" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockUpsertShift).not.toHaveBeenCalled();
    expect(mockRemoveEntry).not.toHaveBeenCalled();
  });

  it("keeps an already assigned service when it is selected again", async () => {
    mockEntries = [
      {
        ...template,
        kind: "SHIFT",
        id: "existing-early",
        templateId: template.id,
        date: "2026-08-15",
        title: template.name,
        allDay: template.allDay ?? false,
        note: null,
        overtimeMinutes: 0,
        holidayPremiumMode: "WITH_TIME_OFF",
      },
    ];
    const screen = await render(<TestScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Früh direkt eintragen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Früh direkt eintragen" }));

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(mockRemoveEntry).not.toHaveBeenCalled();
    expect(mockUpsertShift).not.toHaveBeenCalled();
  });

  it("stays open and shows the error when inserting fails", async () => {
    mockUpsertShift.mockRejectedValue(new Error("Speichern fehlgeschlagen"));
    const screen = await render(<TestScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Früh direkt eintragen" }));

    await waitFor(() =>
      expect(screen.getByText("Dienst konnte nicht eingetragen werden.")).toBeVisible(),
    );
    expect(router.back).not.toHaveBeenCalled();
    expect(mockRemoveEntry).not.toHaveBeenCalled();

    mockUpsertShift.mockResolvedValue({} as ShiftEntry);
    await fireEvent.press(screen.getByRole("button", { name: "Früh direkt eintragen" }));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(mockUpsertShift).toHaveBeenCalledTimes(2);
  });
});
