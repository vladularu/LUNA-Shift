import type { ShiftEntry, ComplianceIssue } from "@/domain/types";
import { dutyCalendarDates } from "./special-duty";
export function specialDutyComplianceIssues(
  shifts: readonly ShiftEntry[],
  month: string,
): ComplianceIssue[] {
  return shifts
    .filter(
      (shift) =>
        shift.deletedAt === null &&
        shift.specialDuty &&
        shift.specialDuty.kind !== "SPLIT" &&
        dutyCalendarDates(shift).some((date) => date.startsWith(month)),
    )
    .map((shift): ComplianceIssue => ({
      id: `SPECIAL_DUTY_REVIEW:${shift.id}:${month}`,
      severity: "warning",
      kind: "LEGAL",
      rule: "SPECIAL_DUTY_REVIEW",
      title:
        shift.specialDuty!.kind === "ON_CALL"
          ? "Rufbereitschaft prüfen"
          : "Bereitschaftsdienst prüfen",
      description:
        shift.specialDuty!.kind === "ON_CALL"
          ? `${shift.specialDuty!.calloutsComplete ? "Die erfassten Einsätze sind berücksichtigt." : "Die Einsätze sind noch nicht vollständig bestätigt."} Bei stark eingeschränkter Freizeit kann die gesamte Rufbereitschaft Arbeitszeit sein. Ruhezeit und zulässige Ausnahmen sind damit noch nicht abschließend geprüft.`
          : "Der gesamte Bereitschaftsdienst zählt hier zur Arbeitsschutzzeit. Tarifliche Verlängerungen, Einwilligungen und Ausgleichszeiträume sind nicht bestätigt; die Hinweise verwenden die allgemeinen Grenzen.",
      relatedShiftIds: [shift.id],
      date: dutyCalendarDates(shift).find((date) => date.startsWith(month))!,
    }));
}
