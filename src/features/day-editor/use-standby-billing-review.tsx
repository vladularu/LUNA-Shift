import { useMemo, useState } from "react";
import type { CalendarEntry, SaveShiftInput, ShiftEntry, UserProfile } from "@/domain/types";
import type { usePflegeShiftEntries } from "@/application/pflegeshift-provider";
import { calculateSpecialDutyPay } from "@/engine/special-duty-pay";
import type { RuleResolver } from "@/rules/rule-resolver";
import { standbyBillingCandidates, standbyBillingTransferInputs } from "./standby-billing-transfer";
import { StandbyBillingTransferFields } from "./standby-billing-transfer-fields";
import { DayEditorSpecialDutyFields } from "./day-editor-special-duty";
import { editorDutyTariff } from "./special-duty-editor-state";
import type { useEntryEditorDraft } from "./use-entry-editor-draft";

export function useStandbyBillingReview({
  original,
  draft,
  date,
  save,
  entries,
  profile,
  resolver,
  focused,
}: {
  readonly original: ShiftEntry | null;
  readonly draft: ReturnType<typeof useEntryEditorDraft>;
  readonly date: string;
  readonly save: Pick<ReturnType<typeof usePflegeShiftEntries>, "upsertShift" | "upsertShifts">;
  readonly entries: readonly CalendarEntry[];
  readonly profile: UserProfile | null;
  readonly resolver: RuleResolver;
  readonly focused: boolean;
}) {
  const duty = draft.specialDuty[0];
  const [selection, setSelection] = useState<readonly ShiftEntry[]>([]);
  const candidates = useMemo(
    () => standbyBillingCandidates(original, duty, entries, profile, resolver),
    [original, duty, entries, profile, resolver],
  );
  const message = useMemo(() => {
    if (!focused || !profile || !original) return undefined;
    return calculateSpecialDutyPay(
      original.date.slice(0, 7),
      [{ ...original, specialDuty: duty }],
      profile,
      resolver,
    ).find((line) => !line.complete)?.notes[0];
  }, [focused, original, duty, profile, resolver]);
  return {
    fields: (
      <DayEditorSpecialDutyFields
        billingFocus={focused}
        billingMessage={message}
        billingActions={
          <StandbyBillingTransferFields
            candidates={candidates}
            selected={selection}
            onChange={setSelection}
          />
        }
        tariffFamily={editorDutyTariff(profile, original?.date ?? date)}
        draft={draft}
        date={original?.date ?? date}
        timeZone={profile?.timeZone ?? "Europe/Berlin"}
      />
    ),
    saveShift: async (input: SaveShiftInput) => {
      const transferInputs =
        original && duty && selection.length
          ? standbyBillingTransferInputs(original, duty, selection, candidates)
          : [];
      return transferInputs.length
        ? (await save.upsertShifts([input, ...transferInputs]))[0]
        : save.upsertShift(input);
    },
  };
}
