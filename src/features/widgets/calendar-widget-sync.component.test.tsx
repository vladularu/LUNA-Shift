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
import { calendarWidgetDeferral } from "@/application/calendar-widget-deferral";
import { calendarPerformance } from "@/application/calendar-performance";

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
const originalIdleCallback = globalThis.requestIdleCallback;
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
  globalThis.requestIdleCallback = jest.fn<typeof requestIdleCallback>((callback) => {
    void Promise.resolve().then(() => callback({ didTimeout: false, timeRemaining: () => 50 }));
    return 1;
  });
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
  globalThis.requestIdleCallback = originalIdleCallback;
  calendarPerformance.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("loads today's range independently and refreshes after data changes", async () => {
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(p.load).toHaveBeenCalledWith("2026-11-30", "2027-02-07");
  expect(publish).toHaveBeenCalledTimes(1);
  p.load.mockResolvedValue([
    {
      kind: "APPOINTMENT",
      id: "new",
      date: "2026-12-31",
      title: "Neu",
      allDay: true,
      startTime: null,
      endTime: null,
      color: "#FFFFFF",
      note: null,
      revision: 1,
      createdAt: "",
      updatedAt: "",
      deletedAt: null,
    },
  ]);
  mockEntries = [{}];
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(publish).toHaveBeenCalledTimes(2);
  expect(publish.mock.calls.at(-1)?.[0][0].props.days[0].appointments?.[0].title).toBe("Neu");
  await screen.unmount();
});

it("retains the published widget when a provider reload leaves its actual data unchanged", async () => {
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(publish).toHaveBeenCalledTimes(1);
  mockEntries = [{ id: "a-different-loaded-year" }];
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => {});
  expect(p.load).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

it("discards a preparation paused before a settings change", async () => {
  let resume!: () => void;
  jest.spyOn(globalThis, "requestIdleCallback").mockImplementationOnce((callback) => {
    resume = () => callback({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  });
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  expect(publish).not.toHaveBeenCalled();
  mockAppearance = { ready: true, mode: "dark" };
  await screen.rerender(<CalendarWidgetSync ports={p.value} />);
  await act(async () => resume());
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0][0].props.themeMode).toBe("dark");
  await screen.unmount();
});

it("does not publish a preparation that crossed midnight before it could run", async () => {
  let resume!: () => void;
  jest.spyOn(globalThis, "requestIdleCallback").mockImplementationOnce((callback) => {
    resume = () => callback({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  });
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  expect(publish).not.toHaveBeenCalled();
  jest.setSystemTime(new Date("2027-01-01T01:00:00Z"));
  await act(async () => resume());
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0][0].props.todayDate).toBe("2027-01-01");
  await screen.unmount();
});

it("retries a failed publication rather than remembering it as successful", async () => {
  let foreground!: () => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, callback) => {
    foreground = () => callback("active");
    return { remove: jest.fn() };
  });
  publish.mockImplementationOnce(() => {
    throw new Error("native publish failed");
  });
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  expect(p.record).toHaveBeenCalledWith(
    "provider",
    "CALENDAR_WIDGET_SYNC_FAILED",
    expect.any(Error),
  );
  await act(async () => foreground());
  expect(publish).toHaveBeenCalledTimes(2);
  await screen.unmount();
});

it("replaces a first timeline entry that became future-dated after a clock rollback", async () => {
  let foreground!: () => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, callback) => {
    foreground = () => callback("active");
    return { remove: jest.fn() };
  });
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  jest.setSystemTime(new Date("2026-12-31T11:00:00Z"));
  await act(async () => foreground());
  expect(publish).toHaveBeenCalledTimes(2);
  expect(publish.mock.calls[1][0][0].date.getTime()).toBeLessThanOrEqual(Date.now());
  await screen.unmount();
});

it("coalesces rapid calendar changes until editing ends", async () => {
  const release = calendarWidgetDeferral.begin();
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  try {
    for (const entries of [[{ id: "added" }], [], [{ id: "latest" }]]) {
      mockEntries = entries;
      await screen.rerender(<CalendarWidgetSync ports={p.value} />);
    }
    expect(p.load).not.toHaveBeenCalled();
    expect(mockPrepareBackground).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    await act(async () => release());
    expect(p.load).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  } finally {
    await screen.unmount();
    release();
  }
});

it("records numeric build/publication spans separately from deferred refreshes", async () => {
  calendarPerformance.start(true);
  const release = calendarWidgetDeferral.begin();
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  try {
    const deferred = calendarPerformance
      .report()
      .events.filter((event) => event.kind === "widget-work");
    expect(deferred).toEqual([expect.objectContaining({ values: { phase: 3 } })]);
    await act(async () => release());
    const work = calendarPerformance
      .report()
      .events.filter((event) => event.kind === "widget-work");
    expect(work.map((event) => event.values.phase)).toEqual([3, 1, 2]);
    expect(work[1].values).toMatchObject({ input: 0, duration: expect.any(Number) });
    expect(work[2].values).toMatchObject({ count: 15, duration: expect.any(Number) });
    expect(
      work.every((event) =>
        Object.values(event.values).every((value) => typeof value === "number"),
      ),
    ).toBe(true);
  } finally {
    await screen.unmount();
    release();
  }
});

it("discards a pending pre-edit query and publishes the latest state after release", async () => {
  let resolveOld!: (entries: readonly CalendarEntry[]) => void;
  const old = new Promise<readonly CalendarEntry[]>((resolve) => {
    resolveOld = resolve;
  });
  const p = ports(jest.fn<LoadEntries>().mockReturnValueOnce(old).mockResolvedValue([]));
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  let release!: () => void;
  await act(async () => {
    release = calendarWidgetDeferral.begin();
  });
  try {
    await act(async () => resolveOld([]));
    expect(publish).not.toHaveBeenCalled();
    expect(p.load).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(p.load).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
  } finally {
    await screen.unmount();
    release();
  }
});

it("flushes on background even when the stamping tool remains selected", async () => {
  let background!: () => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, callback) => {
    background = () => callback("background");
    return { remove: jest.fn() };
  });
  const release = calendarWidgetDeferral.begin();
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  try {
    expect(p.load).not.toHaveBeenCalled();
    await act(async () => background());
    expect(p.load).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(calendarWidgetDeferral.getSnapshot()).toBe(true);
  } finally {
    await screen.unmount();
    release();
  }
});

it("does not flush a deferred widget after unmount", async () => {
  const release = calendarWidgetDeferral.begin();
  const p = ports();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  await screen.unmount();
  release();
  expect(p.load).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("does not let a pending background read publish after returning to active editing", async () => {
  let change!: (state: "active" | "background") => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, callback) => {
    change = callback;
    return { remove: jest.fn() };
  });
  let resolveRead!: (entries: readonly CalendarEntry[]) => void;
  const pending = new Promise<readonly CalendarEntry[]>((resolve) => {
    resolveRead = resolve;
  });
  const p = ports(jest.fn<LoadEntries>().mockReturnValueOnce(pending).mockResolvedValue([]));
  const release = calendarWidgetDeferral.begin();
  const screen = await render(<CalendarWidgetSync ports={p.value} />);
  try {
    await act(async () => change("background"));
    expect(p.load).toHaveBeenCalledTimes(1);
    await act(async () => {
      change("active");
      resolveRead([]);
    });
    expect(publish).not.toHaveBeenCalled();
    await act(async () => release());
    expect(p.load).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
  } finally {
    await screen.unmount();
    release();
  }
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
  expect(p.load).toHaveBeenCalledTimes(3);
  expect(publish).toHaveBeenCalledTimes(2);
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
