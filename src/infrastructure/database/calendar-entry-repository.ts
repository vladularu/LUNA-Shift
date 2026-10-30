import { mapShift, mapAppointment, type ShiftRow, type AppointmentRow } from "./calendar-entry-row";
import type { SQLiteDatabase } from "expo-sqlite";

import type {
  Appointment,
  CalendarEntry,
  SaveAppointmentInput,
  SaveShiftInput,
  ShiftEntry,
} from "@/domain/types";
import { createId, validateAppointment, validateShift } from "@/domain/validation";
import { sortCalendarEntries } from "@/engine/calendar-entry-order";
import { requireChanged, serializeJson } from "@/infrastructure/database/repository-shared";
export { mapShift } from "./calendar-entry-row";

export async function listCalendarEntries(
  db: SQLiteDatabase,
  startDate = "1900-01-01",
  endDate = "4099-12-31",
): Promise<readonly CalendarEntry[]> {
  const shifts = await db.getAllAsync<ShiftRow>(
    `SELECT entries.id,entries.date,entries.template_id,
      COALESCE(templates.name,entries.title) AS title,entries.type,entries.all_day,
      entries.start_time,entries.end_time,entries.break_minutes,
      COALESCE(templates.color,entries.color) AS color,
      COALESCE(templates.symbol,entries.symbol) AS symbol,
      entries.note,entries.notification_json,entries.alarm_enabled,entries.location_json,
      entries.special_duty_json,entries.overtime_minutes,entries.tariff_overtime_confirmed,entries.holiday_premium_mode,
      entries.revision,entries.created_at,entries.updated_at,entries.deleted_at
     FROM shift_entries entries
     LEFT JOIN shift_templates templates ON templates.id=entries.template_id
     WHERE entries.deleted_at IS NULL AND entries.date BETWEEN ? AND ?`,
    startDate,
    endDate,
  );
  const appointments = await db.getAllAsync<AppointmentRow>(
    `SELECT id,date,title,all_day,start_time,end_time,color,note,
      recurrence_frequency,recurrence_interval,notification_json,location_json,revision,
      created_at,updated_at,deleted_at
     FROM appointments
     WHERE deleted_at IS NULL AND date <= ?
       AND (recurrence_frequency IS NOT NULL OR date >= ?)`,
    endDate,
    startDate,
  );
  return sortCalendarEntries([...shifts.map(mapShift), ...appointments.map(mapAppointment)]);
}

export async function saveShift(db: SQLiteDatabase, rawInput: SaveShiftInput): Promise<ShiftEntry> {
  const input = validateShift(rawInput);
  const id = input.id ?? createId("shift");
  const now = new Date().toISOString();

  if (input.id === undefined) {
    await db.runAsync(
      `INSERT INTO shift_entries(
        id,date,template_id,title,type,all_day,start_time,end_time,break_minutes,color,
        symbol,note,notification_json,alarm_enabled,location_json,overtime_minutes,
        tariff_overtime_confirmed,holiday_premium_mode,special_duty_json,
        revision,created_at,updated_at,deleted_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)`,
      id,
      input.date,
      input.templateId ?? null,
      input.title,
      input.type,
      input.allDay ? 1 : 0,
      input.startTime ?? null,
      input.endTime ?? null,
      input.breakMinutes ?? 0,
      input.color,
      input.symbol,
      input.note ?? null,
      serializeJson(input.notification),
      input.alarmEnabled ? 1 : 0,
      serializeJson(input.location),
      input.overtimeMinutes ?? 0,
      input.tariffOvertimeConfirmed ? 1 : 0,
      input.holidayPremiumMode ?? "WITH_TIME_OFF",
      serializeJson(input.specialDuty),
      now,
      now,
    );
  } else {
    const result = await db.runAsync(
      `UPDATE shift_entries SET
        date=?,template_id=?,title=?,type=?,all_day=?,start_time=?,end_time=?,break_minutes=?,
        color=?,symbol=?,note=?,notification_json=?,alarm_enabled=?,location_json=?,
        overtime_minutes=?,tariff_overtime_confirmed=?,holiday_premium_mode=?,special_duty_json=?,
        revision=revision+1,updated_at=?
       WHERE id=? AND revision=? AND deleted_at IS NULL`,
      input.date,
      input.templateId ?? null,
      input.title,
      input.type,
      input.allDay ? 1 : 0,
      input.startTime ?? null,
      input.endTime ?? null,
      input.breakMinutes ?? 0,
      input.color,
      input.symbol,
      input.note ?? null,
      serializeJson(input.notification),
      input.alarmEnabled ? 1 : 0,
      serializeJson(input.location),
      input.overtimeMinutes ?? 0,
      input.tariffOvertimeConfirmed ? 1 : 0,
      input.holidayPremiumMode ?? "WITH_TIME_OFF",
      serializeJson(input.specialDuty),
      now,
      id,
      input.expectedRevision ?? -1,
    );
    await requireChanged(result.changes);
  }

  const row = await db.getFirstAsync<ShiftRow>(
    `SELECT id,date,template_id,title,type,all_day,start_time,end_time,break_minutes,color,
      symbol,note,notification_json,alarm_enabled,location_json,overtime_minutes,
      tariff_overtime_confirmed,holiday_premium_mode,special_duty_json,
      revision,created_at,updated_at,deleted_at
     FROM shift_entries WHERE id=?`,
    id,
  );
  if (row === null) throw new Error("Dienst konnte nicht gespeichert werden.");
  return mapShift(row);
}

export async function saveAppointment(
  db: SQLiteDatabase,
  rawInput: SaveAppointmentInput,
): Promise<Appointment> {
  const input = validateAppointment(rawInput);
  const id = input.id ?? createId("appointment");
  const now = new Date().toISOString();

  if (input.id === undefined) {
    await db.runAsync(
      `INSERT INTO appointments(
        id,date,title,all_day,start_time,end_time,color,note,
        recurrence_frequency,recurrence_interval,notification_json,location_json,revision,
        created_at,updated_at,deleted_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)`,
      id,
      input.date,
      input.title,
      input.allDay ? 1 : 0,
      input.startTime ?? null,
      input.endTime ?? null,
      input.color,
      input.note ?? null,
      input.recurrence?.frequency ?? null,
      input.recurrence?.interval ?? null,
      serializeJson(input.notification),
      serializeJson(input.location),
      now,
      now,
    );
  } else {
    const result = await db.runAsync(
      `UPDATE appointments SET
        date=?,title=?,all_day=?,start_time=?,end_time=?,color=?,note=?,
        recurrence_frequency=?,recurrence_interval=?,notification_json=?,location_json=?,
        revision=revision+1,updated_at=?
       WHERE id=? AND revision=? AND deleted_at IS NULL`,
      input.date,
      input.title,
      input.allDay ? 1 : 0,
      input.startTime ?? null,
      input.endTime ?? null,
      input.color,
      input.note ?? null,
      input.recurrence?.frequency ?? null,
      input.recurrence?.interval ?? null,
      serializeJson(input.notification),
      serializeJson(input.location),
      now,
      id,
      input.expectedRevision ?? -1,
    );
    await requireChanged(result.changes);
  }

  const row = await db.getFirstAsync<AppointmentRow>(
    `SELECT id,date,title,all_day,start_time,end_time,color,note,
      recurrence_frequency,recurrence_interval,notification_json,location_json,revision,
      created_at,updated_at,deleted_at FROM appointments WHERE id=?`,
    id,
  );
  if (row === null) throw new Error("Termin konnte nicht gespeichert werden.");
  return mapAppointment(row);
}

export async function deleteCalendarEntry(
  db: SQLiteDatabase,
  entry: Pick<CalendarEntry, "id" | "kind" | "revision">,
): Promise<void> {
  const table = entry.kind === "SHIFT" ? "shift_entries" : "appointments";
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `UPDATE ${table} SET revision=revision+1,updated_at=?,deleted_at=?
     WHERE id=? AND revision=? AND deleted_at IS NULL`,
    now,
    now,
    entry.id,
    entry.revision,
  );
  await requireChanged(result.changes);
}
