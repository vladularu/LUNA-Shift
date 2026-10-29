import { DUTY_LABELS, type SpecialDuty } from "@/domain/special-duty";
import { calculateTimedShiftMinutes } from "@/engine/working-time";
import type { useEntryEditorDraft } from "./use-entry-editor-draft";
import type { UserProfile } from "@/domain/types";
import { employmentProfileAt } from "@/domain/employment-history";
import { dutyTariffFamily } from "@/engine/special-duty-tariff";

export function editorDutyTariff(profile: UserProfile | null, date: string) {
  return profile ? dutyTariffFamily(employmentProfileAt(profile, date)) : null;
}

export function editorDutyDuration(
  timed: boolean,
  shift: Parameters<typeof calculateTimedShiftMinutes>[0],
  timeZone: string,
): number | null {
  if (!timed) return null;
  try {
    return calculateTimedShiftMinutes(shift, timeZone);
  } catch {
    // Saving provides the validation message for invalid local times.
    return null;
  }
}

export function changeEditorDuty(
  draft: ReturnType<typeof useEntryEditorDraft>,
  next: SpecialDuty | null,
): void {
  if (next?.kind !== draft.specialDuty[0]?.kind) {
    draft.shiftType[1]("CUSTOM");
    draft.shiftTitle[1](next ? DUTY_LABELS[next.kind] : "Dienst");
  }
  draft.specialDuty[1](next);
  if (next?.kind === "ON_CALL") draft.breakMinutes[1]("0");
  if (next) {
    if (next.kind !== "SPLIT") {
      draft.overtimeMinutes[1]("0");
      draft.tariffOvertimeConfirmed[1](false);
    }
    draft.selectedTemplateId[1](null);
  }
}
