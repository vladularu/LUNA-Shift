import type { SpecialDuty } from "@/domain/special-duty";
import type {
  Appointment,
  EntryLocation,
  EntryNotification,
  RecurrenceFrequency,
  ShiftEntry,
} from "@/domain/types";
import { ValidationError, validateAppointment, validateShift } from "@/domain/validation";
import { parseJson } from "./repository-shared";
export interface ShiftRow {
  special_duty_json: string | null;
  id: string;
  date: string;
  template_id: string | null;
  title: string;
  type: ShiftEntry["type"];
  all_day: number;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  color: string;
  symbol: string;
  note: string | null;
  notification_json: string | null;
  alarm_enabled: number;
  location_json: string | null;
  overtime_minutes: number;
  tariff_overtime_confirmed: number;
  holiday_premium_mode: ShiftEntry["holidayPremiumMode"];
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AppointmentRow {
  id: string;
  date: string;
  title: string;
  all_day: number;
  start_time: string | null;
  end_time: string | null;
  color: string;
  note: string | null;
  recurrence_frequency: RecurrenceFrequency | null;
  recurrence_interval: number | null;
  notification_json: string | null;
  location_json: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function mapShift(row: ShiftRow): ShiftEntry {
  if (!Number.isInteger(row.revision)) {
    throw new ValidationError("Gespeicherte Dienstdaten sind ungültig.");
  }
  const validated = validateShift({
    specialDuty: parseJson<SpecialDuty>(row.special_duty_json ?? null, "Sonderdienst"),
    id: row.id,
    date: row.date,
    templateId: row.template_id,
    title: row.title,
    type: row.type,
    allDay: row.all_day === 1 || row.start_time === null,
    startTime: row.start_time,
    endTime: row.end_time,
    breakMinutes: row.break_minutes,
    color: row.color,
    symbol: row.symbol,
    note: row.note,
    notification: parseJson<EntryNotification>(row.notification_json, "Benachrichtigung"),
    alarmEnabled: row.alarm_enabled === 1,
    location: parseJson<EntryLocation>(row.location_json, "Ort"),
    overtimeMinutes: row.overtime_minutes,
    tariffOvertimeConfirmed: row.tariff_overtime_confirmed === 1,
    holidayPremiumMode: row.holiday_premium_mode,
  });
  return Object.freeze({
    kind: "SHIFT",
    specialDuty: validated.specialDuty ?? null,
    id: row.id,
    date: validated.date,
    templateId: validated.templateId ?? null,
    title: validated.title,
    type: validated.type,
    allDay: validated.allDay ?? false,
    startTime: validated.startTime ?? null,
    endTime: validated.endTime ?? null,
    breakMinutes: validated.breakMinutes ?? 0,
    color: validated.color,
    symbol: validated.symbol,
    note: validated.note ?? null,
    notification: validated.notification ?? null,
    alarmEnabled: validated.alarmEnabled ?? false,
    location: validated.location ?? null,
    overtimeMinutes: validated.overtimeMinutes ?? 0,
    tariffOvertimeConfirmed: validated.tariffOvertimeConfirmed ?? false,
    holidayPremiumMode: validated.holidayPremiumMode ?? "WITH_TIME_OFF",
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

export function mapAppointment(row: AppointmentRow): Appointment {
  if ((row.all_day !== 0 && row.all_day !== 1) || !Number.isInteger(row.revision)) {
    throw new ValidationError("Gespeicherte Termindaten sind ungültig.");
  }
  const validated = validateAppointment({
    id: row.id,
    date: row.date,
    title: row.title,
    allDay: row.all_day === 1,
    startTime: row.start_time,
    endTime: row.end_time,
    color: row.color,
    note: row.note,
    recurrence:
      row.recurrence_frequency !== null && row.recurrence_interval !== null
        ? { frequency: row.recurrence_frequency, interval: row.recurrence_interval }
        : null,
    notification: parseJson<EntryNotification>(row.notification_json, "Benachrichtigung"),
    location: parseJson<EntryLocation>(row.location_json, "Ort"),
  });
  return Object.freeze({
    kind: "APPOINTMENT",
    id: row.id,
    date: validated.date,
    title: validated.title,
    allDay: validated.allDay,
    startTime: validated.startTime ?? null,
    endTime: validated.endTime ?? null,
    color: validated.color,
    note: validated.note ?? null,
    recurrence: validated.recurrence ?? null,
    notification: validated.notification ?? null,
    location: validated.location ?? null,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}
