import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { PflegeShiftRepositoryPort } from "@/application/pflegeshift-ports";
import { moveListItem } from "@/domain/reorder";
import type { ShiftTemplate } from "@/domain/types";

export function useTemplateOrder(
  templates: readonly ShiftTemplate[],
  setTemplates: Dispatch<SetStateAction<readonly ShiftTemplate[]>>,
  repository: Pick<PflegeShiftRepositoryPort, "swapTemplateSortOrder" | "reorderTemplates">,
) {
  const moveTemplate = useCallback(
    async (template: ShiftTemplate, direction: -1 | 1) => {
      const currentIndex = templates.findIndex((item) => item.id === template.id);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= templates.length) return;
      const swapped = await repository.swapTemplateSortOrder(template, templates[targetIndex]);
      setTemplates((current) =>
        current
          .map((item) => swapped.find((saved) => saved.id === item.id) ?? item)
          .sort((left, right) => left.sortOrder - right.sortOrder),
      );
    },
    [repository, templates, setTemplates],
  );
  const moveTemplateToIndex = useCallback(
    async (template: ShiftTemplate, targetIndex: number) => {
      const from = templates.findIndex((item) => item.id === template.id);
      const next = moveListItem(templates, from, targetIndex);
      if (next === templates) return;
      setTemplates(await repository.reorderTemplates(next));
    },
    [repository, templates, setTemplates],
  );
  return { moveTemplate, moveTemplateToIndex };
}
