import { Temporal } from "@js-temporal/polyfill";
import type { UserProfile, CalendarEntry } from "@/domain/types";
import { remunerationShiftDays } from "@/engine/remuneration-shift-days";
import {
  targetTariffForSector,
  tvlKrTargetTariff,
  tvhKrTargetTariff,
  tvUkTargetTariff,
} from "@/engine/working-time-target-rules";
import type {
  TargetTariff,
  TargetDayFact,
  TargetProfilePeriod,
  WorkingTimeTargetContext,
} from "@/domain/working-time-target";
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

/** Two decimal hours retain every stored minute when read back. */
export function targetWeeklyHoursText(minutes: number): string {
  return Number((minutes / 60).toFixed(2))
    .toString()
    .replace(".", ",");
}
export function parseTargetWeeklyHours(value: string): number {
  const input = value.trim();
  if (input.includes(":")) return parseTargetMinutes(input);
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(input))
    throw new WorkingTimeTargetError("Bitte Wochenstunden angeben, zum Beispiel 38,5.");
  const minutes = Math.round(Number(input.replace(",", ".")) * 60);
  if (minutes > 10080) throw new WorkingTimeTargetError("Die angegebene Arbeitszeit ist zu hoch.");
  return minutes;
}
export function targetDateText(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return day + "." + month + "." + year;
}
export function parseTargetDate(value: string): string {
  const input = value.trim();
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(input);
  const iso = german
    ? german[3] + "-" + german[2].padStart(2, "0") + "-" + german[1].padStart(2, "0")
    : input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
    throw new WorkingTimeTargetError("Bitte ein Datum angeben, zum Beispiel 01.01.2026.");
  try {
    return Temporal.PlainDate.from(iso).toString();
  } catch {
    throw new WorkingTimeTargetError("Bitte ein gültiges Datum angeben.");
  }
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

/** Reuse a salary selection as a suggestion, never as proof of working-time entitlement. */
export function employmentTargetTariff(profile: UserProfile): TargetTariff {
  const unverified = (id: string): TargetTariff => ({ kind: "UNVERIFIED", id });
  if (profile.salaryBasisConflict) return unverified("SALARY_CONFLICT");
  if (profile.tvalPflegeTariff) return unverified("TVA_L");
  if (profile.tvhKrTariff) {
    if (
      profile.tariff ||
      profile.tvlKrTariff ||
      profile.tvUkNursingTariff ||
      profile.vkaETariff ||
      profile.nursingTrainingTariff ||
      profile.tvalPflegeTariff
    )
      return unverified("SALARY_CONFLICT");
    return tvhKrTargetTariff();
  }
  if (profile.tvUkNursingTariff) {
    if (
      profile.tariff ||
      profile.tvlKrTariff ||
      profile.tvhKrTariff ||
      profile.vkaETariff ||
      profile.nursingTrainingTariff
    )
      return unverified("SALARY_CONFLICT");
    return tvUkTargetTariff();
  }
  if (profile.tvlKrTariff) {
    if (profile.tariff || profile.vkaETariff || profile.nursingTrainingTariff)
      return unverified("SALARY_CONFLICT");
    return tvlKrTargetTariff();
  }
  if (profile.vkaETariff) return unverified("VKA_E");
  if (profile.nursingTrainingTariff) return unverified("TVAOED");
  const tariff = targetTariffForSector(profile.tariff?.sector);
  if (tariff) return tariff;
  if (profile.tariff) return unverified("BT_B");
  return unverified(profile.manualMonthlyGrossCents != null ? "OWN_SALARY" : "UNCONFIRMED");
}

/** Calendar entries are proposals; an empty date is never evidence of rostered time off. */
export function targetDayDraftFromCalendar(
  date: string,
  entries: readonly CalendarEntry[],
  timeZone: string,
): TargetDayFact {
  const previous = Temporal.PlainDate.from(date).subtract({ days: 1 }).toString();
  const relevant = entries.filter(
    (entry) =>
      entry.kind === "SHIFT" &&
      entry.deletedAt === null &&
      (entry.date === date || entry.date === previous),
  );
  const current = relevant.filter((entry) => entry.date === date);
  const free = current.some((entry) => entry.kind === "SHIFT" && entry.type === "FREE");
  const absence = current.some(
    (entry) => entry.kind === "SHIFT" && ["VACATION", "SICK", "TRAINING"].includes(entry.type),
  );
  const duty = relevant.some(
    (entry) =>
      entry.kind === "SHIFT" &&
      remunerationShiftDays(entry, timeZone).some(
        (day) => day.date === date && day.until > day.from,
      ),
  );
  return {
    date,
    rosterStatus: "DRAFT",
    disposition:
      absence || (duty && free)
        ? "UNKNOWN"
        : duty
          ? "WORK_REQUIRED"
          : free
            ? "ROSTER_FREE"
            : "UNKNOWN",
    lostMinutes: null,
    mustWorkElsewhere: null,
  };
}
