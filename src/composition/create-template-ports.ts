import type { SQLiteDatabase } from "expo-sqlite";
import type { PflegeShiftRepositoryPort } from "@/application/pflegeshift-ports";
import {
  deleteTemplate,
  listTemplates,
  restoreTemplate,
  saveTemplate,
  swapTemplateSortOrder,
} from "@/infrastructure/database/repository";
import { reorderTemplates } from "@/infrastructure/database/shift-template-order-repository";

export function createTemplatePorts(
  db: SQLiteDatabase,
): Pick<
  PflegeShiftRepositoryPort,
  | "listTemplates"
  | "saveTemplate"
  | "deleteTemplate"
  | "restoreTemplate"
  | "swapTemplateSortOrder"
  | "reorderTemplates"
> {
  return {
    listTemplates: () => listTemplates(db),
    saveTemplate: (input) => saveTemplate(db, input),
    deleteTemplate: (id, revision) => deleteTemplate(db, id, revision),
    restoreTemplate: (template) => restoreTemplate(db, template),
    swapTemplateSortOrder: (first, second) => swapTemplateSortOrder(db, first, second),
    reorderTemplates: (templates) => reorderTemplates(db, templates),
  };
}
