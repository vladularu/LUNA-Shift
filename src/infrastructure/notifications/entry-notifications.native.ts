import { Temporal } from "@js-temporal/polyfill";
import * as Notifications from "expo-notifications";
import type { SQLiteDatabase } from "expo-sqlite";

import { PRODUCT_NAME } from "@/brand";
import type { CalendarEntry, EntryNotification } from "@/domain/types";
import { expandAppointmentSeries } from "@/engine/recurrence";
import { calculateTimedShiftBounds } from "@/engine/working-time";
import {
  listAllScheduledNotificationIds,
  listScheduledNotificationIds,
  replaceScheduledNotifications,
} from "@/infrastructure/notifications/notification-schedule-repository";

const MAX_PENDING_FOR_ENTRY = 48;

Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldPlaySound: notification.request.content.data?.reminderKind === "ALARM",
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function offsetMinutes(rule: EntryNotification): number {
  const multiplier =
    rule.unit === "MINUTE" ? 1 : rule.unit === "HOUR" ? 60 : rule.unit === "DAY" ? 1_440 : 10_080;
  const direction = rule.direction === "BEFORE" ? -1 : 1;
  return rule.amount * multiplier * direction;
}

function scheduledInstant(
  entry: CalendarEntry,
  occurrenceDate: string,
  rule: EntryNotification,
  timeZone: string,
): Date {
  if (rule.reference === "END" && isOvernight(entry)) {
    const bounds = calculateTimedShiftBounds(
      {
        date: occurrenceDate,
        startTime: entry.startTime,
        endTime: entry.endTime,
        allDay: entry.allDay,
        breakMinutes: 0,
      },
      timeZone,
    );
    if (bounds) return new Date((bounds.endEpochMinutes + offsetMinutes(rule)) * 60_000);
  }
  const localDate = Temporal.PlainDate.from(occurrenceDate);
  const referenceTime = entry.allDay
    ? "00:00"
    : rule.reference === "END"
      ? (entry.endTime ?? entry.startTime ?? "00:00")
      : (entry.startTime ?? "00:00");
  const [hour, minute] = referenceTime.split(":").map(Number);
  const instant = Temporal.ZonedDateTime.from({
    timeZone,
    year: localDate.year,
    month: localDate.month,
    day: localDate.day,
    hour,
    minute,
  }).add({ minutes: offsetMinutes(rule) });
  return new Date(instant.epochMilliseconds);
}

interface ReminderSpec {
  readonly kind: "NOTIFICATION" | "ALARM";
  readonly rule: EntryNotification;
}

function reminderSpecs(entry: CalendarEntry): readonly ReminderSpec[] {
  const specs: ReminderSpec[] = [];
  if (entry.notification) specs.push({ kind: "NOTIFICATION", rule: entry.notification });
  if (entry.kind === "SHIFT" && entry.alarmEnabled && entry.startTime !== null) {
    const alarmRule: EntryNotification = {
      amount: 0,
      unit: "MINUTE",
      direction: "BEFORE",
      reference: "START",
    };
    const notificationIsSameInstant =
      entry.notification?.amount === 0 && entry.notification.reference === "START";
    if (notificationIsSameInstant) specs.length = 0;
    specs.push({ kind: "ALARM", rule: alarmRule });
  }
  return Object.freeze(specs);
}

function reminderBody(
  kind: CalendarEntry["kind"],
  allDay: boolean,
  reference: EntryNotification["reference"],
): string {
  if (allDay) return kind === "SHIFT" ? "Erinnerung: Dienst" : "Erinnerung: Termin";
  if (kind === "SHIFT")
    return reference === "END" ? "Erinnerung: Dienstende" : "Erinnerung: Dienstbeginn";
  return reference === "END" ? "Erinnerung: Terminende" : "Erinnerung: Terminbeginn";
}

function isOvernight(entry: CalendarEntry): boolean {
  return (
    !entry.allDay &&
    entry.startTime !== null &&
    entry.endTime !== null &&
    Temporal.PlainTime.compare(entry.endTime, entry.startTime) <= 0
  );
}

function occurrenceDates(
  entry: CalendarEntry,
  startDate: string,
  endDate: string,
): readonly string[] {
  if (entry.kind === "SHIFT")
    return entry.date >= startDate ? Object.freeze([entry.date]) : Object.freeze([]);
  return Object.freeze(
    expandAppointmentSeries(entry, startDate, endDate)
      .slice(0, MAX_PENDING_FOR_ENTRY)
      .map((occurrence) => occurrence.date),
  );
}

export async function cancelAllEntryNotifications(db: SQLiteDatabase): Promise<void> {
  const ids = await listAllScheduledNotificationIds(db);
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

export async function cancelEntryNotifications(
  db: SQLiteDatabase,
  entry: Pick<CalendarEntry, "id" | "kind">,
): Promise<void> {
  const ids = await listScheduledNotificationIds(db, entry);
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  await replaceScheduledNotifications(db, entry, []);
}

export async function syncEntryNotifications(
  db: SQLiteDatabase,
  entry: CalendarEntry,
  timeZone: string,
): Promise<void> {
  await cancelEntryNotifications(db, entry);
  const specs = reminderSpecs(entry);
  if (specs.length === 0 || entry.deletedAt !== null) return;

  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return;

  const now = Temporal.Now.zonedDateTimeISO(timeZone);
  const today = now.toPlainDate().toString();
  const yesterday = now.toPlainDate().subtract({ days: 1 }).toString();
  const startDate =
    isOvernight(entry) &&
    specs.some(
      (spec) =>
        scheduledInstant(entry, yesterday, spec.rule, timeZone).getTime() > now.epochMilliseconds,
    )
      ? yesterday
      : today;
  const endDate = now.add({ years: 2 }).toPlainDate().toString();
  const schedules: { occurrenceDate: string; notificationId: string }[] = [];

  try {
    for (const occurrenceDate of occurrenceDates(entry, startDate, endDate)) {
      for (const spec of specs) {
        const triggerDate = scheduledInstant(entry, occurrenceDate, spec.rule, timeZone);
        if (triggerDate.getTime() <= Date.now()) continue;
        const alarm = spec.kind === "ALARM";
        const notificationId = await Notifications.scheduleNotificationAsync({
          content: {
            title: PRODUCT_NAME,
            body: reminderBody(entry.kind, entry.allDay === true, spec.rule.reference),
            sound: alarm ? "default" : undefined,
            data: { reminderKind: spec.kind },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
        schedules.push({ occurrenceDate, notificationId });
      }
    }
  } finally {
    await replaceScheduledNotifications(db, entry, schedules);
  }
}
