import type { SpecialDuty } from "@/domain/special-duty";
import type { EntryLocation, EntryNotification, ShiftTemplate } from "@/domain/types";
import { ValidationError, validateTemplate } from "@/domain/validation";
import { parseJson } from "./repository-shared";
export interface TemplateRow {
  special_duty_json: string | null;
  id: string;
  name: string;
  type: ShiftTemplate["type"];
  all_day: number;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  color: string;
  symbol: string;
  notification_json: string | null;
  location_json: string | null;
  sort_order: number;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function mapTemplate(row: TemplateRow): ShiftTemplate {
  if (!Number.isInteger(row.sort_order) || !Number.isInteger(row.revision)) {
    throw new ValidationError("Gespeicherte Vorlagendaten sind ungültig.");
  }
  const validated = validateTemplate({
    specialDuty: parseJson<SpecialDuty>(row.special_duty_json ?? null, "Sonderdienst"),
    id: row.id,
    name: row.name,
    type: row.type,
    allDay: row.all_day === 1 || row.start_time === null,
    startTime: row.start_time,
    endTime: row.end_time,
    breakMinutes: row.break_minutes,
    color: row.color,
    symbol: row.symbol,
    notification: parseJson<EntryNotification>(row.notification_json, "Benachrichtigung"),
    location: parseJson<EntryLocation>(row.location_json, "Ort"),
    sortOrder: row.sort_order,
  });
  return Object.freeze({
    id: row.id,
    name: validated.name,
    specialDuty: validated.specialDuty ?? null,
    type: validated.type,
    allDay: validated.allDay ?? false,
    startTime: validated.startTime ?? null,
    endTime: validated.endTime ?? null,
    breakMinutes: validated.breakMinutes,
    color: validated.color,
    symbol: validated.symbol,
    notification: validated.notification ?? null,
    location: validated.location ?? null,
    sortOrder: validated.sortOrder,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}
