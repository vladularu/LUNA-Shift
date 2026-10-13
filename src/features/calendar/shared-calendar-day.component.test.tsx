import { render, fireEvent } from "@testing-library/react-native";
import { beforeEach, afterEach, it, expect, jest } from "@jest/globals";
import * as MockReact from "react";
import { View as MockView, Pressable as MockPressable, Text as MockText } from "react-native";
import { SharedCalendarsContext } from "@/application/shared-calendars-context";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import { useSharedCalendarDays } from "./use-shared-calendar-days";
import { SharedCalendarDayMark, SharedCalendarDaySheet } from "./shared-calendar-day";
import { sharedCalendarDays } from "./shared-calendar-display";

jest.mock("@/ui/selection-sheet", () => ({
  SelectionSheet: ({
    children,
    onClose,
    visible,
  }: {
    children: () => MockReact.ReactNode;
    onClose: () => void;
    visible: boolean;
  }) =>
    visible
      ? MockReact.createElement(
          MockView,
          { testID: "shared-sheet" },
          children(),
          MockReact.createElement(
            MockPressable,
            { accessibilityRole: "button", accessibilityLabel: "Schließen", onPress: onClose },
            MockReact.createElement(MockText, null, "Schließen"),
          ),
        )
      : null,
}));
const cache: CachedSharedCalendar = {
  accountId: "accountA",
  visible: true,
  fetchedAt: "2026-10-12T10:00:00Z",
  calendar: {
    id: "cal",
    ownerId: "owner",
    name: "Alex",
    color: "#123456",
    visibility: "DETAILS",
    revision: 1,
    isOwner: false,
    publishedAt: "2026-10-12T10:00:00Z",
  },
  entries: [
    {
      id: "entry",
      title: "Nacht",
      symbol: "moon",
      color: "#123456",
      startsAt: "2026-10-11T19:00:00Z",
      endsAt: "2026-10-12T05:30:00Z",
      timeZone: "Europe/Berlin",
      allDay: false,
    },
  ],
};
const closePopup = jest.fn();
function Screen() {
  const view = useSharedCalendarDays("Europe/Berlin", true, closePopup, "2026-10");
  return (
    <MockView>
      <MockText>Oktober 2026</MockText>
      <MockPressable testID="open-shared" onPress={() => view.openSharedDate("2026-10-11")} />
      {view.sharedDaySheet}
    </MockView>
  );
}
function Wrapper({ items }: { items: readonly CachedSharedCalendar[] }) {
  return (
    <SharedCalendarsContext value={items}>
      <Screen />
    </SharedCalendarsContext>
  );
}
beforeEach(() => {
  closePopup.mockClear();
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T12:00:00Z"));
});
afterEach(() => {
  jest.restoreAllMocks();
});
it("opens read-only details and closes while keeping the calendar month", async () => {
  const screen = await render(<Wrapper items={[cache]} />);
  await fireEvent.press(screen.getByTestId("open-shared"));
  expect(closePopup).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Alex")).toBeTruthy();
  expect(screen.getByText("21:00–07:30 · endet am 12.10.")).toBeTruthy();
  expect(screen.queryByText("Bearbeiten")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Schließen"));
  expect(screen.queryByTestId("shared-sheet")).toBeNull();
  expect(screen.getByText("Oktober 2026")).toBeTruthy();
});
it("removes already-open details after known revocation", async () => {
  const screen = await render(<Wrapper items={[cache]} />);
  await fireEvent.press(screen.getByTestId("open-shared"));
  await screen.rerender(<Wrapper items={[]} />);
  expect(screen.queryByTestId("shared-sheet")).toBeNull();
  expect(screen.queryByText("Nacht")).toBeNull();
});
it("closes the selection when accounts change even with the same authorized calendar", async () => {
  const screen = await render(<Wrapper items={[cache]} />);
  await fireEvent.press(screen.getByTestId("open-shared"));
  await screen.rerender(<Wrapper items={[{ ...cache, accountId: "accountB" }]} />);
  expect(screen.queryByTestId("shared-sheet")).toBeNull();
});
it("does not propagate a foreign touch into local editing or stamping", async () => {
  const pressed = jest.fn();
  const stopPropagation = jest.fn();
  const rows = sharedCalendarDays([cache], "Europe/Berlin").get("2026-10-11")!;
  const screen = await render(
    <SharedCalendarDayMark date="2026-10-11" entries={rows} onPress={pressed} />,
  );
  await fireEvent.press(screen.getByTestId("shared-calendar-day-2026-10-11"), { stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(pressed).toHaveBeenCalledWith("2026-10-11");
});
it("pages dense foreign details instead of mounting every entry", async () => {
  const row = sharedCalendarDays([cache], "Europe/Berlin").get("2026-10-11")![0];
  const rows = Array.from({ length: 60 }, (_, i) => ({
    ...row,
    entry: { ...row.entry, id: `id${i}`, title: `Dienst ${i}` },
  }));
  const screen = await render(
    <SharedCalendarDaySheet date="2026-10-11" entries={rows} onClose={() => {}} />,
  );
  expect(screen.getByText("Dienst 24")).toBeTruthy();
  expect(screen.queryByText("Dienst 25")).toBeNull();
  await fireEvent.press(screen.getByText("Weitere Einträge"));
  expect(screen.getByText("Dienst 25")).toBeTruthy();
  expect(screen.queryByText("Dienst 0")).toBeNull();
});
