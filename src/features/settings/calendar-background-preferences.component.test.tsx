import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Pressable, Text, View } from "react-native";
import {
  CalendarBackgroundProvider,
  useCalendarBackground,
} from "./calendar-background-preferences";

import { CalendarBackground } from "@/features/calendar/calendar-background";
import { CalendarBackgroundControl } from "./calendar-background-control";
import type { CalendarImageStrength } from "@/theme/calendar-image";

const mockLoadStrength = jest.fn<() => Promise<CalendarImageStrength>>();
const mockSaveStrength =
  jest.fn<(_db: unknown, strength: CalendarImageStrength) => Promise<void>>();
const mockLoadRemoved = jest.fn<() => Promise<string | null>>();
const mockDb = {};
const mockLoad = jest.fn<() => Promise<string | null>>();
const mockSave = jest.fn<(_db: unknown, uri: string | null) => Promise<void>>();
const mockImport = jest.fn<() => Promise<string>>();
const mockDelete = jest.fn();
const mockPick =
  jest.fn<
    () => Promise<{ canceled: boolean; assets: { uri: string; width: number; height: number }[] }>
  >();
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: () => mockPick() }));
jest.mock("./calendar-background-storage", () => ({
  loadCalendarBackground: () => mockLoad(),
  loadRemovedCalendarBackground: () => mockLoadRemoved(),
  loadCalendarBackgroundStrength: () => mockLoadStrength(),
  saveCalendarBackgroundStrength: (db: unknown, strength: CalendarImageStrength) =>
    mockSaveStrength(db, strength),
  importCalendarBackground: () => mockImport(),
  saveCalendarBackgroundChange: async (
    db: unknown,
    uri: string | null,
    removed: string | null,
    reset: boolean,
  ) => {
    await mockSave(db, uri);
    if (reset) await mockSaveStrength(db, "medium");
    mockLoad.mockResolvedValue(uri);
    mockLoadRemoved.mockResolvedValue(removed);
  },
  deleteCalendarBackground: (uri: string) => mockDelete(uri),
}));
function Harness() {
  const value = useCalendarBackground();
  return (
    <View>
      <Text testID="uri">{value.uri ?? "standard"}</Text>
      <Text testID="strength">{value.strength}</Text>
      <CalendarBackground />
      <CalendarBackgroundControl />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="reset-background"
        onPress={() => void value.reset()}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="choose"
        disabled={!value.ready}
        onPress={() => void value.choose()}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="remove"
        onPress={() => void value.remove()}
      />
    </View>
  );
}
async function open() {
  const screen = await render(
    <CalendarBackgroundProvider>
      <Harness />
    </CalendarBackgroundProvider>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "choose" })).toBeEnabled());
  return screen;
}
async function dragOpacity(
  screen: Awaited<ReturnType<typeof open>>,
  value: number,
  release = true,
) {
  const slider = screen.getByRole("adjustable", { name: "Deckkraft des Kalenderfotos" });
  await fireEvent(slider, "layout", { nativeEvent: { layout: { width: 124 } } });
  await fireEvent(slider, "responderGrant", {
    nativeEvent: { pageX: 100, locationX: value + 12 },
  });
  if (release) await fireEvent(slider, "responderRelease");
}
function expectOpacity(screen: Awaited<ReturnType<typeof open>>, value: number) {
  expect(screen.getByRole("adjustable", { name: "Deckkraft des Kalenderfotos" })).toHaveProp(
    "accessibilityValue",
    expect.objectContaining({ now: value }),
  );
}
describe("local calendar background", () => {
  beforeEach(() => {
    mockLoad.mockReset().mockResolvedValue("file:///old.jpg");
    mockLoadRemoved.mockReset().mockResolvedValue(null);
    mockLoadStrength.mockReset().mockResolvedValue("medium");
    mockSaveStrength.mockReset().mockResolvedValue();
    mockSave.mockReset().mockResolvedValue();
    mockImport.mockReset().mockResolvedValue("file:///new.jpg");
    mockDelete.mockReset();
    mockPick.mockReset().mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///picked.jpg", width: 100, height: 100 }],
    });
  });
  it("restores the saved strength and displays the matching photo preview", async () => {
    mockLoadStrength.mockResolvedValue("strong");
    const screen = await open();
    expectOpacity(screen, 40);
    expect(
      screen.getByTestId("calendar-custom-background-overlay", { includeHiddenElements: true }),
    ).toHaveStyle({ opacity: 0.6 });
  });
  it("changes strength through the visible control and retains it after remount", async () => {
    mockSaveStrength.mockImplementation(async (_db, strength) => {
      mockLoadStrength.mockResolvedValue(strength);
    });
    const first = await open();
    await dragOpacity(first, 35);
    await waitFor(() => expectOpacity(first, 35));
    expect(mockSaveStrength).toHaveBeenCalledWith(mockDb, 35);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    await first.unmount();
    const second = await open();
    expectOpacity(second, 35);
  });
  it("keeps the previous strength and photo when saving strength fails", async () => {
    mockSaveStrength.mockRejectedValue(new Error("disk full"));
    const screen = await open();
    await dragOpacity(screen, 40);
    await waitFor(() =>
      expect(screen.getByText(/Bildstärke konnte nicht gespeichert/)).toBeTruthy(),
    );
    expectOpacity(screen, 25);
    expect(screen.getByTestId("uri")).toHaveTextContent("file:///old.jpg");
    expect(mockDelete).not.toHaveBeenCalled();
  });
  it("blocks another image operation while the strength write is pending", async () => {
    let complete!: () => void;
    mockSaveStrength.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    const screen = await open();
    await dragOpacity(screen, 40);
    await waitFor(() => expect(screen.getByRole("adjustable")).toBeDisabled());
    await fireEvent.press(screen.getByRole("button", { name: "choose" }));
    expect(mockPick).not.toHaveBeenCalled();
    await act(async () => complete());
    await waitFor(() => expect(screen.getByRole("adjustable")).toBeEnabled());
    expectOpacity(screen, 40);
  });
  it("does not write again for the selected strength", async () => {
    const screen = await open();
    await dragOpacity(screen, 25);
    expect(mockSaveStrength).not.toHaveBeenCalled();
  });
  it("retains strength when replacing the image", async () => {
    mockLoadStrength.mockResolvedValue("strong");
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "choose" }));
    await waitFor(() => expect(screen.getByTestId("uri")).toHaveTextContent("file:///new.jpg"));
    expectOpacity(screen, 40);
    expect(mockSaveStrength).not.toHaveBeenCalled();
  });
  it("restores the saved image after remount", async () => {
    const first = await open();
    expect(first.getByTestId("uri")).toHaveTextContent("file:///old.jpg");
    await first.unmount();
    const second = await open();
    expect(second.getByTestId("uri")).toHaveTextContent("file:///old.jpg");
  });
  it("leaves the previous image and storage untouched when selection is canceled", async () => {
    mockPick.mockResolvedValue({ canceled: true, assets: [] });
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "choose" }));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(mockImport).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("uri")).toHaveTextContent("file:///old.jpg");
  });
  it("activates the new image only after saving, then deletes the old one", async () => {
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "choose" }));
    await waitFor(() => expect(screen.getByTestId("uri")).toHaveTextContent("file:///new.jpg"));
    expect(mockSave).toHaveBeenCalledWith(mockDb, "file:///new.jpg");
    expect(mockDelete).toHaveBeenCalledWith("file:///old.jpg");
  });
  it("keeps the old image when persistence fails and cleans up the imported copy", async () => {
    mockSave.mockRejectedValue(new Error("disk full"));
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "choose" }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("file:///new.jpg"));
    expect(mockDelete).not.toHaveBeenCalledWith("file:///old.jpg");
    expect(screen.getByTestId("uri")).toHaveTextContent("file:///old.jpg");
    expect(screen.getByText(/Kalender(bild|hintergrund) konnte nicht gespeichert/)).toBeTruthy();
  });
  it("removes only the saved reference and keeps the photo available for undo", async () => {
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "remove" }));
    await waitFor(() => expect(screen.getByTestId("uri")).toHaveTextContent("standard"));
    expect(mockSave).toHaveBeenCalledWith(mockDb, null);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Rückgängig" })).toBeTruthy();
    expect(screen.getByTestId("strength")).toHaveTextContent("medium");
  });
  it("retains the old image when removal fails", async () => {
    mockSave.mockRejectedValue(new Error("write failed"));
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "remove" }));
    await waitFor(() =>
      expect(screen.getByText(/Kalender(bild|hintergrund) konnte nicht gespeichert/)).toBeTruthy(),
    );
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("uri")).toHaveTextContent("file:///old.jpg");
  });
  it("restores the same removed photo and strength after a provider remount", async () => {
    mockLoadStrength.mockResolvedValue("strong");
    const first = await open();
    await fireEvent.press(first.getByRole("button", { name: "remove" }));
    await waitFor(() => expect(first.getByTestId("uri")).toHaveTextContent("standard"));
    await first.unmount();
    const second = await open();
    await fireEvent.press(second.getByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(second.getByTestId("uri")).toHaveTextContent("file:///old.jpg"));
    expect(second.getByTestId("strength")).toHaveTextContent("strong");
    expect(mockImport).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(second.queryByRole("button", { name: "Rückgängig" })).toBeNull();
  });
  it("keeps undo available when restoration cannot be persisted", async () => {
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "remove" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rückgängig" })).toBeTruthy());
    mockSave.mockRejectedValueOnce(new Error("write failed"));
    await fireEvent.press(screen.getByRole("button", { name: "Rückgängig" }));
    await waitFor(() =>
      expect(screen.getByText(/Kalenderhintergrund konnte nicht gespeichert/)).toBeTruthy(),
    );
    expect(screen.getByTestId("uri")).toHaveTextContent("standard");
    expect(screen.getByRole("button", { name: "Rückgängig" })).toBeTruthy();
    expect(mockDelete).not.toHaveBeenCalled();
  });
  it("cleans the retained photo only after a replacement is saved", async () => {
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "remove" }));
    await waitFor(() => expect(screen.getByTestId("uri")).toHaveTextContent("standard"));
    expect(mockDelete).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "choose" }));
    await waitFor(() => expect(screen.getByTestId("uri")).toHaveTextContent("file:///new.jpg"));
    expect(mockDelete).toHaveBeenCalledWith("file:///old.jpg");
    expect(screen.queryByRole("button", { name: "Rückgängig" })).toBeNull();
  });
  it("updates the preview strength immediately while the write is pending", async () => {
    let complete!: () => void;
    mockSaveStrength.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    const screen = await open();
    await dragOpacity(screen, 40);
    expectOpacity(screen, 40);
    expect(
      screen.getByTestId("calendar-custom-background-overlay", { includeHiddenElements: true }),
    ).toHaveStyle({ opacity: 0.6 });
    await act(async () => complete());
  });
  it("resets photo, undo and strength together only through the explicit reset action", async () => {
    mockLoadStrength.mockResolvedValue("strong");
    const screen = await open();
    await fireEvent.press(screen.getByRole("button", { name: "reset-background" }));
    await waitFor(() => expect(screen.getByTestId("uri")).toHaveTextContent("standard"));
    expect(screen.getByTestId("strength")).toHaveTextContent("medium");
    expect(mockDelete).toHaveBeenCalledWith("file:///old.jpg");
    expect(screen.queryByRole("button", { name: "Rückgängig" })).toBeNull();
  });
  it("previews continuous dragging without persisting or changing the widget value until release", async () => {
    const screen = await open();
    await dragOpacity(screen, 35, false);
    expectOpacity(screen, 35);
    expect(screen.getByTestId("strength")).toHaveTextContent("medium");
    expect(mockSaveStrength).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("calendar-custom-background-overlay", { includeHiddenElements: true }),
    ).toHaveStyle({ opacity: 0.65 });
    await fireEvent(screen.getByRole("adjustable"), "responderMove", {
      nativeEvent: { pageX: 120 },
    });
    expectOpacity(screen, 55);
    expect(mockSaveStrength).not.toHaveBeenCalled();
    await fireEvent(screen.getByRole("adjustable"), "responderRelease");
    expect(mockSaveStrength).toHaveBeenCalledTimes(1);
    expect(mockSaveStrength).toHaveBeenCalledWith(mockDb, 55);
    expect(screen.getByTestId("strength")).toHaveTextContent("55");
  });
  it("restores saved opacity when a drag is interrupted", async () => {
    const screen = await open();
    await dragOpacity(screen, 75, false);
    await fireEvent(screen.getByRole("adjustable"), "responderTerminate");
    expectOpacity(screen, 25);
    expect(mockSaveStrength).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("calendar-custom-background-overlay", { includeHiddenElements: true }),
    ).toHaveStyle({ opacity: 0.75 });
  });
  it.each([
    { start: 100, blocked: "increment", allowed: "decrement", next: 99 },
    { start: 0, blocked: "decrement", allowed: "increment", next: 1 },
  ])(
    "adjusts by one percent with VoiceOver at the $start-percent endpoint",
    async ({ start, blocked, allowed, next }) => {
      mockLoadStrength.mockResolvedValue(start);
      const screen = await open();
      await fireEvent(screen.getByRole("adjustable"), "accessibilityAction", {
        nativeEvent: { actionName: blocked },
      });
      expect(mockSaveStrength).not.toHaveBeenCalled();
      await fireEvent(screen.getByRole("adjustable"), "accessibilityAction", {
        nativeEvent: { actionName: allowed },
      });
      expect(mockSaveStrength).toHaveBeenCalledWith(mockDb, next);
      expectOpacity(screen, next);
    },
  );
  it("retains a 100-percent photo without writing on load, then stores an explicit 50-percent choice", async () => {
    mockLoadStrength.mockResolvedValue(100);
    const screen = await open();
    expectOpacity(screen, 100);
    expect(
      screen.getByTestId("calendar-custom-background-overlay", { includeHiddenElements: true }),
    ).toHaveStyle({ opacity: 0 });
    expect(mockSaveStrength).not.toHaveBeenCalled();
    await dragOpacity(screen, 50);
    expect(mockSaveStrength).toHaveBeenCalledWith(mockDb, 50);
    expect(screen.getByTestId("uri")).toHaveTextContent("file:///old.jpg");
  });
  it.each([
    [-100, 0],
    [150, 100],
  ])("clamps out-of-track touch %s to %s percent", async (touch, expected) => {
    const screen = await open();
    await dragOpacity(screen, touch);
    expectOpacity(screen, expected);
    expect(mockSaveStrength).toHaveBeenCalledWith(mockDb, expected);
  });
});
