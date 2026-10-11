import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import {
  DEFAULT_ANALYSIS_VIEW,
  moveAnalysisCard,
  type AnalysisViewPreferences,
} from "@/domain/analysis-view";
import { AnalysisViewProvider, useAnalysisView } from "./analysis-view-preferences";
import { AnalysisViewControls } from "./analysis-view-controls";
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context/jest/mock") as {
    default: object;
  };
  return actual.default;
});
let mockFontScale = 1;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: mockFontScale }),
}));
const mockDb = {};
const mockLoad = jest.fn<() => Promise<AnalysisViewPreferences>>();
const mockSave = jest.fn<(_db: unknown, p: AnalysisViewPreferences) => Promise<void>>();
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/infrastructure/database/analysis-view-repository", () => ({
  loadAnalysisView: () => mockLoad(),
  saveAnalysisView: (db: unknown, p: AnalysisViewPreferences) => mockSave(db, p),
}));
function Harness() {
  const s = useAnalysisView();
  return (
    <View>
      <Text testID="state">{JSON.stringify(s.preferences)}</Text>
      <Text>{s.ready ? "ready" : "loading"}</Text>
      <Text>{s.error ?? "OK"}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide pay"
        onPress={() => s.update((p) => ({ ...p, hidden: ["PAY"] }))}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Move shifts"
        onPress={() => s.update((p) => moveAnalysisCard(p, "SHIFTS", -1))}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={s.retry} />
    </View>
  );
}
const read = (screen: Awaited<ReturnType<typeof render>>) =>
  JSON.parse(screen.getByTestId("state").props.children) as AnalysisViewPreferences;
describe("analysis view preferences", () => {
  beforeEach(() => {
    mockFontScale = 1;
    mockLoad.mockReset().mockResolvedValue(DEFAULT_ANALYSIS_VIEW);
    mockSave.mockReset().mockResolvedValue();
  });
  it("loads the stored order and visibility after remount", async () => {
    let stored = DEFAULT_ANALYSIS_VIEW;
    mockLoad.mockImplementation(async () => stored);
    mockSave.mockImplementation(async (_db, next) => {
      stored = next;
    });
    const screen = await render(
      <AnalysisViewProvider>
        <Harness />
      </AnalysisViewProvider>,
    );
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: "Hide pay" }));
    await fireEvent.press(screen.getByRole("button", { name: "Move shifts" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    await screen.unmount();
    const next = await render(
      <AnalysisViewProvider>
        <Harness />
      </AnalysisViewProvider>,
    );
    await waitFor(() => expect(read(next).hidden).toEqual(["PAY"]));
    expect(read(next).order).toEqual(["WORK", "CHECK", "SHIFTS", "PAY"]);
  });
  it("serializes rapid writes and preserves every newer change", async () => {
    let finish!: () => void;
    mockSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const screen = await render(
      <AnalysisViewProvider>
        <Harness />
      </AnalysisViewProvider>,
    );
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: "Hide pay" }));
    await fireEvent.press(screen.getByRole("button", { name: "Move shifts" }));
    expect(mockSave).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    expect(mockSave.mock.calls[1][1]).toMatchObject({
      hidden: ["PAY"],
      order: ["WORK", "CHECK", "SHIFTS", "PAY"],
    });
  });
  it("rolls back a failed write and retries the requested view", async () => {
    mockSave.mockRejectedValueOnce(new Error("disk full"));
    const screen = await render(
      <AnalysisViewProvider>
        <Harness />
      </AnalysisViewProvider>,
    );
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: "Hide pay" }));
    await waitFor(() =>
      expect(screen.getByText("Deine Ansicht konnte nicht gespeichert werden.")).toBeTruthy(),
    );
    expect(read(screen)).toEqual(DEFAULT_ANALYSIS_VIEW);
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    expect(read(screen).hidden).toEqual(["PAY"]);
  });
  it("keeps customization stable while loading and recovers from a load failure", async () => {
    let rejectLoad!: (cause: Error) => void;
    mockLoad.mockImplementationOnce(
      () =>
        new Promise<AnalysisViewPreferences>((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    const screen = await render(
      <AnalysisViewProvider>
        <Harness />
        <AnalysisViewControls />
      </AnalysisViewProvider>,
    );
    expect(screen.getByText("Ansicht anpassen")).toBeTruthy();
    expect(screen.queryByText("Ansicht wird geladen …")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Ansicht anpassen" }).props.accessibilityState,
    ).toEqual({ disabled: true, busy: true });
    await fireEvent.press(screen.getByRole("button", { name: "Ansicht anpassen" }));
    expect(screen.queryByTestId("analysis-setting-WORK")).toBeNull();
    await act(async () => rejectLoad(new Error("locked")));
    await waitFor(() =>
      expect(screen.getAllByText("Deine Ansicht konnte nicht geladen werden.")).not.toHaveLength(0),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Hide pay" }));
    expect(mockSave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    expect(
      screen.getByRole("button", { name: "Ansicht anpassen" }).props.accessibilityState,
    ).toEqual({ disabled: false, busy: false });
    await fireEvent.press(screen.getByRole("button", { name: "Ansicht anpassen" }));
    expect(screen.getByTestId("analysis-setting-WORK")).toBeTruthy();
  });
  it("shows only sustained saves without changing the status line layout or leaking a timer", async () => {
    jest.useFakeTimers();
    try {
      let finishSave!: () => void;
      mockSave.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishSave = resolve;
          }),
      );
      const screen = await render(
        <AnalysisViewProvider>
          <Harness />
          <AnalysisViewControls />
        </AnalysisViewProvider>,
      );
      await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
      await fireEvent.press(screen.getByRole("button", { name: "Ansicht anpassen" }));
      const hiddenStatus = screen.getByText("Wird gespeichert …", { includeHiddenElements: true });
      const statusStyle = StyleSheet.flatten(hiddenStatus.props.style);
      expect(hiddenStatus).toHaveStyle({ opacity: 0 });
      expect(screen.queryByText("Wird gespeichert …")).toBeNull();

      await fireEvent(screen.getByLabelText("Gehalt anzeigen"), "valueChange", false);
      await act(async () => jest.advanceTimersByTime(100));
      expect(screen.queryByText("Wird gespeichert …")).toBeNull();
      await act(async () => finishSave());
      await act(async () => jest.advanceTimersByTime(600));
      expect(screen.queryByText("Wird gespeichert …")).toBeNull();
      expect(read(screen).hidden).toEqual(["PAY"]);

      await fireEvent(screen.getByLabelText("Gehalt anzeigen"), "valueChange", true);
      await act(async () => jest.advanceTimersByTime(599));
      expect(screen.queryByText("Wird gespeichert …")).toBeNull();
      await act(async () => jest.advanceTimersByTime(1));
      expect(screen.getByText("Wird gespeichert …")).toHaveStyle({ opacity: 1 });
      expect(screen.getByText("Wird gespeichert …")).toHaveStyle({
        ...statusStyle,
        opacity: 1,
      });
      await act(async () => finishSave());
      expect(screen.queryByText("Wird gespeichert …")).toBeNull();

      await fireEvent(screen.getByLabelText("Gehalt anzeigen"), "valueChange", false);
      await act(async () => jest.advanceTimersByTime(300));
      await fireEvent.press(screen.getByRole("button", { name: "Ansicht schließen" }));
      await act(async () => finishSave());
      await act(async () => jest.advanceTimersByTime(1000));
      await fireEvent.press(screen.getByRole("button", { name: "Ansicht anpassen" }));
      expect(screen.queryByText("Wird gespeichert …")).toBeNull();
      await screen.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
  it.each([1, 3.1])("supports native customization at scale %s", async (fontScale) => {
    mockFontScale = fontScale;
    const screen = await render(
      <AnalysisViewProvider>
        <Harness />
        <AnalysisViewControls />
      </AnalysisViewProvider>,
    );
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    await fireEvent.press(screen.getByRole("button", { name: "Ansicht anpassen" }));
    expect(screen.getByTestId("analysis-setting-WORK")).toHaveStyle({
      flexDirection: fontScale >= 1.3 ? "column" : "row",
    });
    expect(screen.getByLabelText("Gehalt anzeigen").props.hitSlop).toBe(8);
    await fireEvent(screen.getByLabelText("Gehalt anzeigen"), "valueChange", false);
    expect(screen.queryByRole("button", { name: "Schichten nach oben" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Reihenfolge ändern" }));
    expect(screen.queryByLabelText("Gehalt anzeigen")).toBeNull();
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    await fireEvent(screen.getByTestId("analysis-sort-row-SHIFTS"), "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(read(screen)).toMatchObject({
      hidden: ["PAY"],
      order: ["WORK", "CHECK", "SHIFTS", "PAY"],
    });
    expect(screen.queryByRole("button", { name: "Standard wiederherstellen" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Auswahl anzeigen" }));
    expect(screen.getByLabelText("Gehalt anzeigen")).toBeTruthy();
    expect(read(screen)).toMatchObject({
      hidden: ["PAY"],
      order: ["WORK", "CHECK", "SHIFTS", "PAY"],
    });
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(screen.queryByText("Deine Karten für Monat und Jahr.")).toBeNull();
  });
  it.each([false, true])(
    "persists a multi-slot drag or rolls back a failed write (%s)",
    async (fail) => {
      jest.useFakeTimers();
      try {
        const initial: AnalysisViewPreferences = { ...DEFAULT_ANALYSIS_VIEW, hidden: ["PAY"] };
        mockLoad.mockResolvedValue(initial);
        if (fail) mockSave.mockRejectedValueOnce(new Error("disk full"));
        const screen = await render(
          <AnalysisViewProvider>
            <Harness />
            <AnalysisViewControls />
          </AnalysisViewProvider>,
        );
        await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
        await fireEvent.press(screen.getByRole("button", { name: "Ansicht anpassen" }));
        await fireEvent.press(screen.getByRole("button", { name: "Reihenfolge ändern" }));
        await act(async () => {
          fireGestureHandler(getByGestureTestId("analysis-sort-drag-WORK"), [
            { state: State.BEGAN },
            { state: State.ACTIVE, translationY: 0, translationX: 0 },
            { state: State.ACTIVE, translationY: 220, translationX: 20 },
            { state: State.END, translationY: 220, translationX: 20 },
          ]);
          jest.advanceTimersByTime(500);
        });
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockSave.mock.calls[0][1]).toMatchObject({
          order: ["CHECK", "PAY", "SHIFTS", "WORK"],
          hidden: ["PAY"],
        });
        await waitFor(() =>
          expect(read(screen).order).toEqual(
            fail ? initial.order : ["CHECK", "PAY", "SHIFTS", "WORK"],
          ),
        );
        expect(
          screen.getByRole("adjustable", { name: `Arbeitszeit, Position ${fail ? 1 : 4} von 4` }),
        ).toBeTruthy();
        if (fail)
          expect(
            screen.getAllByText("Deine Ansicht konnte nicht gespeichert werden."),
          ).not.toHaveLength(0);
        await screen.unmount();
      } finally {
        jest.useRealTimers();
      }
    },
  );
});
