import { Temporal } from "@js-temporal/polyfill";
import type { TargetProfilePeriod, WorkingTimeTargetContext } from "@/domain/working-time-target";
import { validateWorkingTimeTargetContext } from "@/domain/saved-working-time-target";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";

export function targetMinutesText(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function parseTargetMinutes(value: string, max = 10080): number {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  if (!match)
    throw new WorkingTimeTargetError(
      "Bitte die Zeit als Stunden:Minuten eingeben, zum Beispiel 38:30.",
    );
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes > max) throw new WorkingTimeTargetError("Die angegebene Arbeitszeit ist zu hoch.");
  return minutes;
}
/** A new dated change preserves both earlier history and already saved future changes. */
export function putTargetPeriod(
  context: WorkingTimeTargetContext,
  period: TargetProfilePeriod,
): WorkingTimeTargetContext {
  validateWorkingTimeTargetContext({ periods: [period], days: [] });
  const next = context.periods
    .filter((old) => old.validFrom > period.validFrom)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
  const end =
    period.validTo ??
    (next ? Temporal.PlainDate.from(next.validFrom).subtract({ days: 1 }).toString() : null);
  const replacement = { ...period, validTo: end };
  const periods: TargetProfilePeriod[] = [];
  for (const old of context.periods) {
    if (old.validFrom === period.validFrom) continue;
    if (
      old.validFrom < period.validFrom &&
      (old.validTo === null || old.validTo >= period.validFrom)
    ) {
      periods.push({
        ...old,
        validTo: Temporal.PlainDate.from(period.validFrom).subtract({ days: 1 }).toString(),
      });
      if (end !== null && (old.validTo === null || end < old.validTo))
        periods.push({
          ...old,
          validFrom: Temporal.PlainDate.from(end).add({ days: 1 }).toString(),
        });
    } else periods.push(old);
  }
  periods.push(replacement);
  return validateWorkingTimeTargetContext({
    ...context,
    periods: periods.sort((a, b) => a.validFrom.localeCompare(b.validFrom)),
  });
}
