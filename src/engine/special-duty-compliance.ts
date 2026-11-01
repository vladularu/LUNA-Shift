import type { ShiftEntry, ComplianceIssue } from "@/domain/types";
import { dutyCalendarDates } from "./special-duty";
export function specialDutyComplianceIssues(
  shifts: readonly ShiftEntry[],
  month: string,
): ComplianceIssue[] {
  const duties = shifts.filter(
    (shift) =>
      shift.deletedAt === null &&
      shift.specialDuty &&
      shift.specialDuty.kind !== "SPLIT" &&
      dutyCalendarDates(shift).some((date) => date.startsWith(month)),
  );
  if (duties.length === 0) return [];
  const dateFor = (shift: ShiftEntry) =>
    dutyCalendarDates(shift).find((date) => date.startsWith(month))!;
  const scope: ComplianceIssue = {
    id: `SPECIAL_DUTY_REVIEW:${month}`,
    severity: "info",
    kind: "LEGAL",
    rule: "SPECIAL_DUTY_REVIEW",
    title: "Prüfumfang Bereitschaften",
    description:
      "Besondere Voraussetzungen und Ausnahmen für Bereitschaften sind nicht abschließend geprüft.",
    relatedShiftIds: duties.map((shift) => shift.id),
    date: duties.map(dateFor).sort()[0],
  };
  return [
    scope,
    ...duties
      .filter(
        (shift) => shift.specialDuty!.kind === "ON_CALL" && !shift.specialDuty!.calloutsComplete,
      )
      .map((shift): ComplianceIssue => ({
        id: `SPECIAL_DUTY_CALLOUTS_INCOMPLETE:${shift.id}:${month}`,
        severity: "warning",
        kind: "LEGAL",
        rule: "SPECIAL_DUTY_CALLOUTS_INCOMPLETE",
        title: "Rufbereitschaft: Einsatzzeiten ergänzen",
        description:
          "Bestätige, ob alle Einsätze erfasst sind. Auch eine Rufbereitschaft ohne Einsatz muss vollständig erfasst sein.",
        date: dateFor(shift),
        relatedShiftIds: [shift.id],
      })),
  ];
}
