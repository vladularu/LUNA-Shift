import { mapTemplate, type TemplateRow } from "./shift-template-row";
import type { SQLiteDatabase } from "expo-sqlite";

import type { SaveShiftTemplateInput, ShiftTemplate } from "@/domain/types";
import { ConcurrencyError } from "@/domain/errors";
import { createId, validateTemplate } from "@/domain/validation";
import { requireChanged, serializeJson } from "@/infrastructure/database/repository-shared";
import { withImmediateTransaction } from "@/infrastructure/database/transaction";

export async function listTemplates(db: SQLiteDatabase): Promise<readonly ShiftTemplate[]> {
  const rows = await db.getAllAsync<TemplateRow>(
    `SELECT id,name,type,all_day,start_time,end_time,break_minutes,color,symbol,
      notification_json,location_json,sort_order,special_duty_json,
      revision,created_at,updated_at,deleted_at
     FROM shift_templates WHERE deleted_at IS NULL ORDER BY sort_order,name`,
  );
  return Object.freeze(rows.map(mapTemplate));
}

export async function saveTemplate(
  db: SQLiteDatabase,
  rawInput: SaveShiftTemplateInput,
): Promise<ShiftTemplate> {
  const input = validateTemplate(rawInput);
  const id = input.id ?? createId("template");
  const now = new Date().toISOString();

  if (input.id === undefined) {
    await db.runAsync(
      `INSERT INTO shift_templates(
        id,name,type,all_day,start_time,end_time,break_minutes,color,symbol,
        notification_json,location_json,sort_order,special_duty_json,
        revision,created_at,updated_at,deleted_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)`,
      id,
      input.name,
      input.type,
      input.allDay ? 1 : 0,
      input.startTime,
      input.endTime,
      input.breakMinutes,
      input.color,
      input.symbol,
      serializeJson(input.notification),
      serializeJson(input.location),
      input.sortOrder,
      serializeJson(input.specialDuty),
      now,
      now,
    );
  } else {
    const result = await db.runAsync(
      `UPDATE shift_templates SET
        name=?,type=?,all_day=?,start_time=?,end_time=?,break_minutes=?,color=?,symbol=?,
        notification_json=?,location_json=?,sort_order=?,special_duty_json=?,revision=revision+1,updated_at=?
       WHERE id=? AND revision=? AND deleted_at IS NULL`,
      input.name,
      input.type,
      input.allDay ? 1 : 0,
      input.startTime,
      input.endTime,
      input.breakMinutes,
      input.color,
      input.symbol,
      serializeJson(input.notification),
      serializeJson(input.location),
      input.sortOrder,
      serializeJson(input.specialDuty),
      now,
      id,
      input.expectedRevision ?? -1,
    );
    await requireChanged(result.changes);
  }

  const row = await db.getFirstAsync<TemplateRow>(
    `SELECT id,name,type,all_day,start_time,end_time,break_minutes,color,symbol,
      notification_json,location_json,sort_order,special_duty_json,
      revision,created_at,updated_at,deleted_at FROM shift_templates WHERE id=?`,
    id,
  );
  if (row === null) throw new Error("Vorlage konnte nicht gespeichert werden.");
  return mapTemplate(row);
}

export async function deleteTemplate(
  db: SQLiteDatabase,
  id: string,
  expectedRevision: number,
): Promise<void> {
  const result = await db.runAsync(
    `UPDATE shift_templates SET revision=revision+1,updated_at=?,deleted_at=?
     WHERE id=? AND revision=? AND deleted_at IS NULL`,
    new Date().toISOString(),
    new Date().toISOString(),
    id,
    expectedRevision,
  );
  await requireChanged(result.changes);
}

export async function swapTemplateSortOrder(
  db: SQLiteDatabase,
  first: ShiftTemplate,
  second: ShiftTemplate,
): Promise<readonly [ShiftTemplate, ShiftTemplate]> {
  let swapped: readonly [ShiftTemplate, ShiftTemplate] | null = null;

  await withImmediateTransaction(db, async (transaction) => {
    const now = new Date().toISOString();
    const firstResult = await transaction.runAsync(
      `UPDATE shift_templates SET sort_order=?,revision=revision+1,updated_at=?
       WHERE id=? AND revision=? AND deleted_at IS NULL`,
      second.sortOrder,
      now,
      first.id,
      first.revision,
    );
    await requireChanged(firstResult.changes);

    const secondResult = await transaction.runAsync(
      `UPDATE shift_templates SET sort_order=?,revision=revision+1,updated_at=?
       WHERE id=? AND revision=? AND deleted_at IS NULL`,
      first.sortOrder,
      now,
      second.id,
      second.revision,
    );
    await requireChanged(secondResult.changes);

    const rows = await transaction.getAllAsync<TemplateRow>(
      `SELECT id,name,type,all_day,start_time,end_time,break_minutes,color,symbol,
        notification_json,location_json,sort_order,special_duty_json,
        revision,created_at,updated_at,deleted_at
       FROM shift_templates WHERE id IN (?,?)`,
      first.id,
      second.id,
    );
    if (rows.length !== 2) throw new ConcurrencyError();
    const mapped = rows.map(mapTemplate);
    const savedFirst = mapped.find((template) => template.id === first.id);
    const savedSecond = mapped.find((template) => template.id === second.id);
    if (!savedFirst || !savedSecond) throw new ConcurrencyError();
    swapped = Object.freeze([savedFirst, savedSecond]);
  });

  if (swapped === null) throw new ConcurrencyError();
  return swapped;
}
