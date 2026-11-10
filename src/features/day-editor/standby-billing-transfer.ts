import { captureEmploymentProfile, employmentProfileAt } from "@/domain/employment-history";
import { resolveRemunerationProfile } from "@/domain/remuneration-profile";
import type { SpecialDuty } from "@/domain/special-duty";
import type { CalendarEntry, SaveShiftInput, ShiftEntry, UserProfile } from "@/domain/types";
import { ValidationError } from "@/domain/validation";
import { calculateSpecialDutyPay } from "@/engine/special-duty-pay";
import type { RuleResolver } from "@/rules/rule-resolver";

function sharedBilling(duty: SpecialDuty | null | undefined): string {
  if (duty?.kind !== "STANDBY") return "";
  const agreement = duty.standbyAgreement;
  return JSON.stringify({
    level: duty.standbyLevel,
    settlement: duty.settlement,
    agreement: agreement ? { ...agreement, sequence: null } : null,
  });
}

function periodKey(profile: UserProfile, date: string): string {
  const history = profile.employmentTimeline;
  const start = history?.length
    ? (resolveRemunerationProfile(history, date).profile?.effectiveFrom ?? null)
    : null;
  return JSON.stringify([start, captureEmploymentProfile(employmentProfileAt(profile, date))]);
}

export function standbyBillingCandidates(
  original: ShiftEntry | null,
  next: SpecialDuty | null,
  entries: readonly CalendarEntry[],
  profile: UserProfile | null,
  resolver: RuleResolver,
): readonly ShiftEntry[] {
  if (
    !original ||
    !profile ||
    profile.salaryBasisConflict ||
    original.specialDuty?.kind !== "STANDBY" ||
    next?.kind !== "STANDBY" ||
    sharedBilling(original.specialDuty) === sharedBilling(next)
  )
    return [];
  const sourceLine = calculateSpecialDutyPay(
    original.date.slice(0, 7),
    [{ ...original, specialDuty: next }],
    profile,
    resolver,
  );
  if (!sourceLine.length || sourceLine.some((line) => !line.complete)) return [];
  const key = periodKey(profile, original.date);
  return entries
    .filter((entry): entry is ShiftEntry => {
      if (
        entry.kind !== "SHIFT" ||
        entry.deletedAt !== null ||
        entry.id === original.id ||
        entry.specialDuty?.kind !== "STANDBY" ||
        sharedBilling(entry.specialDuty) !== sharedBilling(original.specialDuty) ||
        periodKey(profile, entry.date) !== key
      )
        return false;
      return calculateSpecialDutyPay(entry.date.slice(0, 7), [entry], profile, resolver).some(
        (line) => !line.complete,
      );
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function standbyBillingTransferInputs(
  original: ShiftEntry,
  next: SpecialDuty,
  selected: readonly ShiftEntry[],
  candidates: readonly ShiftEntry[],
): readonly SaveShiftInput[] {
  if (
    next.kind !== "STANDBY" ||
    !next.standbyAgreement ||
    new Set(selected.map((entry) => entry.id)).size !== selected.length
  )
    throw new ValidationError("Prüfe die ausgewählten Bereitschaftsdienste erneut.");
  return selected.map((entry) => {
    if (
      entry.id === original.id ||
      entry.specialDuty?.kind !== "STANDBY" ||
      !candidates.some(
        (candidate) => candidate.id === entry.id && candidate.revision === entry.revision,
      )
    )
      throw new ValidationError(
        "Ein ausgewählter Dienst wurde geändert. Wähle die Dienste erneut aus.",
      );
    return {
      ...entry,
      expectedRevision: entry.revision,
      specialDuty: {
        ...entry.specialDuty,
        version: entry.specialDuty.version === 3 ? 3 : 2,
        standbyLevel: next.standbyLevel,
        settlement: next.settlement,
        standbyAgreement: {
          ...next.standbyAgreement!,
          // This is an individual service fact, never a shared employer rule.
          sequence: entry.specialDuty.standbyAgreement?.sequence ?? null,
        },
      },
    };
  });
}
