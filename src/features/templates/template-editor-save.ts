import type {
  CalendarEntry,
  SaveShiftInput,
  SaveShiftTemplateInput,
  ShiftEntry,
  ShiftTemplate,
} from "@/domain/types";
import {
  matchingQuickEntries,
  quickEntryShiftInputFromTemplate,
} from "@/features/calendar/quick-entry-actions";

export interface TemplateEditorSaveProgress {
  readonly input: SaveShiftTemplateInput;
  readonly template: ShiftTemplate;
}

export async function saveTemplateWithOptionalCalendarEntry({
  entries,
  input,
  quickEntryDate,
  upsertShift,
  upsertTemplate,
  previousSave,
  onTemplateSaved,
}: {
  readonly entries: readonly CalendarEntry[];
  readonly input: SaveShiftTemplateInput;
  readonly quickEntryDate?: string;
  readonly upsertShift: (input: SaveShiftInput) => Promise<ShiftEntry>;
  readonly upsertTemplate: (input: SaveShiftTemplateInput) => Promise<ShiftTemplate>;
  readonly previousSave?: TemplateEditorSaveProgress | null;
  readonly onTemplateSaved?: (progress: TemplateEditorSaveProgress) => void;
}): Promise<ShiftTemplate> {
  const savedTemplate =
    previousSave && JSON.stringify(previousSave.input) === JSON.stringify(input)
      ? previousSave.template
      : await upsertTemplate({
          ...input,
          ...(previousSave
            ? { id: previousSave.template.id, expectedRevision: previousSave.template.revision }
            : {}),
        });
  onTemplateSaved?.({ input, template: savedTemplate });
  if (!quickEntryDate || input.id !== undefined) return savedTemplate;

  const savedAction = {
    kind: "TEMPLATE" as const,
    key: `template:${savedTemplate.id}`,
    label: savedTemplate.name,
    color: savedTemplate.color,
    symbol: savedTemplate.symbol,
    template: savedTemplate,
  };
  if (matchingQuickEntries(savedAction, quickEntryDate, entries).length === 0) {
    await upsertShift(quickEntryShiftInputFromTemplate(savedTemplate, quickEntryDate));
  }
  return savedTemplate;
}
