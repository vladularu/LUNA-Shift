import { useRef, useState } from "react";
import { router } from "expo-router";
import type { SpecialDutyReview } from "@/domain/special-duty-review";
import { formatDateTitle } from "@/engine/calendar";
import { dayEditorRoute } from "@/navigation/routes";
import { SelectionSheet } from "@/ui/selection-sheet";
import { SalaryNavigationRow } from "./salary-ui";
import { AnalysisValueRow } from "@/features/analysis/analysis-list-card";

/** The same compact recovery action in the overview, statement and annual reference. */
export function SpecialDutyReviewRow({
  duties,
  disabled = false,
  analysis = false,
}: {
  readonly duties: readonly SpecialDutyReview[];
  readonly disabled?: boolean;
  readonly analysis?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pending = useRef<SpecialDutyReview | null>(null);
  const visit = (duty: SpecialDutyReview) =>
    router.push(dayEditorRoute(duty.date, "SHIFT", duty.shiftId, "BILLING"));
  if (!duties.length) return null;
  const countLabel = duties.length === 1 ? "1 Dienst prüfen" : `${duties.length} Dienste prüfen`;
  const review = () => (duties.length === 1 ? visit(duties[0]) : setOpen(true));
  return (
    <>
      {analysis ? (
        <AnalysisValueRow
          label="Bereitschaft"
          value={countLabel}
          onPress={disabled ? undefined : review}
        />
      ) : (
        <SalaryNavigationRow
          title={`Bereitschaft · ${countLabel}`}
          disabled={disabled}
          onPress={review}
        />
      )}
      {open ? (
        <SelectionSheet
          title="Bereitschaft prüfen"
          visible
          onClose={() => {
            setOpen(false);
            if (pending.current) visit(pending.current);
            pending.current = null;
          }}
        >
          {(dismiss) =>
            duties.map((duty) => (
              <SalaryNavigationRow
                key={duty.shiftId}
                title={formatDateTitle(duty.date)}
                subtitle={`${duty.title} · ${duty.message}`}
                onPress={() => {
                  pending.current = duty;
                  dismiss();
                }}
              />
            ))
          }
        </SelectionSheet>
      ) : null}
    </>
  );
}
