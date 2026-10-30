import type { DutyTariffFamily } from "@/engine/special-duty-tariff";
import { changeEditorDuty } from "./special-duty-editor-state";
import { SpecialDutyFields } from "./special-duty-fields";
import type { useEntryEditorDraft } from "./use-entry-editor-draft";

/** Connect the shared form to a dated entry without coupling templates to its draft. */
export function DayEditorSpecialDutyFields({
  draft,
  date,
  timeZone,
  tariffFamily,
}: {
  readonly draft: ReturnType<typeof useEntryEditorDraft>;
  readonly date: string;
  readonly timeZone: string;
  readonly tariffFamily: DutyTariffFamily | null;
}) {
  return (
    <SpecialDutyFields
      value={draft.specialDuty[0]}
      onChange={(next) => changeEditorDuty(draft, next)}
      startTime={draft.startTime[0]}
      endTime={draft.endTime[0]}
      breakMinutes={draft.breakMinutes[0]}
      onStartChange={draft.startTime[1]}
      onEndChange={draft.endTime[1]}
      onBreakMinutesChange={draft.breakMinutes[1]}
      date={date}
      timeZone={timeZone}
      tariffFamily={tariffFamily}
    />
  );
}
