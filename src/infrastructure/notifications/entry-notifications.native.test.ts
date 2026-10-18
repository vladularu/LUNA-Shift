import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";

import type { Appointment, CalendarEntry, EntryNotification, ShiftEntry } from "@/domain/types";
import { reconcileLoadedEntryNotifications } from "@/application/pflegeshift-notifications";
import {
  cancelAllEntryNotifications,
  cancelEntryNotifications,
  syncEntryNotifications,
} from "@/infrastructure/notifications/entry-notifications.native";

const notificationMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  getPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  setHandler: vi.fn(),
}));
const repositoryMocks = vi.hoisted(() => ({
  listAllIds: vi.fn(),
  listIds: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  cancelScheduledNotificationAsync: notificationMocks.cancel,
  getPermissionsAsync: notificationMocks.getPermissions,
  requestPermissionsAsync: notificationMocks.requestPermissions,
  scheduleNotificationAsync: notificationMocks.schedule,
  setNotificationHandler: notificationMocks.setHandler,
}));

vi.mock("@/infrastructure/notifications/notification-schedule-repository", () => ({
  listAllScheduledNotificationIds: repositoryMocks.listAllIds,
  listScheduledNotificationIds: repositoryMocks.listIds,
  replaceScheduledNotifications: repositoryMocks.replace,
}));

const baseShift: ShiftEntry = {
  kind: "SHIFT",
  id: "shift-alarm",
  date: "2026-08-20",
  templateId: null,
  title: "Spätdienst",
  type: "LATE",
  allDay: false,
  startTime: "13:00",
  endTime: "21:30",
  breakMinutes: 30,
  color: "#F05C68",
  symbol: "S",
  note: null,
  notification: null,
  alarmEnabled: true,
  location: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
  deletedAt: null,
};

const baseAppointment: Appointment = {
  kind: "APPOINTMENT",
  id: "appointment-reminder",
  date: "2026-08-20",
  title: "Termin",
  allDay: false,
  startTime: "13:00",
  endTime: "21:30",
  color: "#F05C68",
  note: null,
  recurrence: null,
  notification: null,
  location: null,
  revision: 1,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
  deletedAt: null,
};

function overnightEntry(kind: CalendarEntry["kind"]): CalendarEntry {
  const times = {
    date: "2026-10-20",
    startTime: "22:00",
    endTime: "06:00",
    notification: {
      amount: 0,
      unit: "MINUTE",
      direction: "BEFORE",
      reference: "END",
    } as const,
  };
  return kind === "SHIFT"
    ? { ...baseShift, ...times, alarmEnabled: false }
    : { ...baseAppointment, ...times };
}

describe("entry alarms", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T08:00:00.000Z"));
    repositoryMocks.listAllIds.mockResolvedValue([]);
    repositoryMocks.listIds.mockResolvedValue([]);
    repositoryMocks.replace.mockResolvedValue(undefined);
    notificationMocks.getPermissions.mockResolvedValue({ granted: true });
    let nextNotificationId = 0;
    notificationMocks.schedule.mockImplementation(
      async () => `notification-${++nextNotificationId}`,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cancels every registered entry notification before a restore", async () => {
    repositoryMocks.listAllIds.mockResolvedValue(["notification-2", "notification-1"]);

    await cancelAllEntryNotifications({} as SQLiteDatabase);

    expect(notificationMocks.cancel).toHaveBeenCalledTimes(2);
    expect(notificationMocks.cancel).toHaveBeenNthCalledWith(1, "notification-2");
    expect(notificationMocks.cancel).toHaveBeenNthCalledWith(2, "notification-1");
    expect(repositoryMocks.replace).not.toHaveBeenCalled();
  });

  it("schedules an audible alarm independently from an earlier notification", async () => {
    await syncEntryNotifications(
      {} as SQLiteDatabase,
      {
        ...baseShift,
        notification: {
          amount: 15,
          unit: "MINUTE",
          direction: "BEFORE",
          reference: "START",
        },
      },
      "Europe/Berlin",
    );

    expect(notificationMocks.schedule).toHaveBeenCalledTimes(2);
    expect(notificationMocks.schedule.mock.calls[0]?.[0].content).toMatchObject({
      title: "LUNA Shift",
      body: "Erinnerung: Dienstbeginn",
      sound: undefined,
      data: { reminderKind: "NOTIFICATION" },
    });
    expect(notificationMocks.schedule.mock.calls[1]?.[0].content).toMatchObject({
      title: "LUNA Shift",
      body: "Erinnerung: Dienstbeginn",
      sound: "default",
      data: { reminderKind: "ALARM" },
    });
    expect(JSON.stringify(notificationMocks.schedule.mock.calls)).not.toContain(baseShift.title);
    expect(notificationMocks.schedule.mock.calls[0]?.[0].content.data).toEqual({
      reminderKind: "NOTIFICATION",
    });
  });

  it("deduplicates a notification that already occurs at shift start", async () => {
    await syncEntryNotifications(
      {} as SQLiteDatabase,
      {
        ...baseShift,
        notification: {
          amount: 0,
          unit: "MINUTE",
          direction: "BEFORE",
          reference: "START",
        },
      },
      "Europe/Berlin",
    );

    expect(notificationMocks.schedule).toHaveBeenCalledTimes(1);
    expect(notificationMocks.schedule.mock.calls[0]?.[0].content).toMatchObject({
      body: "Erinnerung: Dienstbeginn",
      sound: "default",
      data: { reminderKind: "ALARM" },
    });
  });

  it.each([
    ["SHIFT", false, "START", "Erinnerung: Dienstbeginn"],
    ["SHIFT", false, "END", "Erinnerung: Dienstende"],
    ["APPOINTMENT", false, "START", "Erinnerung: Terminbeginn"],
    ["APPOINTMENT", false, "END", "Erinnerung: Terminende"],
    ["SHIFT", true, "START", "Erinnerung: Dienst"],
    ["SHIFT", true, "END", "Erinnerung: Dienst"],
    ["APPOINTMENT", true, "START", "Erinnerung: Termin"],
    ["APPOINTMENT", true, "END", "Erinnerung: Termin"],
  ] as const)(
    "schedules only neutral %s content for allDay=%s and reference=%s",
    async (kind, allDay, reference, body) => {
      const notification: EntryNotification = {
        amount: 0,
        unit: "MINUTE",
        direction: "BEFORE",
        reference,
      };
      const privateFields = {
        title: "PRIVATE_TITLE_SENTINEL",
        note: "PRIVATE_NOTE_SENTINEL",
        location: {
          name: "PRIVATE_LOCATION_SENTINEL",
          address: "PRIVATE_ADDRESS_SENTINEL",
          latitude: 52.123456,
          longitude: 13.654321,
        },
        allDay,
        startTime: allDay ? null : "13:00",
        endTime: allDay ? null : "21:30",
        notification,
      };
      const entry: CalendarEntry =
        kind === "SHIFT"
          ? { ...baseShift, ...privateFields, alarmEnabled: false }
          : { ...baseAppointment, ...privateFields };
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await syncEntryNotifications({} as SQLiteDatabase, entry, "Europe/Berlin");

      expect(notificationMocks.schedule).toHaveBeenCalledTimes(1);
      const request = notificationMocks.schedule.mock.calls[0]?.[0];
      expect(request).toEqual({
        content: {
          title: "LUNA Shift",
          body,
          sound: undefined,
          data: { reminderKind: "NOTIFICATION" },
        },
        trigger: { type: "date", date: expect.any(Date) },
      });
      const serialized = JSON.stringify(request);
      for (const value of [
        privateFields.title,
        privateFields.note,
        privateFields.location.name,
        privateFields.location.address,
        String(privateFields.location.latitude),
        String(privateFields.location.longitude),
        entry.id,
      ])
        expect(serialized).not.toContain(value);
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    },
  );

  it.each([
    [0, "BEFORE", "START", "2026-08-20T11:00:00.000Z", "Erinnerung: Dienstbeginn"],
    [0, "AFTER", "END", "2026-08-20T19:30:00.000Z", "Erinnerung: Dienstende"],
    [15, "BEFORE", "START", "2026-08-20T10:45:00.000Z", "Erinnerung: Dienstbeginn"],
    [15, "AFTER", "END", "2026-08-20T19:45:00.000Z", "Erinnerung: Dienstende"],
  ] as const)(
    "preserves the planned instant for %s minutes %s %s without a delivery-time claim",
    async (amount, direction, reference, instant, body) => {
      await syncEntryNotifications(
        {} as SQLiteDatabase,
        {
          ...baseShift,
          alarmEnabled: false,
          notification: { amount, unit: "MINUTE", direction, reference },
        },
        "Europe/Berlin",
      );

      expect(notificationMocks.schedule).toHaveBeenCalledTimes(1);
      expect(notificationMocks.schedule.mock.calls[0]?.[0]).toEqual({
        content: {
          title: "LUNA Shift",
          body,
          sound: undefined,
          data: { reminderKind: "NOTIFICATION" },
        },
        trigger: { type: "date", date: new Date(instant) },
      });
    },
  );

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "anchors %s overnight end reminders to the following calendar day",
    async (kind) => {
      for (const [amount, direction, reference, instant] of [
        [0, "BEFORE", "START", "2026-10-20T20:00:00.000Z"],
        [0, "BEFORE", "END", "2026-10-21T04:00:00.000Z"],
        [15, "BEFORE", "END", "2026-10-21T03:45:00.000Z"],
        [15, "AFTER", "END", "2026-10-21T04:15:00.000Z"],
      ] as const) {
        await syncEntryNotifications(
          {} as SQLiteDatabase,
          {
            ...overnightEntry(kind),
            notification: { amount, unit: "MINUTE", direction, reference },
          },
          "Europe/Berlin",
        );
        expect(notificationMocks.schedule.mock.calls.at(-1)?.[0].trigger.date).toEqual(
          new Date(instant),
        );
      }
    },
  );

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "retains the existing next-day bounds for legacy equal-clock %s entries",
    async (kind) => {
      await syncEntryNotifications(
        {} as SQLiteDatabase,
        { ...overnightEntry(kind), startTime: "08:00", endTime: "08:00" },
        "Europe/Berlin",
      );
      expect(notificationMocks.schedule.mock.calls[0]?.[0].trigger.date).toEqual(
        new Date("2026-10-21T06:00:00.000Z"),
      );
    },
  );

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "resolves %s overnight ends by local calendar dates across both DST changes",
    async (kind) => {
      for (const [date, instant] of [
        ["2026-10-24", "2026-10-25T05:00:00.000Z"],
        ["2027-03-27", "2027-03-28T04:00:00.000Z"],
      ]) {
        await syncEntryNotifications(
          {} as SQLiteDatabase,
          { ...overnightEntry(kind), date },
          "Europe/Berlin",
        );
        expect(notificationMocks.schedule.mock.calls.at(-1)?.[0].trigger.date).toEqual(
          new Date(instant),
        );
      }
    },
  );

  it.each(["SHIFT", "APPOINTMENT"] as const)(
    "reconciles a still-running %s after midnight without rearming past start alarms",
    async (kind) => {
      vi.setSystemTime(new Date("2026-10-20T22:30:00.000Z"));
      const entry = overnightEntry(kind);
      const source = entry.kind === "SHIFT" ? { ...entry, alarmEnabled: true } : entry;
      const record = vi.fn();
      const failed = await reconcileLoadedEntryNotifications([source], "Europe/Berlin", {
        notifications: {
          syncEntry: (item, timeZone) =>
            syncEntryNotifications({} as SQLiteDatabase, item, timeZone),
        },
        diagnostics: { record },
      });

      expect(failed).toBe(false);
      expect(record).not.toHaveBeenCalled();
      expect(notificationMocks.schedule).toHaveBeenCalledTimes(1);
      expect(notificationMocks.schedule.mock.calls[0]?.[0]).toMatchObject({
        content: { data: { reminderKind: "NOTIFICATION" } },
        trigger: { date: new Date("2026-10-21T04:00:00.000Z") },
      });
      expect(repositoryMocks.replace.mock.calls.at(-1)?.[2]).toEqual([
        { occurrenceDate: "2026-10-20", notificationId: "notification-1" },
      ]);
    },
  );

  it.each([
    ["2026-10-20T22:30:00.000Z", "2026-10-20", "2026-10-21T04:00:00.000Z"],
    ["2026-10-21T10:00:00.000Z", "2026-10-21", "2026-10-22T04:00:00.000Z"],
  ])(
    "keeps recurring overnight reminders future-only and bounded at %s",
    async (now, firstOccurrence, firstInstant) => {
      vi.setSystemTime(new Date(now));
      await syncEntryNotifications(
        {} as SQLiteDatabase,
        {
          ...baseAppointment,
          ...overnightEntry("APPOINTMENT"),
          kind: "APPOINTMENT",
          recurrence: { frequency: "DAY", interval: 1 },
        },
        "Europe/Berlin",
      );

      expect(notificationMocks.schedule).toHaveBeenCalledTimes(48);
      const requests = notificationMocks.schedule.mock.calls.map(([request]) => request);
      expect(requests[0].trigger.date).toEqual(new Date(firstInstant));
      expect(requests.every((request) => request.trigger.date.getTime() > Date.now())).toBe(true);
      expect(repositoryMocks.replace.mock.calls.at(-1)?.[2][0].occurrenceDate).toBe(
        firstOccurrence,
      );
      expect(new Set(requests.map((request) => request.trigger.date.toISOString())).size).toBe(48);
    },
  );

  it.each([
    ["SHIFT", "START"],
    ["SHIFT", "END"],
    ["APPOINTMENT", "START"],
    ["APPOINTMENT", "END"],
  ] as const)("preserves the all-day midnight anchor for %s %s", async (kind, reference) => {
    await syncEntryNotifications(
      {} as SQLiteDatabase,
      {
        ...overnightEntry(kind),
        allDay: true,
        startTime: null,
        endTime: null,
        notification: { amount: 0, unit: "MINUTE", direction: "BEFORE", reference },
      },
      "Europe/Berlin",
    );
    expect(notificationMocks.schedule.mock.calls[0]?.[0].trigger.date).toEqual(
      new Date("2026-10-19T22:00:00.000Z"),
    );
  });

  it("replaces a changed reminder and then cancels it without retaining duplicate registrations", async () => {
    let registeredIds: string[] = [];
    repositoryMocks.listIds.mockImplementation(async () => [...registeredIds]);
    repositoryMocks.replace.mockImplementation(async (_db, _entry, schedules) => {
      registeredIds = schedules.map(
        (schedule: { notificationId: string }) => schedule.notificationId,
      );
    });
    const entry = {
      ...baseShift,
      alarmEnabled: false,
      notification: { amount: 0, unit: "MINUTE", direction: "BEFORE", reference: "START" },
    } as const;
    await syncEntryNotifications({} as SQLiteDatabase, entry, "Europe/Berlin");
    expect(registeredIds).toEqual(["notification-1"]);
    await syncEntryNotifications(
      {} as SQLiteDatabase,
      { ...entry, notification: { ...entry.notification, reference: "END" } },
      "Europe/Berlin",
    );
    expect(notificationMocks.cancel).toHaveBeenCalledWith("notification-1");
    expect(registeredIds).toEqual(["notification-2"]);
    expect(notificationMocks.schedule).toHaveBeenCalledTimes(2);
    await cancelEntryNotifications({} as SQLiteDatabase, entry);
    expect(notificationMocks.cancel).toHaveBeenLastCalledWith("notification-2");
    expect(registeredIds).toEqual([]);
  });

  it.each(["disabled", "deleted"] as const)(
    "cancels existing schedules for a %s reminder without scheduling another",
    async (mode) => {
      repositoryMocks.listIds.mockResolvedValue(["old-notification"]);
      await syncEntryNotifications(
        {} as SQLiteDatabase,
        {
          ...baseShift,
          alarmEnabled: false,
          notification:
            mode === "disabled"
              ? null
              : { amount: 0, unit: "MINUTE", direction: "BEFORE", reference: "START" },
          deletedAt: mode === "deleted" ? "2026-08-01T08:00:00Z" : null,
        },
        "Europe/Berlin",
      );
      expect(notificationMocks.cancel).toHaveBeenCalledExactlyOnceWith("old-notification");
      expect(notificationMocks.schedule).not.toHaveBeenCalled();
      expect(repositoryMocks.replace).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        [],
      );
    },
  );

  it("does not schedule when permission stays denied", async () => {
    notificationMocks.getPermissions.mockResolvedValue({ granted: false });
    notificationMocks.requestPermissions.mockResolvedValue({ granted: false });
    await syncEntryNotifications({} as SQLiteDatabase, baseShift, "Europe/Berlin");
    expect(notificationMocks.requestPermissions).toHaveBeenCalledTimes(1);
    expect(notificationMocks.schedule).not.toHaveBeenCalled();
  });

  it("keeps a legacy shift without allDay timed and its request free of private data", async () => {
    const { allDay, ...legacyShift } = baseShift;
    expect(allDay).toBe(false);
    const entry: ShiftEntry = {
      ...legacyShift,
      alarmEnabled: false,
      title: "PRIVATE_TITLE_SENTINEL",
      note: "PRIVATE_NOTE_SENTINEL",
      location: { name: "PRIVATE_LOCATION_SENTINEL" },
      notification: { amount: 15, unit: "MINUTE", direction: "BEFORE", reference: "START" },
    };
    expect(entry).not.toHaveProperty("allDay");

    await syncEntryNotifications({} as SQLiteDatabase, entry, "Europe/Berlin");

    expect(notificationMocks.schedule).toHaveBeenCalledExactlyOnceWith({
      content: {
        title: "LUNA Shift",
        body: "Erinnerung: Dienstbeginn",
        sound: undefined,
        data: { reminderKind: "NOTIFICATION" },
      },
      trigger: { type: "date", date: new Date("2026-08-20T10:45:00.000Z") },
    });
  });

  it("preserves the existing compatible START instant in the spring clock gap", async () => {
    vi.setSystemTime(new Date("2026-03-01T08:00:00.000Z"));
    for (const kind of ["SHIFT", "APPOINTMENT"] as const) {
      await syncEntryNotifications(
        {} as SQLiteDatabase,
        {
          ...overnightEntry(kind),
          date: "2026-03-29",
          startTime: "02:30",
          endTime: "04:00",
          notification: { amount: 0, unit: "MINUTE", direction: "BEFORE", reference: "START" },
        },
        "Europe/Berlin",
      );
      expect(notificationMocks.schedule.mock.calls.at(-1)?.[0].trigger.date).toEqual(
        new Date("2026-03-29T01:30:00.000Z"),
      );
    }
  });

  it("preserves the existing first-fold instant for a same-day END in autumn", async () => {
    for (const kind of ["SHIFT", "APPOINTMENT"] as const) {
      await syncEntryNotifications(
        {} as SQLiteDatabase,
        {
          ...overnightEntry(kind),
          date: "2026-10-25",
          startTime: "00:30",
          endTime: "02:30",
        },
        "Europe/Berlin",
      );
      expect(notificationMocks.schedule.mock.calls.at(-1)?.[0].trigger.date).toEqual(
        new Date("2026-10-25T00:30:00.000Z"),
      );
    }
  });

  it("keeps successful registrations after a later scheduling failure without logging entry content", async () => {
    notificationMocks.schedule
      .mockResolvedValueOnce("first-reminder")
      .mockRejectedValueOnce(new Error("scheduler unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      syncEntryNotifications(
        {} as SQLiteDatabase,
        {
          ...baseShift,
          title: "PRIVATE_TITLE_SENTINEL",
          note: "PRIVATE_NOTE_SENTINEL",
          notification: { amount: 15, unit: "MINUTE", direction: "BEFORE", reference: "START" },
        },
        "Europe/Berlin",
      ),
    ).rejects.toThrow("scheduler unavailable");
    expect(repositoryMocks.replace).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), [
      { occurrenceDate: "2026-08-20", notificationId: "first-reminder" },
    ]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
