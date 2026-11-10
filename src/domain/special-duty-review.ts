import type { MonthlyPayEstimate } from "./types";

export interface SpecialDutyReview {
  readonly shiftId: string;
  readonly date: string;
  readonly title: string;
  readonly message: string;
}

export function incompleteSpecialDuties(pay: MonthlyPayEstimate): readonly SpecialDutyReview[] {
  const seen = new Set<string>();
  return (pay.specialDutyBreakdowns ?? [])
    .filter((line) => {
      if (line.complete || seen.has(line.shiftId)) return false;
      seen.add(line.shiftId);
      return true;
    })
    .map((line) => ({
      shiftId: line.shiftId,
      date: line.date,
      title: line.title,
      message: line.notes[0] ?? "Prüfe die Abrechnungsangaben dieses Dienstes.",
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}
