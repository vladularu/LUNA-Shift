import { render } from "@testing-library/react-native";
import { it, expect } from "@jest/globals";
import { Text, View } from "react-native";
import { SharedCalendarsContext } from "@/application/shared-calendars-context";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import { useSharedCalendarDays } from "./use-shared-calendar-days";
import { SharedCalendarEntryContent } from "./shared-calendar-entry-content";
import { sharedCalendarDays } from "./shared-calendar-display";
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

function Screen() {
  const { sharedEntriesByDate } = useSharedCalendarDays("Europe/Berlin", "2026-10");
  return (
    <View>
      <Text>Oktober 2026</Text>
      {(sharedEntriesByDate.get("2026-10-11") ?? []).map((row) => (
        <Text key={row.entry.id}>{row.entry.title + " · " + row.calendarName}</Text>
      ))}
    </View>
  );
}
function Wrapper({ items }: { items: readonly CachedSharedCalendar[] }) {
  return (
    <SharedCalendarsContext value={items}>
      <Screen />
    </SharedCalendarsContext>
  );
}
it("adds foreign data to the current calendar and removes it after revocation", async () => {
  const screen = await render(<Wrapper items={[cache]} />);
  expect(screen.getByText("Nacht · Alex")).toBeTruthy();
  await screen.rerender(<Wrapper items={[]} />);
  expect(screen.queryByText("Nacht · Alex")).toBeNull();
  expect(screen.getByText("Oktober 2026")).toBeTruthy();
});
it("does not render a separate shared day sheet or editor touch target", async () => {
  const row = sharedCalendarDays([cache], "Europe/Berlin", null).get("2026-10-11")![0];
  const screen = await render(
    <SharedCalendarEntryContent
      row={row}
      display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: false }}
      lineHeight={15}
    />,
  );
  expect(screen.getByText("Nacht")).toBeTruthy();
  expect(screen.getByText("21:00")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
