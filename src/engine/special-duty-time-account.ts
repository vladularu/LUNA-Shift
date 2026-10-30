import type { ShiftEntry, UserProfile } from "@/domain/types";
import type { SpecialDutyTimeCredit } from "@/domain/special-duty-pay";
import type { RuleResolver } from "@/rules/rule-resolver";
import { DUTY_LABELS, dutyInstant } from "@/domain/special-duty";
import { calculateSpecialDutyPay } from "./special-duty-pay";
import { dutyCalendarDates, dutyWorkParts, specialDutyWorkMinutes } from "./special-duty";
import { calculateTimedShiftBounds } from "./working-time";

/** Recomputed from canonical entries: no mutable second booking or duplicated restored credit. */
export function specialDutyTimeAccount(
  month: string,
  entries: readonly ShiftEntry[],
  profile: Partial<UserProfile> & Pick<UserProfile, "timeZone" | "federalState" | "weeklyMinutes">,
  resolver: RuleResolver,
) {
  const seen = new Set<string>();
  const duties = entries.filter((entry) => {
    if (
      entry.deletedAt !== null ||
      !entry.specialDuty ||
      entry.specialDuty.kind === "SPLIT" ||
      seen.has(entry.id) ||
      !dutyCalendarDates(entry).some((date) => date.startsWith(month))
    )
      return false;
    seen.add(entry.id);
    return true;
  });
  const pay = new Map(
    calculateSpecialDutyPay(month, duties, profile as UserProfile, resolver).map((line) => [
      line.shiftId,
      line,
    ]),
  );
  const intervals = (entry: ShiftEntry) =>
    entry.specialDuty
      ? dutyWorkParts(entry).map(
          (part) =>
            [
              Number(
                dutyInstant(entry.date, part.start, entry.specialDuty!.timeZone).epochMilliseconds,
              ),
              Number(
                dutyInstant(entry.date, part.end, entry.specialDuty!.timeZone).epochMilliseconds,
              ),
            ] as const,
        )
      : (() => {
          const bounds = calculateTimedShiftBounds(entry, profile.timeZone);
          return bounds
            ? [[bounds.startEpochMinutes * 60000, bounds.endEpochMinutes * 60000] as const]
            : [];
        })();
  const lines: SpecialDutyTimeCredit[] = duties.map((entry) => {
    const duty = entry.specialDuty!,
      money = pay.get(entry.id);
    const notes: string[] = [];
    let creditedMinutes: number | null = null;
    if (duty.kind === "ON_CALL" && !duty.calloutsComplete)
      notes.push("Rufbereitschaft: Bestätige, ob alle Einsätze erfasst sind.");
    else if (duty.kind === "ON_CALL" && duty.callouts.length === 0) creditedMinutes = 0;
    else if (duty.settlement === "UNKNOWN")
      notes.push(
        `${DUTY_LABELS[duty.kind]}: Wähle Auszahlung oder den vereinbarten Freizeitausgleich.`,
      );
    else
      creditedMinutes =
        duty.kind === "STANDBY"
          ? (money?.standbyPay?.timeCreditMinutes ?? null)
          : (money?.calloutPay?.timeCreditMinutes ?? null);
    if (creditedMinutes === null && !notes.length) {
      const reasons = money?.standbyPay?.notes ?? money?.calloutPay?.notes ?? [];
      notes.push(
        ...(reasons.length
          ? reasons
          : [
              `${DUTY_LABELS[duty.kind]}: Die Grundlage für die Zeitgutschrift fehlt oder ist noch offen.`,
            ]),
      );
    }
    if (creditedMinutes !== null && creditedMinutes > 0) {
      const own = intervals(entry);
      if (
        entries.some(
          (other) =>
            other.id !== entry.id &&
            other.deletedAt === null &&
            own.some(([start, end]) => intervals(other).some(([a, b]) => a < end && b > start)),
        )
      ) {
        creditedMinutes = null;
        notes.push(
          "Bereitschafts- oder Einsatzzeiten überschneiden sich mit einem anderen Dienst. Prüfe die Zeitgutschrift.",
        );
      }
    }
    return {
      shiftId: entry.id,
      date: entry.date,
      title: DUTY_LABELS[duty.kind],
      recordedMinutes: specialDutyWorkMinutes(entry),
      creditedMinutes,
      settlement: duty.settlement,
      notes,
    };
  });
  const notes = [...new Set(lines.flatMap((line) => line.notes))];
  return {
    lines,
    notes,
    ids: new Set(lines.map((line) => line.shiftId)),
    creditedMinutes: notes.length
      ? null
      : lines.reduce((sum, line) => sum + line.creditedMinutes!, 0),
  };
}
