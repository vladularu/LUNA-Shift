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
      breakMinutes: 60,
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
it("keeps a shared appointment compact while preserving its calendar stripe", async () => {
  const row = sharedCalendarDays([cache], "Europe/Berlin", null).get("2026-10-11")![0];
  const screen = await render(
    <SharedCalendarEntryContent
      row={{ ...row, entry: { ...row.entry, kind: "APPOINTMENT", title: "Ohne Titel" } }}
      display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: true }}
      lineHeight={15}
    />,
  );
  expect(screen.getByText("Ohne Titel").parent).toHaveStyle({ height: 15 });
  expect(screen.getByTestId("shared-calendar-entry-cal-entry")).toHaveStyle({
    borderLeftColor: cache.calendar.color,
  });
  expect(screen.queryByText("21:00 · 9:30 h")).toBeNull();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
it.each<[boolean, boolean, string | null]>([
  [true, false, "21:00"],
  [false, true, "9:30 h"],
  [true, true, "21:00 · 9:30 h"],
  [false, false, null],
])(
  "applies time=%s and duration=%s without a separate sharing setting",
  async (showShiftTimes, showShiftDuration, detail) => {
    const row = sharedCalendarDays([cache], "Europe/Berlin", null).get("2026-10-11")![0];
    const screen = await render(
      <SharedCalendarEntryContent
        row={row}
        display={{ labelMode: "FULL", showShiftTimes, showShiftDuration }}
        lineHeight={15}
      />,
    );
    if (detail) expect(screen.getByText(detail)).toBeTruthy();
    else expect(screen.queryAllByText(/21:00|9:30/)).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  },
);

function ProjectionProbe({
  items,
  onMap,
}: {
  items: readonly CachedSharedCalendar[];
  onMap: (map: ReturnType<typeof sharedCalendarDays>) => void;
}) {
  return (
    <SharedCalendarsContext value={items}>
      <ProjectionBody onMap={onMap} />
    </SharedCalendarsContext>
  );
}
function ProjectionBody({
  onMap,
}: {
  onMap: (map: ReturnType<typeof sharedCalendarDays>) => void;
}) {
  const { sharedEntriesByDate } = useSharedCalendarDays("Europe/Berlin", "2026-10");
  onMap(sharedEntriesByDate);
  return <Text>{[...sharedEntriesByDate.keys()].join(",")}</Text>;
}
it("prepares outer month pages and their adjacent days, retaining rows on freshness-only updates", async () => {
  const dates = ["2026-07-31", "2026-08-01", "2026-12-01", "2027-01-01"];
  const expanded = {
    ...cache,
    entries: dates.map((date, index) => ({
      ...cache.entries[0],
      id: String(index),
      startsAt: date + "T06:00:00Z",
      endsAt: date + "T14:00:00Z",
    })),
  };
  let map: ReturnType<typeof sharedCalendarDays> = new Map();
  const view = await render(
    <ProjectionProbe
      items={[expanded]}
      onMap={(value) => {
        map = value;
      }}
    />,
  );
  for (const date of dates) expect(map.has(date)).toBe(true);
  const old = map;
  await view.rerender(
    <ProjectionProbe
      items={[{ ...expanded, fetchedAt: "2026-10-12T11:00:00Z" }]}
      onMap={(value) => {
        map = value;
      }}
    />,
  );
  expect(map).toBe(old);
  await view.rerender(
    <ProjectionProbe
      items={[]}
      onMap={(value) => {
        map = value;
      }}
    />,
  );
  expect(map.size).toBe(0);
});
