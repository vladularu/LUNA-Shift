import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { PflegeShiftPorts } from "@/application/pflegeshift-ports";
import { SharedCalendarsContext } from "@/application/shared-calendars-context";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import { CalendarWidgetSync } from "./calendar-widget-sync";
import { calendarWidgetsAvailable, publishCalendarWidgetTimeline } from "./native-calendar-widget";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import type { CalendarEntry, CalendarHolidayColor } from "@/domain/types";
import { work } from "@/engine/remuneration-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { calendarChipPalette } from "@/theme/color-contrast";

let mockStatus = { ready: true, error: null as string | null };
let mockProfile: { timeZone: string } | null = { timeZone: "Europe/Berlin" };
let mockCalculationProfile: ReturnType<typeof createWorkingTimeCalculationProfile> | null = null;
const mockResolver = bundledRuleResolver;
let mockEntries: object[] = [];
let mockDisplay = {
  ready: true,
  labelMode: "FULL",
  showShiftTimes: true,
  showShiftDuration: false,
  showShifts: true,
  showAppointments: true,
  pastelColors: false,
  showHolidays: false,
  holidayColor: "ORANGE" as CalendarHolidayColor,
};
let mockBackground = { ready: true, uri: null as string | null, strength: "medium" };
let mockAppearance = { ready: true, mode: "system" };
const mockPrepareBackground = jest.fn<(_uri: string | null) => Promise<string | null>>();
const mockPruneBackground = jest.fn();
jest.mock("@/features/calendar/calendar-preferences", () => ({
  useCalendarPreferences: () => mockDisplay,
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockResolver }),
}));
jest.mock("@/features/settings/calendar-background-context", () => ({
  useCalendarBackground: () => mockBackground,
}));
jest.mock("@/features/settings/appearance-preferences", () => ({
  useAppearancePreferences: () => mockAppearance,
}));
jest.mock("./calendar-widget-background", () => ({
  prepareCalendarWidgetBackground: (uri: string | null) => mockPrepareBackground(uri),
  pruneCalendarWidgetBackgrounds: (keep: string | null) => mockPruneBackground(keep),
}));
const mockTemplates: object[] = [];
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => mockStatus,
  usePflegeShiftProfile: () => ({
    profile: mockProfile,
    calculationProfile: mockCalculationProfile,
  }),
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftTemplates: () => ({ templates: mockTemplates }),
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { scheme: "pflegeshift-internal" } },
}));
jest.mock("./native-calendar-widget", () => ({
  calendarWidgetsAvailable: jest.fn(() => true),
  publishCalendarWidgetTimeline: jest.fn(),
}));
const publish = jest.mocked(publishCalendarWidgetTimeline);
const available = jest.mocked(calendarWidgetsAvailable);

type LoadEntries = (start: string, end: string) => Promise<readonly CalendarEntry[]>;
function ports(load = jest.fn<LoadEntries>().mockResolvedValue([])) {
  const record = jest.fn();
  return {
    value: {
      repository: { listCalendarEntries: load },
      diagnostics: { record },
    } as unknown as PflegeShiftPorts,
    load,
    record,
  };
}

beforeEach(() => {
  startupPresentation.complete();
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-12-31T12:00:00Z"));
  jest.clearAllMocks();
  available.mockReturnValue(true);
  mockStatus = { ready: true, error: null };
  mockProfile = { timeZone: "Europe/Berlin" };
  mockCalculationProfile = null;
  mockEntries = [];
  mockDisplay = {
    ready: true,
    labelMode: "FULL",
    showShiftTimes: true,
    showShiftDuration: false,
    showShifts: true,
    showAppointments: true,
    pastelColors: false,
    showHolidays: false,
    holidayColor: "ORANGE",
  };
  mockBackground = { ready: true, uri: null, strength: "medium" };
  mockAppearance = { ready: true, mode: "system" };
  mockPrepareBackground.mockResolvedValue(null);
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
});
it("defers the initial widget read until presentation and cancels superseded startup work", async () => {
  startupPresentation.begin();
  const first = ports();
  const latest = ports();
  const screen = await render(<CalendarWidgetSync ports={first.value} />);
  expect(first.load).not.toHaveBeenCalled();
  await screen.rerender(<CalendarWidgetSync ports={latest.value} />);
  await act(async () => {
    startupPresentation.complete();
  });
  expect(first.load).not.toHaveBeenCalled();
  expect(latest.load).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
  await screen.unmount();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("loads today's range independently and refreshes after data changes", async () => {
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(p.load).toHaveBeenCalledWith("2026-11-30", "2027-02-07");
  expect(publish).toHaveBeenCalledTimes(1);
  mockEntries = [{}];
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(publish).toHaveBeenCalledTimes(2);
  await screen.unmount();
});

it("publishes visible shared shifts and removes them after account data is cleared", async () => {
  const shared: CachedSharedCalendar = {
    accountId: "reader",
    visible: true,
    fetchedAt: "2026-12-31T12:00:00Z",
    calendar: {
      id: "shared-plan",
      ownerId: "other",
      name: "Loni",
      color: "#0088CC",
      visibility: "DETAILS",
      revision: 1,
      isOwner: false,
      publishedAt: "2026-12-31T12:00:00Z",
    },
    entries: [
      {
        id: "shared-night",
        title: "Nacht",
        color: "#CCAA33",
        symbol: "moon",
        startsAt: "2026-12-31T20:00:00Z",
        endsAt: "2027-01-01T06:00:00Z",
        allDay: false,
        timeZone: "Europe/Berlin",
      },
    ],
  };
  const p = ports();
  const screen = await render(
    <SharedCalendarsContext value={[shared]}>
      <CalendarWidgetSync ports={p.value} />
    </SharedCalendarsContext>,
  );
  await act(async () => {});
  expect(publish.mock.calls.at(-1)?.[0][0].props.days[0].shifts).toEqual([
    expect.objectContaining({ ownerName: "Loni", color: "#CCAA33", ownerColor: "#0088CC" }),
  ]);
  await screen.rerender(
    <SharedCalendarsContext value={[]}>
      <CalendarWidgetSync ports={p.value} />
    </SharedCalendarsContext>,
  );
  await act(async () => {});
  expect(publish.mock.calls.at(-1)?.[0][0].props.days.flatMap((day) => day.shifts)).toEqual([]);
  await screen.unmount();
});

it("discards an older pending result after a new calendar revision", async () => {
  let resolveOld!: (entries: readonly never[]) => void;
  const old = new Promise<readonly never[]>((resolve) => {
    resolveOld = resolve;
  });
  const p = ports(jest.fn<LoadEntries>().mockReturnValueOnce(old).mockResolvedValue([]));
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  mockEntries = [{}];
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(publish).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveOld([]);
  });
  expect(publish).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

it("refreshes at midnight and when the app returns, then removes subscriptions", async () => {
  let foreground!: (state: "active") => void;
  const remove = jest.fn();
  const listener = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_type, callback) => {
      foreground = callback;
      return { remove };
    });
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  await act(async () => {
    jest.advanceTimersByTime(11 * 3600000 + 100);
  });
  expect(p.load).toHaveBeenLastCalledWith("2026-12-28", "2027-02-07");
  await act(async () => {
    foreground("active");
  });
  expect(publish).toHaveBeenCalledTimes(3);
  const clearTimer = jest.spyOn(globalThis, "clearTimeout");
  clearTimer.mockClear();
  await screen.unmount();
  expect(remove).toHaveBeenCalled();
  expect(clearTimer).toHaveBeenCalledTimes(1);
  clearTimer.mockRestore();
  listener.mockRestore();
});

it("publishes an empty setup state when the profile is removed", async () => {
  const p = ports();
  mockProfile = null;
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(p.load).not.toHaveBeenCalled();
  expect(publish.mock.calls[0][0][0].props.state).toBe("setup");
  await screen.unmount();
});

it("keeps native failures out of the calendar and reports a diagnostic", async () => {
  const p = ports(jest.fn<LoadEntries>().mockRejectedValue(new Error("db")));
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(publish).not.toHaveBeenCalled();
  expect(p.record).toHaveBeenCalledWith(
    "provider",
    "CALENDAR_WIDGET_SYNC_FAILED",
    expect.any(Error),
  );
  await screen.unmount();
});

it("does no queries or subscriptions on unsupported platforms or while loading", async () => {
  const p = ports();
  available.mockReturnValue(false);
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  expect(p.load).not.toHaveBeenCalled();
  await screen.unmount();
  available.mockReturnValue(true);
  mockStatus.ready = false;
  const loading = await render(<CalendarWidgetSync ports={p.value} />);
  expect(p.load).not.toHaveBeenCalled();
  await loading.unmount();
});

it("republishes when photo, visibility or appearance changes", async () => {
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  mockBackground = {
    ready: true,
    uri: "file:///app/calendar-backgrounds/calendar-one.jpg",
    strength: "strong",
  };
  mockAppearance = { ready: true, mode: "light" };
  mockPrepareBackground.mockResolvedValue("luna-widget-calendar-one.jpg");
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(publish.mock.calls.at(-1)?.[0][0].props).toMatchObject({
    backgroundFileName: "luna-widget-calendar-one.jpg",
    backgroundOpacity: 0.6,
    themeMode: "light",
  });
  expect(mockPruneBackground).toHaveBeenLastCalledWith("luna-widget-calendar-one.jpg");
  mockBackground = { ready: true, uri: null, strength: "medium" };
  mockPrepareBackground.mockResolvedValue(null);
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(publish.mock.calls.at(-1)?.[0][0].props.backgroundFileName).toBeNull();
  expect(mockPruneBackground).toHaveBeenLastCalledWith(null);
  await screen.unmount();
});
it("keeps a rapid photo change from publishing a stale image", async () => {
  let resolveOld!: (value: string | null) => void;
  mockPrepareBackground
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    )
    .mockResolvedValue("luna-widget-calendar-two.jpg");
  mockBackground = {
    ready: true,
    uri: "file:///app/calendar-backgrounds/calendar-one.jpg",
    strength: "medium",
  };
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  mockBackground = { ...mockBackground, uri: "file:///app/calendar-backgrounds/calendar-two.jpg" };
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {
    resolveOld("luna-widget-calendar-one.jpg");
  });
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0][0].props.backgroundFileName).toBe("luna-widget-calendar-two.jpg");
  expect(mockPruneBackground).toHaveBeenCalledTimes(1);
  expect(mockPruneBackground).toHaveBeenCalledWith("luna-widget-calendar-two.jpg");
  await screen.unmount();
});
it("falls back to the calendar palette when the selected photo cannot be prepared", async () => {
  mockPrepareBackground.mockRejectedValue(new Error("photo unavailable"));
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0][0].props.backgroundFileName).toBeNull();
  expect(p.record).toHaveBeenCalledWith(
    "provider",
    "CALENDAR_WIDGET_BACKGROUND_FAILED",
    expect.any(Error),
  );
  await screen.unmount();
});
it("waits for the persisted display and background before replacing a widget", async () => {
  mockBackground.ready = false;
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  expect(p.load).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  await screen.unmount();
});

it("refreshes pastel, appointment visibility and holiday colors independently", async () => {
  mockCalculationProfile = createWorkingTimeCalculationProfile(
    { ...work, federalState: "HE" },
    null,
    [],
  );
  const shift: CalendarEntry = {
    kind: "SHIFT",
    id: "own",
    date: "2026-12-31",
    title: "Früh",
    color: "#FF526D",
    symbol: "sun",
    type: "EARLY",
    templateId: null,
    startTime: "06:00",
    endTime: "14:00",
    breakMinutes: 0,
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
  const appointment: CalendarEntry = {
    kind: "APPOINTMENT",
    id: "appt",
    date: "2026-12-31",
    title: "Kontrolle",
    allDay: true,
    startTime: null,
    endTime: null,
    color: "#FFFFFF",
    note: "PRIVATE",
    revision: 1,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
  const p = ports(jest.fn<LoadEntries>().mockResolvedValue([shift, appointment]));
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  const first = () => publish.mock.calls.at(-1)![0][0].props;
  expect(first().days[0].appointments).toHaveLength(1);
  let count = publish.mock.calls.length;
  for (const patch of [
    { pastelColors: true },
    { showAppointments: false },
    { showHolidays: true },
    { holidayColor: "BLUE" as const },
  ]) {
    mockDisplay = { ...mockDisplay, ...patch };
    await screen.rerender(<CalendarWidgetSync ports={p.value} />);
    await act(async () => {});
    expect(publish).toHaveBeenCalledTimes(++count);
  }
  expect(first().pastelColors).toBe(true);
  expect(first().days[0].shifts[0].light).toEqual(calendarChipPalette(shift.color, false, true));
  expect(first().days[0].appointments).toEqual([]);
  expect(first().days[0].dayLabel).toBe("Silvester (tariflicher Sondertag)");
  expect(first().days[0].tint?.light).toBe("#3B82D040");
  mockDisplay = { ...mockDisplay, showHolidays: false, showAppointments: true };
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(first().days[0].dayLabel).toBeUndefined();
  expect(first().days[0].appointments).toHaveLength(1);
  expect(JSON.stringify(first())).not.toContain("PRIVATE");
  await screen.unmount();
});
