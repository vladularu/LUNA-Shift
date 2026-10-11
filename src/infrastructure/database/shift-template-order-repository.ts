import type { SQLiteDatabase } from "expo-sqlite";
import type { ShiftTemplate } from "@/domain/types";
import { ConcurrencyError } from "@/domain/errors";
import { listTemplates } from "./shift-template-repository";
import { requireChanged } from "./repository-shared";
import { withImmediateTransaction } from "./transaction";

/** A drop commits the whole permutation atomically, guarded by the loaded revisions. */
export async function reorderTemplates(
  db: SQLiteDatabase,
  requested: readonly ShiftTemplate[],
): Promise<readonly ShiftTemplate[]> {
  return withImmediateTransaction(db, async (transaction) => {
    const current = await listTemplates(transaction);
    const currentById = new Map(current.map((template) => [template.id, template]));
    const expected = new Map(requested.map((template) => [template.id, template.revision]));
    if (
      expected.size !== requested.length ||
      current.length !== requested.length ||
      current.some((template) => expected.get(template.id) !== template.revision)
    )
      throw new ConcurrencyError();
    if (current.every((template, index) => template.id === requested[index].id)) return current;
    const now = new Date().toISOString();
    for (const [index, template] of requested.entries()) {
      if (currentById.get(template.id)!.sortOrder === index) continue;
      const result = await transaction.runAsync(
        `UPDATE shift_templates SET sort_order=?,revision=revision+1,updated_at=?
         WHERE id=? AND revision=? AND deleted_at IS NULL`,
        index,
        now,
        template.id,
        template.revision,
      );
      await requireChanged(result.changes);
    }
    return listTemplates(transaction);
  });
}
